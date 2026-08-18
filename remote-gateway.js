import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request as requestHttp } from 'node:http'

const COOKIE_NAME = 'dsh_mobile_remote'
const PAIRING_TTL_MS = 5 * 60 * 1000
const DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60
const MAX_PAIR_BODY_BYTES = 4096
const DEFAULT_BLOCKED_CLIENT_IDS = ['dsh-plugin-desktop']

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const PRIVILEGED_API_METHODS = new Set([
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

const hashToken = (value) => createHash('sha256').update(value).digest('hex')
const shortHash = (value) => createHash('sha1').update(value).digest('hex').slice(0, 12)

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const json = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

const text = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

const parseCookies = (value) => {
  const out = new Map()
  for (const part of String(value || '').split(';')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const raw = part.slice(at + 1).trim()
    try { out.set(name, decodeURIComponent(raw)) } catch { out.set(name, raw) }
  }
  return out
}

const stripGatewayCookie = (value) => String(value || '')
  .split(';')
  .map((part) => part.trim())
  .filter((part) => part && !part.startsWith(`${COOKIE_NAME}=`))
  .join('; ')

const readJson = (req) => new Promise((resolve) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_PAIR_BODY_BYTES) {
      req.destroy()
      resolve(null)
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
  })
  req.on('error', () => resolve(null))
})

const pairPage = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>DSH 移动端配对</title></head>
<body><main><h1>DSH 移动端配对</h1><p id="status">正在建立安全配对…</p></main>
<script>
(async()=>{const status=document.getElementById('status');const code=location.hash.slice(1);if(!code){status.textContent='配对链接无效，请回到电脑刷新二维码。';return}try{const res=await fetch('/mobile-remote/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});const data=await res.json();if(!res.ok)throw new Error(data.error||('HTTP '+res.status));location.replace('/')}catch(error){status.textContent='配对失败：'+String(error&&error.message||error)}})();
</script></body></html>`

const authorityOf = (req) => {
  try { return new URL(`http://${String(req.headers.host || '')}`).host } catch { return '' }
}

const isSameOriginRequest = (req) => {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(String(origin)).host === authorityOf(req) } catch { return false }
}

const deniedPath = (pathname, blockedPrefixes) => {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return true }
  if (blockedPrefixes.some((prefix) => decoded === prefix || decoded.startsWith(`${prefix}/`))) return true
  if (decoded === '/plugins/dsh-wechat-bridge/desktop') return true
  if (!decoded.startsWith('/api/')) return false
  return PRIVILEGED_API_METHODS.has(decoded.slice('/api/'.length))
}

const proxyHeaders = (req, targetPort) => {
  const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` }
  if (headers.origin) headers.origin = `http://127.0.0.1:${targetPort}`
  const cookie = stripGatewayCookie(headers.cookie)
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  delete headers['proxy-connection']
  delete headers['x-forwarded-for']
  delete headers['x-forwarded-host']
  delete headers['x-forwarded-proto']
  // The gateway may rewrite index.html. Ask the loopback upstream for a
  // plain response so content-encoding cannot make the rewrite invalid.
  headers['accept-encoding'] = 'identity'
  return headers
}

const writeUpgradeHead = (socket, response) => {
  const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage || 'Switching Protocols'}`]
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`)
    else if (value !== undefined) lines.push(`${name}: ${value}`)
  }
  socket.write(`${lines.join('\r\n')}\r\n\r\n`)
}

const collectResponseBody = (response) => new Promise((resolve, reject) => {
  const chunks = []
  response.on('data', (chunk) => chunks.push(chunk))
  response.on('end', () => resolve(Buffer.concat(chunks)))
  response.on('error', reject)
})

/**
 * The Desktop-only client package can be present in a shared Web profile, but
 * its browser bundle requires a native Desktop mode that a phone does not
 * have. The LAN gateway is the only surface that needs to hide that client
 * row; the DSH host and its core client-module registry remain untouched.
 */
