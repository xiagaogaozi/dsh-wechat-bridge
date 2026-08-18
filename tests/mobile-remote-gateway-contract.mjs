import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, request as requestHttp } from 'node:http'
import { connect } from 'node:net'
import { createMobileRemoteGateway } from '../remote-gateway.js'

const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => {
    server.off('error', reject)
    resolve(server.address().port)
  })
})

const close = (server) => new Promise((resolve) => server.close(resolve))

const reservePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}

const call = ({ port, path = '/', method = 'GET', headers = {}, body = '' }) => new Promise((resolve, reject) => {
  const req = requestHttp({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolve({
      status: res.statusCode,
      headers: res.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }))
  })
  req.on('error', reject)
  req.end(body)
})

const websocketHandshake = ({ port, cookie }) => new Promise((resolve, reject) => {
  const socket = connect(port, '127.0.0.1')
  let data = ''
  socket.setTimeout(5000, () => socket.destroy(new Error('WebSocket handshake timed out')))
  socket.on('connect', () => {
    socket.write([
      'GET /reader/ws HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      `Origin: http://127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      `Cookie: ${cookie}`,
      '',
      '',
    ].join('\r\n'))
  })
  socket.on('data', (chunk) => {
    data += chunk.toString('utf8')
    if (data.includes('\r\n\r\n')) {
      socket.destroy()
      resolve(data)
    }
  })
  socket.on('error', reject)
})

const upstream = createServer((req, res) => {
  if (req.url === '/') {
    const boot = {
      rev: 'upstream-rev',
      entries: [
        { id: 'dsh-plugin-desktop', url: '/plugins/dsh-plugin-desktop/client.js?rev=desktop', inject: ['dsh-plugin-desktop'] },
        { id: 'dshmarket', url: '/plugins/dshmarket/client.js?rev=market', inject: ['dsh-plugin-desktop', 'dshmarket'] },
      ],
    }
    const html = `<!doctype html><html><head><script>window.__DSH_BOOT__ = ${JSON.stringify(boot)}</script></head><body>DSH</body></html>`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }
  if (req.url === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: ok\n\n')
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ path: req.url, host: req.headers.host, origin: req.headers.origin || null }))
})
upstream.on('upgrade', (req, socket) => {
  const key = String(req.headers['sec-websocket-key'] || '')
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.end([
    'HTTP/1.1 101 Switching Protocols',
    'Connection: Upgrade',
    'Upgrade: websocket',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'))
})

const upstreamPort = await listen(upstream)
const gatewayPort = await reservePort()
let pairingUrl = null
const gateway = createMobileRemoteGateway({
  getTargetPort: () => upstreamPort,
  getLanAddress: () => '127.0.0.1',
  port: gatewayPort,
  blockedPrefixes: ['/wxb'],
  logger: { warn() {} },
  createQr: async (value) => {
    pairingUrl = value
    return `data:image/test,${encodeURIComponent(value)}`
  },
})

try {
  const started = await gateway.start()
  assert.equal(started.enabled, true)
  assert.equal(started.phase, 'running')
  assert.match(started.pairingQrImage, /^data:image\/test,/)
  assert.ok(pairingUrl)

  const baseHeaders = { host: `127.0.0.1:${gatewayPort}`, origin: `http://127.0.0.1:${gatewayPort}` }
  assert.equal((await call({ port: gatewayPort, headers: baseHeaders })).status, 401)
  assert.equal((await call({ port: gatewayPort, path: '/pair', headers: baseHeaders })).status, 200)

  const code = new URL(pairingUrl).hash.slice(1)
  const pairBody = JSON.stringify({ code })
  const paired = await call({
    port: gatewayPort,
    path: '/mobile-remote/pair',
    method: 'POST',
    headers: { ...baseHeaders, 'content-type': 'application/json', 'content-length': Buffer.byteLength(pairBody) },
    body: pairBody,
  })
  assert.equal(paired.status, 200)
  const deviceId = JSON.parse(paired.body).deviceId
  const cookie = paired.headers['set-cookie'][0].split(';', 1)[0]
  const authorizedHeaders = { ...baseHeaders, cookie }

  const home = await call({ port: gatewayPort, headers: authorizedHeaders })
  assert.equal(home.status, 200)
  assert.doesNotMatch(home.body, /dsh-plugin-desktop/)
  const boot = JSON.parse(home.body.match(/window\.__DSH_BOOT__ = (.+?)<\/script>/s)[1])
  assert.deepEqual(boot.entries, [{
    id: 'dshmarket',
    url: '/plugins/dshmarket/client.js?rev=market',
    inject: ['dshmarket'],
  }])

  const api = await call({ port: gatewayPort, path: '/api/ping', headers: authorizedHeaders })
  assert.equal(api.status, 200)
  assert.deepEqual(JSON.parse(api.body), {
    path: '/api/ping',
    host: `127.0.0.1:${upstreamPort}`,
    origin: `http://127.0.0.1:${upstreamPort}`,
  })
  assert.equal((await call({ port: gatewayPort, path: '/reader', headers: authorizedHeaders })).status, 200)
  assert.equal((await call({ port: gatewayPort, path: '/wxb/config', headers: authorizedHeaders })).status, 403)
  assert.equal((await call({ port: gatewayPort, path: '/api/settings.update', headers: authorizedHeaders })).status, 403)
  assert.equal((await call({ port: gatewayPort, path: '/api/settings%2Eupdate', headers: authorizedHeaders })).status, 403)

  const sse = await call({ port: gatewayPort, path: '/api/stream', headers: authorizedHeaders })
  assert.equal(sse.status, 200)
  assert.equal(sse.headers['content-type'], 'text/event-stream')
  assert.equal(sse.body, 'data: ok\n\n')

  const handshake = await websocketHandshake({ port: gatewayPort, cookie })
  assert.match(handshake, /^HTTP\/1\.1 101 Switching Protocols/m)

  const status = await call({ port: gatewayPort, path: '/mobile-remote/status', headers: authorizedHeaders })
  assert.equal(status.status, 200)
  assert.equal(JSON.parse(status.body).paired, true)
  assert.equal(gateway.snapshot().devices.length, 1)
  gateway.revokeDevice(deviceId)
  assert.equal((await call({ port: gatewayPort, path: '/mobile-remote/status', headers: authorizedHeaders })).status, 401)
} finally {
  await gateway.stop()
  await close(upstream)
}

assert.equal(gateway.snapshot().enabled, false)

const conflictGateway = createMobileRemoteGateway({
  getTargetPort: () => gatewayPort,
  getLanAddress: () => '127.0.0.1',
  port: gatewayPort,
  logger: { warn() {} },
  createQr: async () => 'data:image/test,conflict',
})
await assert.rejects(() => conflictGateway.start(), /DSH 主服务已占用/)
assert.equal(conflictGateway.snapshot().canStart, false)
await conflictGateway.stop()
console.log('mobile remote authenticated gateway contract: PASS')