const rewriteBootManifest = (html, blockedClientIds) => {
  const assignment = /window\.__DSH_BOOT__\s*=\s*/.exec(html)
  if (!assignment) return html
  const start = assignment.index + assignment[0].length
  const end = html.indexOf('</script>', start)
  if (end === -1) return html
  const raw = html.slice(start, end).trim().replace(/;\s*$/, '')
  let graph
  try { graph = JSON.parse(raw) } catch { return html }
  if (!graph || !Array.isArray(graph.entries)) return html
  const blocked = new Set(blockedClientIds)
  const entries = graph.entries
    .filter((entry) => entry && !blocked.has(entry.id))
    .map((entry) => {
      if (!Array.isArray(entry.inject)) return entry
      const inject = entry.inject.filter((id) => !blocked.has(id))
      return inject.length === entry.inject.length ? entry : { ...entry, inject }
    })
  if (entries.length === graph.entries.length && entries.every((entry, index) => entry === graph.entries[index])) return html
  const nextGraph = { ...graph, entries, rev: shortHash(JSON.stringify(entries)) }
  const serialized = JSON.stringify(nextGraph).replaceAll('<', '\\u003c')
  return html.slice(0, start) + serialized + html.slice(end)
}

export function createMobileRemoteGateway({
  getTargetPort,
  getLanAddress,
  port = 3082,
  blockedPrefixes = ['/wxb'],
  blockedClientIds = DEFAULT_BLOCKED_CLIENT_IDS,
  logger = console,
  createQr = async (value, options) => {
    const QRCode = (await import('qrcode')).default
    return QRCode.toDataURL(value, options)
  },
} = {}) {
  let server = null
  let phase = 'stopped'
  let detail = '移动端远程已停止。'
  let lanAddress = null
  let pairingSecret = null
  let pairingExpiresAt = null
  let pairingQrImage = null
  let lastError = null
  const sockets = new Set()
  const devices = new Map()
  const blockedClients = [...blockedClientIds]

  const targetPort = () => Number(getTargetPort?.() || 0)
  const lanUrl = () => lanAddress ? `http://${lanAddress}:${port}` : null

  const publicDevices = () => [...devices.values()]
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .map(({ tokenHash: _tokenHash, ...device }) => ({ ...device }))

  const snapshot = () => {
    const upstreamPort = targetPort()
    const address = lanAddress || getLanAddress?.() || null
    const url = address ? `http://${address}:${port}` : null
    const conflict = upstreamPort === port
    return {
      enabled: Boolean(server?.listening),
      canStart: Boolean(address && upstreamPort > 0 && !conflict),
      phase,
      detail: conflict ? `DSH 主服务已占用 ${port} 端口，不能同时启动移动端网关。` : detail,
      lanAddress: address,
      lanUrl: url,
      readerUrl: url ? `${url}/reader` : null,
      pairingQrImage,
      pairingExpiresAt,
      devices: publicDevices(),
      lastError,
    }
  }

  const rotatePairing = async () => {
    if (!server?.listening || !lanAddress) throw new Error('移动端网关尚未运行')
    pairingSecret = randomBytes(32).toString('base64url')
    pairingExpiresAt = Date.now() + PAIRING_TTL_MS
    const pairingUrl = `${lanUrl()}/pair#${pairingSecret}`
    pairingQrImage = await createQr(pairingUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    })
    return snapshot()
  }

  const requestDevice = (req) => {
    const token = parseCookies(req.headers.cookie).get(COOKIE_NAME)
    if (!token) return null
    const device = devices.get(hashToken(token))
    if (!device) return null
    device.lastSeenAt = Date.now()
    return device
  }

  const acceptedAuthority = (req) => {
    const host = authorityOf(req).toLowerCase()
    const allowed = new Set([
      `${lanAddress}:${port}`.toLowerCase(),
      `127.0.0.1:${port}`,
      `localhost:${port}`,
    ])
    return allowed.has(host)
  }

  const acceptedInterface = (req) => {
    const local = String(req.socket?.localAddress || '').toLowerCase()
    return LOOPBACK_ADDRESSES.has(local) || local === String(lanAddress || '').toLowerCase()
  }

  const proxyRequest = (req, res) => {
    const upstreamPort = targetPort()
    const upstream = requestHttp({
      hostname: '127.0.0.1',
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: proxyHeaders(req, upstreamPort),
    }, async (upstreamResponse) => {
      const contentType = String(upstreamResponse.headers['content-type'] || '').toLowerCase()
      const contentEncoding = String(upstreamResponse.headers['content-encoding'] || '').toLowerCase()
      const shouldRewrite = contentType.includes('text/html') && (!contentEncoding || contentEncoding === 'identity')
      if (!shouldRewrite) {
        res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
        upstreamResponse.pipe(res)
        return
      }
      try {
        const body = await collectResponseBody(upstreamResponse)
        const rewritten = rewriteBootManifest(body.toString('utf8'), blockedClients)
        const headers = { ...upstreamResponse.headers }
        delete headers['transfer-encoding']
        // The boot manifest contains revisioned client URLs and is rewritten
        // per gateway request. Never let a phone reuse an older shell after a
        // plugin update or a Desktop/Web profile switch.
        delete headers.etag
        delete headers['last-modified']
        headers['content-length'] = String(Buffer.byteLength(rewritten))
        headers['cache-control'] = 'no-store'
        headers.pragma = 'no-cache'
        res.writeHead(upstreamResponse.statusCode || 502, headers)
        res.end(rewritten)
      } catch (error) {
        logger.warn?.('[mobile-remote] upstream HTML response failed:', error)
        if (!res.headersSent) text(res, 502, 'DSH 上游响应失败')
        else res.destroy(error)
      }
    })
    upstream.on('error', (error) => {
      logger.warn?.('[mobile-remote] upstream request failed:', error)
      if (!res.headersSent) text(res, 502, 'DSH 上游连接失败')
      else res.destroy(error)
    })
    req.pipe(upstream)
  }

  const handle = async (req, res) => {
    if (!acceptedInterface(req) || !acceptedAuthority(req) || !isSameOriginRequest(req)) {
      return text(res, 403, 'forbidden')
    }
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname === '/pair' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(pairPage),
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      })
      return res.end(pairPage)
    }
    if (url.pathname === '/mobile-remote/pair' && req.method === 'POST') {
      const body = await readJson(req)
      const code = String(body?.code || '')
      if (!pairingSecret || !pairingExpiresAt || pairingExpiresAt < Date.now() || !safeEqual(code, pairingSecret)) {
        return json(res, 401, { error: '配对二维码无效或已过期，请回到电脑刷新。' })
      }
      const token = randomBytes(32).toString('base64url')
      const tokenHash = hashToken(token)
      const now = Date.now()
      const id = tokenHash.slice(0, 12)
      devices.set(tokenHash, {
        id,
        name: String(req.headers['user-agent'] || '移动设备').slice(0, 120),
        pairedAt: now,
        lastSeenAt: now,
        tokenHash,
      })
      pairingSecret = null
      pairingExpiresAt = null
      pairingQrImage = null
      const result = json(res, 200, { ok: true, deviceId: id }, {
        'set-cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_TTL_SECONDS}`,
      })
      void rotatePairing().catch((error) => {
        lastError = String(error?.message || error)
        logger.warn?.('[mobile-remote] pairing rotation failed:', error)
      })
      return result
    }
    if (url.pathname === '/mobile-remote/status' && req.method === 'GET') {
      const device = requestDevice(req)
      return json(res, device ? 200 : 401, {
        paired: Boolean(device),
        device: device ? { id: device.id, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt } : null,
      })
    }
    if (!requestDevice(req)) return text(res, 401, '请先在电脑的“移动端远程”页面扫描配对二维码。')
    if (deniedPath(url.pathname, blockedPrefixes)) return text(res, 403, '此本机控制接口不允许通过移动端网关访问。')
    if (url.pathname.startsWith('/mobile-remote/')) return text(res, 404, 'not found')
    return proxyRequest(req, res)
  }

  const handleUpgrade = (req, clientSocket, head) => {
    try {
      if (!acceptedInterface(req) || !acceptedAuthority(req) || !isSameOriginRequest(req) || !requestDevice(req)) {
        clientSocket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
        return
      }
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      if (deniedPath(url.pathname, blockedPrefixes) || url.pathname.startsWith('/mobile-remote/')) {
        clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      const upstreamPort = targetPort()
      const upstreamRequest = requestHttp({
        hostname: '127.0.0.1',
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers: proxyHeaders(req, upstreamPort),
      })
      upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
        sockets.add(upstreamSocket)
        upstreamSocket.once('close', () => sockets.delete(upstreamSocket))
        writeUpgradeHead(clientSocket, upstreamResponse)
        if (upstreamHead.length) clientSocket.write(upstreamHead)
        if (head.length) upstreamSocket.write(head)
        clientSocket.pipe(upstreamSocket).pipe(clientSocket)
      })
      upstreamRequest.on('response', (upstreamResponse) => {
        writeUpgradeHead(clientSocket, upstreamResponse)
        upstreamResponse.pipe(clientSocket)
      })
      upstreamRequest.on('error', () => clientSocket.destroy())
      upstreamRequest.end()
    } catch {
      clientSocket.destroy()
    }
  }

  const start = async () => {
    if (server?.listening) return snapshot()
    lanAddress = getLanAddress?.() || null
    const upstreamPort = targetPort()
    if (!lanAddress) throw new Error('没有找到可用的局域网 IPv4 地址')
    if (!upstreamPort) throw new Error('DSH Web Server 尚未监听')
    if (upstreamPort === port) throw new Error(`DSH 主服务已占用 ${port} 端口`)
    phase = 'starting'
    detail = `正在监听 0.0.0.0:${port}…`
    lastError = null
    const nextServer = createServer((req, res) => {
      Promise.resolve(handle(req, res)).catch((error) => {
        logger.warn?.('[mobile-remote] request failed:', error)
        if (!res.headersSent) text(res, 500, '移动端网关请求失败')
        else res.destroy(error)
      })
    })
    nextServer.on('upgrade', handleUpgrade)
    nextServer.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    server = nextServer
    try {
      await new Promise((resolve, reject) => {
        nextServer.once('error', reject)
        nextServer.listen(port, '0.0.0.0', () => {
          nextServer.off('error', reject)
          resolve()
        })
      })
      phase = 'running'
      detail = `移动端网关正在监听 0.0.0.0:${port}；仅已配对设备可访问。`
      await rotatePairing()
      return snapshot()
    } catch (error) {
      lastError = String(error?.message || error)
      phase = 'error'
      detail = `启动失败：${lastError}`
      try { nextServer.close() } catch {}
      server = null
      throw error
    }
  }

  const stop = async () => {
    const active = server
    server = null
    pairingSecret = null
    pairingExpiresAt = null
    pairingQrImage = null
    devices.clear()
    if (active) {
      await new Promise((resolve) => {
        active.close(() => resolve())
        for (const socket of sockets) socket.destroy()
      })
    }
    sockets.clear()
    phase = 'stopped'
    detail = '移动端远程已停止，3082 端口已释放。'
    return snapshot()
  }

  const revokeDevice = (id) => {
    for (const [tokenHash, device] of devices) {
      if (device.id === id) devices.delete(tokenHash)
    }
    return snapshot()
  }

  return {
    snapshot,
    start,
    stop,
    rotatePairing,
    revokeDevice,
  }
}
