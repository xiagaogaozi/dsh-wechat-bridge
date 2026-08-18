/**
 * DSH WeChat Bridge — installable host-composition plugin
 * ======================================================
 * A Cordis plugin that connects a personal WeChat account (official iLink
 * protocol) to DeepSeek Harness. Runs the companion `bridge/` process,
 * exposes /wxb/* HTTP endpoints on the DSH web server, drives per-user DSH
 * agents, and attaches WeChat sessions to a dedicated "WeChat" workspace.
 *
 * Install (see README.md in this package):
 *   1. Copy this directory into the DSH profile directory
 *      (~/.dsh/profiles/web/ by default).
 *   2. Append to cordis.patch.yml:
 *        - insert:
 *            - id: dsh-wechat-bridge
 *              name: ./dsh-wechat-bridge/index.js
 *              config: {}   # optional overrides below
 *   3. Restart `dsh web`. Scan the QR shown in the Run panel / terminal.
 *
 * Config (all optional): edit them in the browser at
 *   http://127.0.0.1:3080/wxb/config  (loopback-only, same as the /qr page),
 *   or via cordis.patch.yml overrides below.
 *   bridgeDir      - directory containing bridge.js + node_modules
 *                    (default: ./bridge inside this package)
 *   wechatWsPath   - path of the "WeChat" GUI workspace; also the agents' cwd
 *                    (default: this package directory)
 *   secret         - shared token for /wxb/* endpoints
 *                    (default: dsh-wechat-bridge-local-token; loopback only)
 *   preset         - agent preset mounted for WeChat agents (default: cordis)
 *   approvalPolicy - 'never' | 'ask' (default: never — phone cannot click)
 *   base           - URL prefix for the bridge endpoints (default: /wxb)
 *   workspaceTitle - GUI workspace title (default: WeChat)
 */
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { createMobileRemoteGateway } from './remote-gateway.js'

const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))
const MOBILE_REMOTE_PORT = 3082
const LOGIN_TIMEOUT_EXIT_CODE = 75

const privateIpv4Rank = (address) => {
  if (/^192\.168\./.test(address)) return 0
  if (/^10\./.test(address)) return 1
  const match = /^172\.(\d+)\./.exec(address)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 2
  return -1
}

const preferredLanAddress = () => Object.entries(networkInterfaces())
  .flatMap(([name, entries]) => (entries || []).map((entry) => ({ name, ...entry })))
  .filter((entry) => entry.family === 'IPv4' && !entry.internal && privateIpv4Rank(entry.address) >= 0)
  .sort((left, right) => {
    const addressRank = privateIpv4Rank(left.address) - privateIpv4Rank(right.address)
    if (addressRank !== 0) return addressRank
    const virtualPattern = /docker|radmin|tailscale|vethernet|virtual|vmware|wsl/i
    return Number(virtualPattern.test(left.name)) - Number(virtualPattern.test(right.name))
  })[0]?.address || null

export default {
  inject: ['webServer', 'agents', 'timer', 'workspaceRegistry', 'sessionQuery'],
  async apply(ctx, config) {
    let cfg = config || {}
    // GUI configuration page: this namespace is rendered by the Web Settings
    // UI; saved values override composition config.
    const settingsSvc = ctx.get('settings')
    if (settingsSvc) {
      try {
        // schemastery: fields are optional by default; enums are unions of consts.
        settingsSvc.register('dsh-wechat-bridge', z.object({
          bridgeDir: z.string(),
          wechatWsPath: z.string(),
          secret: z.string(),
          preset: z.string(),
          approvalPolicy: z.union([z.const('never'), z.const('ask')]),
          base: z.string(),
          workspaceTitle: z.string(),
          targetWorkspaceId: z.string(),
          targetSessionId: z.string(),
        }), {})
        const saved = settingsSvc.get('dsh-wechat-bridge')
        if (saved && typeof saved === 'object') cfg = { ...cfg, ...saved }
      } catch (e) {
        console.error('[wechat] settings register failed:', e)
      }
    }
    const ws = ctx.get('webServer')
    const agentsSvc = ctx.get('agents')
    const sub = ctx.get('subprocess')
    const fsSvc = ctx.get('fs')
    if (!ws || !agentsSvc) {
      console.error('[wechat] webServer/agents service missing, abort')
      return
    }

    const BRIDGE_DIR = cfg.bridgeDir || (PACKAGE_DIR + 'bridge')
    const WECHAT_WS_PATH = cfg.wechatWsPath || PACKAGE_DIR.slice(0, -1)
    const WS_TITLE = cfg.workspaceTitle || 'WeChat'
    const PRESET = cfg.preset || 'cordis'
    let SECRET = cfg.secret || 'dsh-wechat-bridge-local-token'
    const BASE = cfg.base || '/wxb'
    const APPROVAL_POLICY = cfg.approvalPolicy || 'never'
    const GEN_FILE = BRIDGE_DIR + '/wechat-gen.json'
    const mobileRemote = createMobileRemoteGateway({
      getTargetPort: () => ws.port,
      getLanAddress: preferredLanAddress,
      port: MOBILE_REMOTE_PORT,
      blockedPrefixes: [BASE],
      logger: console,
    })

    const state = {
      phase: 'idle',
      detail: '插件已加载，等待 bridge 进程连接',
      qrRev: 0,
      qrState: 'none',
      qrImage: null,
      qrUrl: null,
      pairingRequired: false,
      bridgeAlive: false,
      bridgePid: null,
      lastHeartbeat: 0,
      lastExit: null,
      retryAttempt: 0,
      nextRetryMs: null,
      since: Date.now(),
    }
    const outbox = []
    let outboxCursor = 0
    const outboxWaiters = new Set()
    const userAgents = new Map()
    const retiredHandles = new Map()
    const creating = new Map()
    const recentMsgs = new Map()
    const userGen = new Map()
    const routeDisposers = []
    let selectedTarget = null
    let selectedTargetCreating = null
    let bridgeProc = null
    let bridgeStarting = false
    let bridgeRestartNonce = 0
    let restartAfterStart = false
    let stopping = false
    let suppressRestartOnExit = false

    // ---------------- WeChat workspace (GUI grouping) -----------------------
    const getWorkspaceRegistry = () => ctx.get('workspaceRegistry')
    let wechatWs = null
    const ensureWechatWorkspace = async () => {
      const wsReg = getWorkspaceRegistry()
      if (!wsReg) return null
      try {
        const existing = wsReg.list().find((w) => w.path === WECHAT_WS_PATH)
        if (existing) { wechatWs = existing; return existing }
        wechatWs = await wsReg.create(WECHAT_WS_PATH, WS_TITLE)
        console.log('[wechat] created ' + WS_TITLE + ' workspace at ' + WECHAT_WS_PATH)
        return wechatWs
      } catch (e) {
        console.error('[wechat] ensure workspace failed:', e)
        return null
      }
    }
    const attachToWechatWorkspace = async (sessionId) => {
      try {
        if (!wechatWs) await ensureWechatWorkspace()
        if (wechatWs && !wechatWs.sessionIds.includes(sessionId)) {
          await wechatWs.attachSession(sessionId)
          console.log('[wechat] attached session ' + sessionId + ' to ' + WS_TITLE + ' workspace')
        }
      } catch (e) {
        console.error('[wechat] attach session failed:', sessionId, String((e && e.message) || e).slice(0, 160))
      }
    }

    // ---------------- persisted per-user generation -------------------------
    const loadUserGen = async () => {
      if (!fsSvc) return
      try {
        const target = await fsSvc.resolve(GEN_FILE)
        const text = await fsSvc.readText(target)
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object') {
          userGen.clear()
          for (const k of Object.keys(obj)) userGen.set(k, Number(obj[k]) || 1)
        }
      } catch (e) { /* first run: no file yet */ }
    }
    const saveUserGen = () => {
      if (!fsSvc) return
      try {
        const payload = {}
        for (const [k, v] of userGen) payload[k] = v
        fsSvc.resolve(GEN_FILE).then((target) =>
          fsSvc.writeText(target, JSON.stringify(payload))
        ).catch((e) => console.error('[wechat] save gen failed:', e))
      } catch (e) { console.error('[wechat] save gen error:', e) }
    }

    const readBody = (req) => new Promise((resolve) => {
      let data = ''
      req.setEncoding('utf8')
      req.on('data', (c) => { data += c; if (data.length > 300000) { req.destroy(); resolve(null) } })
      req.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { resolve(null) } })
      req.on('error', () => resolve(null))
    })
    const sendJson = (res, code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    const authorized = (req) => String(req.headers['authorization'] || '') === 'Bearer ' + SECRET
    const queryParam = (req, name) => {
      const q = String(req.url || '').split('?')[1] || ''
      for (const pair of q.split('&')) {
        const i = pair.indexOf('=')
        const k = i >= 0 ? pair.slice(0, i) : pair
        if (k === name) {
          const v = i >= 0 ? pair.slice(i + 1) : ''
          try { return decodeURIComponent(v) } catch (e) { return v }
        }
      }
      return null
    }

    const pushOutbox = (userId, text) => {
      const id = ++outboxCursor
      outbox.push({ id, userId, text, ts: Date.now() })
      for (const w of outboxWaiters) w()
      outboxWaiters.clear()
    }

    const extractAssistantText = (events) => {
      const messageTexts = []
      for (const ev of events) {
        if (ev && ev.type === 'assistant/message' && ev.data && ev.data.message) {
          const parts = []
          const content = ev.data.message.content || []
          for (const block of content) {
            if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              parts.push(block.text)
            }
          }
          if (parts.length) messageTexts.push(parts.join('\n\n'))
        }
      }
      return messageTexts.length ? messageTexts[messageTexts.length - 1].trim() : ''
    }
    let msgSeq = 0
    const makeUserMessage = (text) => ({
      id: 'wxm-' + Date.now() + '-' + (++msgSeq),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })

    // Name a conversation from its first meaningful user question.
    const GREETINGS = /^(你好|您好|hi|hello|嗨|在吗|在么|hey|哈喽|早上好|晚上好|下午好|你好呀|在不在|测试|test)[!！。.？?~～\s]*$/i
    const summarizeTitle = (text) => {
      const t = String(text || '').replace(/\s+/g, ' ').trim()
      if (!t || t.startsWith('[收到') || t.length < 4 || GREETINGS.test(t)) return null
      return t.length > 24 ? t.slice(0, 24) + '…' : t
    }

    const driveUser = async (userId) => {
      const entry = userAgents.get(userId)
      if (!entry || entry.busy) return
      entry.busy = true
      try {
        while (entry.queue.length) {
          const m = entry.queue.shift()
          const agent = entry.handle.agent
          if (!entry.named) {
            const topic = summarizeTitle(m.text)
            if (topic) {
              entry.named = true
              const titleSvc = ctx.get('sessionTitle')
              if (titleSvc) {
                try {
                  titleSvc.rename(agent.session, '微信 · ' + topic)
                } catch (e) {}
              }
            }
          }
          const beforeSeq = agent.session.seq
          agent.followup(makeUserMessage(m.text))
          await agent.whenIdle()
          const events = agent.session.events.slice(beforeSeq)
          const text = extractAssistantText(events)
          pushOutbox(userId, text ? text : '（已完成，没有生成文本输出）')
        }
      } catch (err) {
        pushOutbox(userId, '抱歉，处理你的消息时出错了：' + String((err && err.message) || err).slice(0, 300))
      } finally {
        entry.busy = false
      }
    }

    const defaultAgentOptions = () => {
      let agentOptions = {}
      const defModel = ctx.get('agentDefaultModel')
      if (defModel) {
        try {
          const sel = defModel.currentSelection()
          if (sel && sel.provider && sel.model) {
            agentOptions = { provider: sel.provider, model: sel.model }
          }
        } catch (e) { console.error('[wechat] default model read failed:', e) }
      }
      return agentOptions
    }
    const presetSetup = async (agentCtx) => {
      const presets = ctx.get('agentPresets')
      if (presets) await presets.mount(agentCtx, PRESET)
    }
    const postCreate = (handle, userId, sessionId, gen) => {
      const approvalSvc = ctx.get('approval')
      if (approvalSvc) {
        try { approvalSvc.setPolicy(handle.agent, APPROVAL_POLICY) } catch (e) { console.error('[wechat] setPolicy failed:', e) }
      }
      const titleSvc = ctx.get('sessionTitle')
      if (titleSvc) {
        try {
          titleSvc.rename(handle.agent.session, '微信 · 新对话')
        } catch (e) {}
      }
      userAgents.set(userId, { userId, handle, queue: [], busy: false, named: false, gen })
      state.detail = '已为 ' + userId + ' 创建会话 ' + sessionId
      attachToWechatWorkspace(handle.agent.session.id)
    }

    const sessionIdFor = (userId) => {
      const base = 'wechat-' + userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      const gen = userGen.get(userId) || 1
      return { id: gen > 1 ? base + '-g' + gen : base, gen }
    }

    const createAgentFor = async (userId) => {
      const { id: sessionId, gen } = sessionIdFor(userId)
      const agentOptions = defaultAgentOptions()
      let handle = null
      try {
        handle = await agentsSvc.resume({
          resumeSessionId: sessionId,
          agentOptions,
          setup: presetSetup,
        })
      } catch (errResume) {
        try {
          handle = await agentsSvc.create({
            sessionId,
            meta: { cwd: WECHAT_WS_PATH, agentPreset: PRESET },
            agentOptions,
            setup: presetSetup,
          })
        } catch (errCreate) {
          const uniqueId = sessionId + '-' + Date.now().toString(36).slice(-6)
          handle = await agentsSvc.create({
            sessionId: uniqueId,
            meta: { cwd: WECHAT_WS_PATH, agentPreset: PRESET },
            agentOptions,
            setup: presetSetup,
          })
          console.error('[wechat] resume/create collided, used unique id:', uniqueId, errCreate)
        }
      }
      postCreate(handle, userId, handle.agent.id, gen)
    }

    // ---------------- /history: list and view past conversations ------------
    const genOf = (id, base) => {
      if (id === base) return 1
      const m = /-g([0-9]+)$/.exec(String(id))
      return m ? Number(m[1]) : 1
    }
    const truncate = (s, n) => {
      const t = String(s || '').replace(/\s+/g, ' ').trim()
      return t.length > n ? t.slice(0, n) + '…' : t
    }
    const mySessions = async (userId) => {
      const q = ctx.get('sessionQuery')
      if (!q) return null
      const base = 'wechat-' + userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
      const sessions = await q.listSessions()
      return sessions
        .map((r) => r.header)
        .filter((h) => h && (h.id === base || (h.id && h.id.startsWith(base + '-g'))))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    }
    const handleHistory = async (userId, arg) => {
      const q = ctx.get('sessionQuery')
      if (!q) return '会话查询服务不可用。'
      try {
        const base = 'wechat-' + userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
        const mine = await mySessions(userId)
        if (!mine || !mine.length) return '暂无历史会话。发送 /new 会开启新的对话，旧对话自动保存，可用 /history 回看。'
        if (arg) {
          const n = Number(arg)
          if (!n || n < 1 || n > mine.length) return '没有第 ' + arg + ' 个会话（共 ' + mine.length + ' 个）。'
          const h = mine[n - 1]
          const snap = await q.readSession(h.id)
          const gen = genOf(h.id, base)
          const lines = []
          for (const ev of (snap.events || [])) {
            if (ev && ev.type === 'user/message' && ev.data && ev.data.source && ev.data.source.kind === 'user') {
              for (const b of (ev.data.content || [])) if (b && b.type === 'text' && b.text && b.text.trim()) lines.push('我: ' + truncate(b.text, 120))
            } else if (ev && ev.type === 'assistant/message' && ev.data && ev.data.message) {
              for (const b of ((ev.data.message.content) || [])) if (b && b.type === 'text' && b.text && b.text.trim()) lines.push('AI: ' + truncate(b.text, 240))
            }
          }
          const tail = lines.slice(-20)
          return '—— 第' + gen + '轮对话（最近 ' + tail.length + ' 条）——\n' + tail.join('\n')
        }
        const lines = ['你的历史会话（/new 不会删除旧对话）：']
        mine.forEach((h, i) => {
          const gen = genOf(h.id, base)
          const t = new Date(h.createdAt || 0)
          const ts = t.toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          lines.push('[' + (i + 1) + '] 第' + gen + '轮 · ' + ts)
        })
        lines.push('回复「/history 数字」查看对应对话内容。')
        return lines.join('\n')
      } catch (e) {
        return '查询失败：' + String((e && e.message) || e).slice(0, 200)
      }
    }

    const handleInbound = async (m) => {
      const userId = String(m.userId || '').slice(0, 200)
      const text = String(m.text || '').slice(0, 4000)
      const media = (m && m.media && m.media.path) ? m.media : null

      const trimmed = text.trim()
      const targetState = selectedTargetState()
      if (targetState.kind === 'invalid') {
        pushOutbox(userId, targetState.error)
        return
      }
      if (!media && (trimmed === '/new' || trimmed === '/重置')) {
        if (targetState.kind === 'selected') {
          pushOutbox(userId, '当前微信已绑定到指定 DSH 对话，/new 不会新建或替换该对话。请在「微信桥接」设置中改选目标对话。')
          return
        }
        const old = userAgents.get(userId)
        if (old) {
          userAgents.delete(userId)
          retiredHandles.set(userId, old)
          state.users = Array.from(userAgents.keys())
        }
        userGen.set(userId, (userGen.get(userId) || 1) + 1)
        saveUserGen()
        pushOutbox(userId, '已开启新的对话 ✅（第' + (userGen.get(userId) || 1) + '轮）\n旧对话完整保留，回复「/history」可查看历史。')
        return
      }
      if (!media && (trimmed === '/history' || trimmed === '/历史' || trimmed.startsWith('/history ') || trimmed.startsWith('/历史 '))) {
        if (targetState.kind === 'selected') {
          pushOutbox(userId, '当前微信已绑定到指定 DSH 对话，请直接在 DSH 对话列表中查看其历史记录。')
          return
        }
        const parts = trimmed.split(/\s+/)
        const arg = parts.length > 1 ? parts[1] : ''
        const reply = await handleHistory(userId, arg)
        pushOutbox(userId, reply)
        return
      }
      if (!media && (trimmed === '/help' || trimmed === '/帮助')) {
        pushOutbox(userId, targetState.kind === 'selected'
          ? '当前消息会发送到已选定的 DSH 对话。\n在 DSH 的「微信桥接」设置页可修改工作区和目标对话。\n/help - 显示本帮助'
          : '可用命令：\n/new - 开启新对话（旧对话保留）\n/history - 查看历史对话\n/history 数字 - 查看对应对话内容\n/help - 显示本帮助\n其他消息直接和我对话即可。')
        return
      }

      let fullText = text
      if (media) {
        const kindLabel = media.type === 'image' ? '图片' : media.type === 'file' ? '文件' : media.type === 'voice' ? '语音' : media.type === 'video' ? '视频' : '媒体'
        const nameDesc = media.fileName ? '（' + String(media.fileName) + '）' : ''
        const desc = '[收到' + kindLabel + nameDesc + '，文件路径：' + String(media.path) + ']'
        fullText = text.trim() ? text + '\n' + desc : desc
      }
      if (!userId || (!fullText.trim() && !media)) return
      const key = String(m.msgId || (userId + '|' + text + '|' + m.ts))
      if (recentMsgs.has(key)) return
      recentMsgs.set(key, Date.now())
      if (recentMsgs.size > 600) {
        for (const [k, t] of recentMsgs) if (Date.now() - t > 300000) recentMsgs.delete(k)
      }
      if (targetState.kind === 'selected') {
        try {
          const entry = await getSelectedTarget(targetState.sessionId)
          entry.queue.push({ userId, text: fullText })
          void driveSelectedTarget(entry)
        } catch (err) {
          console.error('[wechat] selected target unavailable:', err)
          pushOutbox(userId, '目标对话不可用：' + String((err && err.message) || err).slice(0, 240))
        }
        return
      }
      let entry = userAgents.get(userId)
      if (!entry) {
        try {
          if (!creating.has(userId)) {
            creating.set(userId, createAgentFor(userId).finally(() => creating.delete(userId)))
          }
          await creating.get(userId)
        } catch (err) {
          console.error('[wechat] agent create failed:', err)
          pushOutbox(userId, '初始化会话失败：' + String((err && err.message) || err).slice(0, 200))
          return
        }
        entry = userAgents.get(userId)
        if (!entry) return
      }
      entry.queue.push({ userId, text: fullText })
      driveUser(userId)
    }

    const onBridgeEvent = (body) => {
      const t = String(body.type || '')
      if (t === 'qr') {
        state.qrRev += 1
        state.qrImage = body.image ? String(body.image) : null
        state.qrUrl = body.url ? String(body.url) : null
        state.qrState = 'waiting'
        state.pairingRequired = false
        state.nextRetryMs = null
        state.phase = 'waiting-qr'
        state.detail = '请用手机微信扫描二维码登录（建议使用小号）'
      } else if (t === 'scanned') {
        state.qrState = 'scanned'
        state.pairingRequired = false
        state.detail = '已扫码，请在手机上确认登录'
      } else if (t === 'qr-expired') {
        state.qrState = 'expired'
        state.detail = '二维码已过期，bridge 正在获取新二维码…'
      } else if (t === 'logged-in') {
        state.qrState = 'online'
        state.pairingRequired = false
        state.retryAttempt = 0
        state.nextRetryMs = null
        state.phase = 'online'
        state.detail = '微信登录成功，在线监听中（account=' + String(body.accountId || '') + '）'
      } else if (t === 'heartbeat') {
        state.lastHeartbeat = Date.now()
        state.bridgeAlive = true
        state.bridgePid = Number(body.pid) || state.bridgePid
      } else if (t === 'bridge-start') {
        state.bridgeAlive = true
        state.bridgePid = Number(body.pid) || null
        state.lastExit = null
        if (state.phase !== 'waiting-qr') { state.phase = 'connecting'; state.detail = 'bridge 进程已启动，正在登录微信…' }
      } else if (t === 'login-retry') {
        const delayMs = Number(body.delayMs)
        state.bridgeAlive = true
        state.phase = 'waiting-qr'
        state.nextRetryMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : null
        state.detail = '微信登录请求超时，bridge 保持运行并将在短暂等待后刷新二维码'
      } else if (t === 'login-timeout') {
        suppressRestartOnExit = true
        state.bridgeAlive = false
        state.bridgePid = null
        state.phase = 'idle'
        state.qrState = 'expired'
        state.qrImage = null
        state.qrUrl = null
        state.nextRetryMs = null
        state.detail = '微信登录请求超时，bridge 已停止。点击“重新获取二维码”后才会重新启动。'
      } else if (t === 'bridge-stop') {
        state.bridgeAlive = false
        state.detail = 'bridge 已停止'
      } else if (t === 'fatal') {
        state.bridgeAlive = false
        state.phase = 'error'
        state.detail = 'bridge 错误：' + String(body.message || '').slice(0, 300)
      } else if (t === 'bot-error') {
        state.detail = '微信错误：' + String(body.message || '').slice(0, 200)
      } else if (t === 'session-expired') {
        state.phase = 'expired'
        state.detail = '会话过期，bridge 正在重新登录…'
      } else if (t === 'session-restored' || t === 'poll-start') {
        state.pairingRequired = false
        state.retryAttempt = 0
        state.nextRetryMs = null
        state.phase = 'online'
        state.detail = '在线监听中'
      } else if (t === 'verify-code-required') {
        state.pairingRequired = true
        state.phase = 'waiting-pair-code'
        state.detail = '请在 Desktop 设置页输入手机微信显示的配对码'
      }
    }

    const statusSnapshot = () => ({
      phase: state.phase,
      detail: state.detail,
      qrRev: state.qrRev,
      qrState: state.qrState,
      bridgeAlive: state.bridgeAlive,
      bridgePid: state.bridgePid,
      pairingRequired: state.pairingRequired,
      lastExit: state.lastExit,
      retryAttempt: state.retryAttempt,
      nextRetryMs: state.nextRetryMs,
      users: Array.from(userAgents.keys()),
      outboxDepth: outbox.length,
      since: state.since,
      target: targetSnapshot(),
    })

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/inbound', handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const body = await readBody(req)
      if (!body) return sendJson(res, 400, { error: 'bad json' })
      handleInbound(body)
      sendJson(res, 200, { ok: true })
    }}))

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/event', handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const body = await readBody(req)
      if (!body) return sendJson(res, 400, { error: 'bad json' })
      onBridgeEvent(body)
      sendJson(res, 200, { ok: true })
    }}))

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/outbox', handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const since = Number(queryParam(req, 'since') || 0)
      let pending = outbox.filter((m) => m.id > since)
      if (!pending.length) {
        await new Promise((resolve) => {
          const waiter = () => resolve()
          outboxWaiters.add(waiter)
          ctx.timeout(() => { outboxWaiters.delete(waiter); resolve() }, 25000)
        })
        pending = outbox.filter((m) => m.id > since)
      }
      if (pending.length) {
        const lastId = pending[pending.length - 1].id
        const keep = outbox.filter((m) => m.id > lastId)
        outbox.length = 0
        for (const k of keep) outbox.push(k)
      }
      sendJson(res, 200, { messages: pending, cursor: outboxCursor })
    }}))

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/status', handler: async (req, res) => {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      sendJson(res, 200, statusSnapshot())
    }}))

    // Desktop renders this through the regular DSH client-plugin surface.  The
    // QR image and pairing action stay loopback-only: the bridge is a personal
    // WeChat login, so neither should be exposed by a remote Web profile.
    const isLoopbackRequest = (req) => {
      const address = String((req.socket && req.socket.remoteAddress) || '').toLowerCase()
      return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
    }
    const desktopSnapshot = () => ({
      ...statusSnapshot(),
      qrImage: state.qrImage,
      qrUrl: state.qrUrl,
      mobileRemote: mobileRemote.snapshot(),
    })
    const submitPairingCode = (raw) => {
      const code = String(raw || '').trim()
      if (!state.pairingRequired) return { ok: false, error: '当前没有等待输入的配对码' }
      if (!code || code.length > 128 || /[\r\n]/.test(code)) return { ok: false, error: '配对码格式无效' }
      const input = bridgeProc && bridgeProc.stdin
      if (!input || input.destroyed || !input.writable) return { ok: false, error: 'bridge 当前不能接收配对码，请重启 bridge 后重试' }
      try {
        input.write(code + '\n')
        state.pairingRequired = false
        state.detail = '配对码已提交，等待微信确认…'
        return { ok: true }
      } catch (err) {
        return { ok: false, error: '提交配对码失败：' + String((err && err.message) || err).slice(0, 200) }
      }
    }

    // ---------------- optional selected DSH target ---------------------------
    // By default every WeChat user gets a private bridge-owned session.  A
    // user may instead opt into one existing, idle DSH session through the
    // Desktop settings page.  We never attach/move that chosen session: its
    // workspace ownership and its original agent setup stay untouched.
    const asTargetId = (value) => String(value || '').trim().slice(0, 200)
    const targetSelection = () => ({
      workspaceId: asTargetId(cfg.targetWorkspaceId),
      sessionId: asTargetId(cfg.targetSessionId),
    })
    const targetSnapshot = () => {
      const target = targetSelection()
      return {
        ...target,
        mode: target.sessionId ? 'selected-session' : 'per-user-session',
      }
    }
    const findWorkspace = (workspaceId) => {
      const wsReg = getWorkspaceRegistry()
      if (!wsReg || !workspaceId) return null
      if (typeof wsReg.get === 'function') return wsReg.get(workspaceId) || null
      return wsReg.list().find((workspace) => workspace.id === workspaceId) || null
    }
    const selectedTargetState = () => {
      const target = targetSelection()
      if (!target.sessionId) return { kind: 'default' }
      if (!target.workspaceId) return { kind: 'invalid', error: '微信桥接的目标工作区未设置，请在设置页重新选择。' }
      const workspace = findWorkspace(target.workspaceId)
      if (!workspace) return { kind: 'invalid', error: '已选择的 DSH 工作区不存在，请在设置页重新选择。' }
      if (!workspace.sessionIds.includes(target.sessionId)) {
        return { kind: 'invalid', error: '已选择的 DSH 对话不属于该工作区，请在设置页重新选择。' }
      }
      const wsReg = getWorkspaceRegistry()
      if (wsReg?.archivedSessionIds && wsReg.archivedSessionIds.includes(target.sessionId)) {
        return { kind: 'invalid', error: '已选择的 DSH 对话已归档，不能接收微信消息。' }
      }
      return { kind: 'selected', workspace, sessionId: target.sessionId }
    }
    const listTargetWorkspaces = async () => {
      const wsReg = getWorkspaceRegistry()
      if (!wsReg) return { workspaces: [], target: targetSnapshot(), unavailable: 'DSH 工作区服务不可用。' }
      const archived = new Set(wsReg.archivedSessionIds || [])
      return {
        workspaces: wsReg.list().map((workspace) => ({
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionCount: workspace.sessionIds.filter((id) => !archived.has(id)).length,
        })),
        target: targetSnapshot(),
      }
    }
    const listTargetSessions = async (rawWorkspaceId) => {
      const workspaceId = asTargetId(rawWorkspaceId)
      const wsReg = getWorkspaceRegistry()
      if (!wsReg) throw new Error('DSH 工作区服务不可用。')
      const workspace = findWorkspace(workspaceId)
      if (!workspace) throw new Error('工作区不存在或已被移除。')
      const q = ctx.get('sessionQuery')
      if (!q) throw new Error('DSH 会话查询服务不可用。')
      const archived = new Set(wsReg.archivedSessionIds || [])
      const records = await q.listSessions()
      const byId = new Map(records.map((record) => [record.header.id, record]))
      const sessions = await Promise.all(workspace.sessionIds
        .filter((id) => !archived.has(id))
        .map(async (id) => {
          const record = byId.get(id)
          let title = ''
          try {
            const titleSnapshot = await q.readTitle(id)
            title = titleSnapshot && titleSnapshot.title ? String(titleSnapshot.title) : ''
          } catch (e) {}
          const live = agentsSvc.get(id)
          return {
            id,
            title,
            createdAt: record && record.header ? record.header.createdAt : 0,
            running: Boolean(live && (!selectedTarget || selectedTarget.sessionId !== id)),
          }
        }))
      return { workspaceId, sessions, target: targetSnapshot() }
    }
    const disposeSelectedTarget = (entry) => {
      if (!entry || entry.disposed) return
      entry.disposed = true
      entry.handle.dispose().catch((e) => console.error('[wechat] selected target dispose failed:', e))
    }
    const retireSelectedTarget = () => {
      const entry = selectedTarget
      selectedTarget = null
      if (!entry) return
      entry.retired = true
      if (!entry.busy) disposeSelectedTarget(entry)
    }
    const saveTargetSelection = async (rawWorkspaceId, rawSessionId) => {
      const workspaceId = asTargetId(rawWorkspaceId)
      const sessionId = asTargetId(rawSessionId)
      const wsReg = getWorkspaceRegistry()
      if (sessionId && !workspaceId) throw new Error('请先选择目标工作区。')
      if (workspaceId && !findWorkspace(workspaceId)) throw new Error('目标工作区不存在或已被移除。')
      if (sessionId) {
        const workspace = findWorkspace(workspaceId)
        if (!workspace || !workspace.sessionIds.includes(sessionId)) throw new Error('目标对话不属于所选工作区。')
        if (wsReg?.archivedSessionIds && wsReg.archivedSessionIds.includes(sessionId)) throw new Error('已归档对话不能作为微信目标。')
        if (agentsSvc.get(sessionId)) throw new Error('目标对话正在运行。请等待它完成后再绑定，微信桥接不会打断正在执行的任务。')
      }
      if (!settingsSvc) throw new Error('DSH 设置服务不可用，无法保存转发目标。')
      await settingsSvc.update('dsh-wechat-bridge', { targetWorkspaceId: workspaceId, targetSessionId: sessionId })
      cfg = { ...cfg, targetWorkspaceId: workspaceId, targetSessionId: sessionId }
      retireSelectedTarget()
      return targetSnapshot()
    }
    const driveSelectedTarget = async (entry) => {
      if (entry.busy) return
      entry.busy = true
      try {
        while (entry.queue.length) {
          const message = entry.queue.shift()
          try {
            const agent = entry.handle.agent
            const beforeSeq = agent.session.seq
            agent.followup(makeUserMessage(message.text))
            await agent.whenIdle()
            const text = extractAssistantText(agent.session.events.slice(beforeSeq))
            pushOutbox(message.userId, text ? text : '（已完成，没有生成文本输出）')
          } catch (err) {
            pushOutbox(message.userId, '抱歉，处理你的消息时出错了：' + String((err && err.message) || err).slice(0, 300))
          }
        }
      } finally {
        entry.busy = false
        if (entry.retired) disposeSelectedTarget(entry)
      }
    }
    const getSelectedTarget = async (sessionId) => {
      if (selectedTarget && selectedTarget.sessionId === sessionId && !selectedTarget.disposed) return selectedTarget
      if (selectedTargetCreating) return selectedTargetCreating
      const creatingTarget = (async () => {
        const live = agentsSvc.get(sessionId)
        if (live) throw new Error('目标对话正在运行，微信消息没有写入。请等待当前任务结束后再发送。')
        // Resume without a preset/model override: this is the user's existing
        // conversation, so its saved agent setup remains authoritative.
        const handle = await agentsSvc.resume({ resumeSessionId: sessionId })
        const entry = { sessionId, handle, queue: [], busy: false, retired: false, disposed: false }
        if (targetSelection().sessionId !== sessionId) {
          entry.retired = true
          disposeSelectedTarget(entry)
          throw new Error('转发目标已变更，请重新发送消息。')
        }
        selectedTarget = entry
        return entry
      })()
      selectedTargetCreating = creatingTarget
      try {
        return await creatingTarget
      } finally {
        if (selectedTargetCreating === creatingTarget) selectedTargetCreating = null
      }
    }
    routeDisposers.push(ws.register({ kind: 'exact', path: '/plugins/dsh-wechat-bridge/desktop', handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'Desktop pairing controls are available only from this computer' })
      if (req.method === 'GET') return sendJson(res, 200, desktopSnapshot())
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'GET, POST' })
        return res.end()
      }
      const body = await readBody(req)
      const action = String(body && body.action || '')
      if (action === 'start-mobile-remote') {
        try {
          await mobileRemote.start()
          return sendJson(res, 200, { ok: true, snapshot: desktopSnapshot() })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: '启动移动端远程失败：' + String((err && err.message) || err).slice(0, 240), snapshot: desktopSnapshot() })
        }
      }
      if (action === 'stop-mobile-remote') {
        try {
          await mobileRemote.stop()
          return sendJson(res, 200, { ok: true, snapshot: desktopSnapshot() })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: '停止移动端远程失败：' + String((err && err.message) || err).slice(0, 240), snapshot: desktopSnapshot() })
        }
      }
      if (action === 'refresh-mobile-pairing') {
        try {
          await mobileRemote.rotatePairing()
          return sendJson(res, 200, { ok: true, snapshot: desktopSnapshot() })
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: '刷新移动端配对失败：' + String((err && err.message) || err).slice(0, 240), snapshot: desktopSnapshot() })
        }
      }
      if (action === 'revoke-mobile-device') {
        mobileRemote.revokeDevice(String(body && body.deviceId || '').slice(0, 64))
        return sendJson(res, 200, { ok: true, snapshot: desktopSnapshot() })
      }
      if (action === 'list-targets') {
        try {
          return sendJson(res, 200, { ok: true, ...(await listTargetWorkspaces()) })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: '读取工作区失败：' + String((err && err.message) || err).slice(0, 200) })
        }
      }
      if (action === 'list-target-sessions') {
        try {
          return sendJson(res, 200, { ok: true, ...(await listTargetSessions(body && body.workspaceId)) })
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: '读取对话失败：' + String((err && err.message) || err).slice(0, 200) })
        }
      }
      if (action === 'save-target') {
        try {
          const target = await saveTargetSelection(body && body.workspaceId, body && body.sessionId)
          return sendJson(res, 200, { ok: true, target, snapshot: desktopSnapshot() })
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: '保存转发目标失败：' + String((err && err.message) || err).slice(0, 200), target: targetSnapshot() })
        }
      }
      if (action === 'restart-bridge') {
        restartBridge()
        return sendJson(res, 200, { ok: true, snapshot: desktopSnapshot() })
      }
      if (action === 'submit-pairing-code') {
        const result = submitPairingCode(body && body.code)
        return sendJson(res, result.ok ? 200 : 400, { ...result, snapshot: desktopSnapshot() })
      }
      return sendJson(res, 400, { ok: false, error: 'unknown action' })
    }}))

    // Browser page showing the login QR — the host install has no GUI panel,
    // so this is how the user scans on first login. Also shows live status.
    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/qr', handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'WeChat QR is available only from this computer' })
      const phase = state.phase
      const img = state.qrImage
      const url = state.qrUrl
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>WeChat Bridge</title>'
        + '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;padding:40px;gap:14px}'
        + '.card{background:#1d1d1d;border:1px solid #333;border-radius:12px;padding:28px;text-align:center;max-width:420px}'
        + 'h1{font-size:20px;margin:0 0 6px}.badge{display:inline-block;padding:3px 12px;border-radius:999px;font-size:13px;margin-bottom:14px}'
        + '.online{background:#123b22;color:#4ade80}.waiting{background:#3b2d12;color:#fbbf24}'
        + '.offline{background:#3b1216;color:#f87171}'
        + 'img{width:260px;height:260px;border-radius:10px;border:1px solid #444;background:#fff;padding:8px}'
        + 'a{color:#7dd3fc}.muted{color:#999;font-size:13px}</style></head><body>'
        + '<div class="card"><h1>📱 WeChat Bridge</h1>'
        + '<span class="badge ' + (phase === 'online' ? 'online' : phase === 'waiting-qr' || phase === 'scanned' ? 'waiting' : 'offline') + '">'
        + (phase === 'online' ? '在线' : phase === 'waiting-qr' ? '等待扫码' : phase === 'scanned' ? '已扫码，请在手机确认' : phase === 'error' ? '错误' : phase) + '</span><br>'
        + (img ? '<img src="' + img + '" alt="微信登录二维码">' : '<p class="muted">暂无二维码</p>')
        + (url ? '<p class="muted">链接：<a href="' + url + '">' + url.slice(0, 60) + '…</a></p>' : '')
        + '<p class="muted">状态：' + String(state.detail || '') + '</p></div>'
        + '</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    }}))

    // ---------------- self-contained config page (host installs) -------------
    // The native Web Settings page only renders namespaces whitelisted in the
    // DSH core apiproxy, and third-party host plugins have no client half, so
    // their namespaces are not exposed there (the core even documents that as
    // deferred work). To keep configuration GUI-editable after a host install
    // without touching core packages, this plugin serves its own browser page
    // on the DSH web server — same loopback-only policy as the /qr page.
    const CONFIG_KEYS = ['bridgeDir', 'wechatWsPath', 'secret', 'preset', 'approvalPolicy', 'base', 'workspaceTitle']
    const currentConfig = () => {
      const out = {}
      for (const k of CONFIG_KEYS) {
        const v = cfg[k]
        out[k] = v === undefined || v === null ? '' : String(v)
      }
      return out
    }
    const sanitizePatch = (raw) => {
      const patch = {}
      const src = raw && typeof raw === 'object' ? raw : {}
      for (const k of CONFIG_KEYS) {
        const v = src[k]
        if (v === undefined || v === null) continue
        const s = String(v).trim()
        if (s === '') continue // empty means "use default", falls back on restart
        if (k === 'approvalPolicy' && s !== 'never' && s !== 'ask') continue
        patch[k] = s
      }
      return patch
    }
    const configPageHtml = () => {
      const fields = [
        ['bridgeDir', 'bridge 目录', 'text', 'bridge.js 所在目录（默认：本插件包内 ./bridge）'],
        ['wechatWsPath', '微信工作区路径', 'text', 'WeChat 工作区/代理 cwd（默认：插件包目录）'],
        ['secret', '接口密钥', 'password', '/wxb/* 端点共享令牌（默认 dsh-wechat-bridge-local-token）'],
        ['preset', 'Agent 预设', 'text', '微信代理挂载的预设（默认 cordis）'],
        ['approvalPolicy', '审批策略', 'select', 'never=手机无法点击审批，自动放行；ask=需要审批'],
        ['base', 'URL 前缀', 'text', '/wxb/* 路由前缀（默认 /wxb，修改后需重启 DSH）'],
        ['workspaceTitle', '工作区标题', 'text', 'GUI 中 WeChat 工作区的显示名（默认 WeChat）'],
      ]
      const rows = fields.map(([k, label, type, hint]) => {
        const control = type === 'select'
          ? '<select id="f-' + k + '"><option value="never">never（推荐，手机端免审批）</option><option value="ask">ask</option></select>'
          : '<input id="f-' + k + '" type="' + type + '" spellcheck="false">'
        return '<label class="row"><span class="lab">' + label + '</span>' + control + '<span class="hint">' + hint + '</span></label>'
      }).join('')
      return '<!doctype html><html><head><meta charset="utf-8"><title>WeChat Bridge 配置</title>'
        + '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:32px 16px;display:flex;flex-direction:column;align-items:center}'
        + '.card{background:#1d1d1d;border:1px solid #333;border-radius:12px;padding:24px 28px;max-width:560px;width:100%}'
        + 'h1{font-size:20px;margin:0 0 4px}h1 span{font-size:13px;color:#888;font-weight:400;margin-left:8px}'
        + '.row{display:flex;flex-direction:column;gap:4px;margin:14px 0}.lab{font-size:13px;color:#bbb;font-weight:600}'
        + 'input,select{background:#111;border:1px solid #333;border-radius:8px;color:#eee;padding:8px 10px;font-size:14px;font-family:inherit}'
        + 'input:focus,select:focus{outline:none;border-color:#4f8cff}'
        + '.hint{font-size:12px;color:#777}.bar{display:flex;align-items:center;gap:10px;margin-top:18px}'
        + 'button{background:#2563eb;border:0;border-radius:8px;color:#fff;padding:9px 20px;font-size:14px;cursor:pointer}'
        + 'button.ghost{background:transparent;border:1px solid #444;color:#bbb}button.ghost:hover{color:#eee;border-color:#666}'
        + 'button:disabled{opacity:.5;cursor:default}'
        + '#msg{font-size:13px;min-height:20px}#msg.ok{color:#4ade80}#msg.err{color:#f87171}'
        + '.status{margin-top:16px;padding-top:14px;border-top:1px solid #2a2a2a;font-size:13px;color:#999;line-height:1.7}'
        + '.warn{background:#3b2d12;color:#fbbf24;border-radius:8px;padding:8px 12px;font-size:13px;margin-top:14px}'
        + '</style></head><body><div class="card">'
        + '<h1>📱 WeChat Bridge 配置<span>host 安装版 · 修改保存后自动重启 bridge</span></h1>'
        + '<div class="warn">仅「接口密钥」保存后立即生效（bridge 自动重启）；其余字段保存后需重启 DSH web 才完全生效。</div>'
        + rows
        + '<div class="bar"><button id="save">保存配置</button><button id="reset" class="ghost">恢复默认</button><span id="msg"></span></div>'
        + '<div class="status" id="status">加载中…</div>'
        + '</div>'
        + '<script>'
        + 'const K=' + JSON.stringify(CONFIG_KEYS) + ';'
        + 'async function j(u,o){const r=await fetch(u,o);const t=await r.text();try{return JSON.parse(t)}catch(e){return {error:t}}}'
        + 'async function load(){const d=await j("' + BASE + '/config.json");if(d&&d.config){for(const k of K){const el=document.getElementById("f-"+k);if(!el)continue;if(el.tagName==="SELECT")el.value=d.config[k]||"never";else el.value=d.config[k]||""}}'
        + 'const s=d&&d.effective;document.getElementById("status").textContent=s?("状态："+(s.phase||"")+" · "+(s.detail||"")+" · 在线用户："+((s.users||[]).length)+" · bridge："+(s.bridgeAlive?"运行中 (pid "+s.bridgePid+")":"未运行")):"状态不可用";}'
        + 'document.getElementById("save").onclick=async()=>{const btn=document.getElementById("save"),msg=document.getElementById("msg");btn.disabled=true;msg.textContent="保存中…";msg.className="";'
        + 'const values={};for(const k of K){const el=document.getElementById("f-"+k);if(!el)continue;values[k]=el.value}'
        + 'const d=await j("' + BASE + '/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({values})});'
        + 'if(d&&d.ok){msg.textContent="已保存 ✅"+(d.needsRestart&&d.needsRestart.length?"（以下项需重启 DSH："+d.needsRestart.join("、")+"）":"")+"，bridge 已自动重启";msg.className="ok";await load();}'
        + 'else{msg.textContent="保存失败："+((d&&d.error)||"未知错误");msg.className="err";}btn.disabled=false;};'
        + 'document.getElementById("reset").onclick=async()=>{const btn=document.getElementById("reset"),msg=document.getElementById("msg");btn.disabled=true;msg.textContent="重置中…";msg.className="";'
        + 'const d=await j("' + BASE + '/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reset:true})});'
        + 'if(d&&d.ok){msg.textContent="已恢复默认 ✅（base/bridgeDir/wechatWsPath 需重启 DSH）";msg.className="ok";await load();}'
        + 'else{msg.textContent="重置失败："+((d&&d.error)||"未知错误");msg.className="err";}btn.disabled=false;};'
        + 'load();'
        + '</script></body></html>'
    }

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/config.json', handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'WeChat configuration is available only from this computer' })
      sendJson(res, 200, { config: currentConfig(), effective: statusSnapshot() })
    }}))

    routeDisposers.push(ws.register({ kind: 'exact', path: BASE + '/config', handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: 'WeChat configuration is available only from this computer' })
      if (req.method === 'POST') {
        const body = await readBody(req)
        if (body && body.reset) {
          // Restore composition defaults: drop every saved override.
          try {
            const before = currentConfig()
            if (settingsSvc) await settingsSvc.replace('dsh-wechat-bridge', {})
            cfg = { ...(config || {}) }
            SECRET = cfg.secret || 'dsh-wechat-bridge-local-token'
            const after = currentConfig()
            const changed = CONFIG_KEYS.filter((k) => (before[k] || '') !== (after[k] || ''))
            const needsRestart = changed.filter((k) => k !== 'secret')
            if (changed.includes('secret')) restartBridge()
            console.log('[wechat] config reset to defaults via /wxb/config')
            return sendJson(res, 200, { ok: true, config: after, needsRestart })
          } catch (e) {
            return sendJson(res, 400, { error: '重置失败：' + String((e && e.message) || e).slice(0, 200) })
          }
        }
        const patch = sanitizePatch(body && body.values)
        if (!Object.keys(patch).length) return sendJson(res, 400, { error: '没有需要保存的配置项' })
        if (settingsSvc) {
          try {
            await settingsSvc.update('dsh-wechat-bridge', patch)
          } catch (e) {
            return sendJson(res, 400, { error: '配置校验失败：' + String((e && e.message) || e).slice(0, 200) })
          }
        }
        cfg = { ...cfg, ...patch }
        SECRET = cfg.secret || 'dsh-wechat-bridge-local-token'
        // Only `secret` hot-applies (routes re-authorize immediately; bridge
        // restarts with the new token). Every other field is read into a const
        // at startup, so it needs a DSH restart to take effect.
        const needsRestart = Object.keys(patch).filter((k) => k !== 'secret')
        if (patch.secret) restartBridge()
        console.log('[wechat] config updated via /wxb/config:', JSON.stringify(Object.keys(patch)))
        return sendJson(res, 200, { ok: true, config: currentConfig(), needsRestart })
      }
      // GET: the config page itself.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(configPageHtml())
    }}))

    const scheduleBridgeStart = (delayMs) => {
      const nonce = ++bridgeRestartNonce
      state.nextRetryMs = delayMs
      ctx.timeout(() => {
        if (stopping || nonce !== bridgeRestartNonce) return
        state.nextRetryMs = null
        startBridge()
      }, delayMs)
    }

    const startBridge = async () => {
      if (stopping || bridgeProc || bridgeStarting) return
      if (!sub) {
        state.phase = 'error'
        state.detail = 'subprocess 服务不可用，请手动运行 bridge：node ' + BRIDGE_DIR + '/bridge.js'
        return
      }
      bridgeStarting = true
      const nonce = bridgeRestartNonce
      state.phase = 'starting-bridge'
      state.detail = '正在启动 bridge 进程…'
      try {
        let nodePath = null
        try { nodePath = await sub.resolveExecutable('node') } catch (e) { nodePath = null }
        const argv = nodePath ? [nodePath, BRIDGE_DIR + '/bridge.js'] : ['node', BRIDGE_DIR + '/bridge.js']
        const proc = sub.spawn({
          argv,
          cwd: BRIDGE_DIR,
          // Electron is launched by Explorer, so inherited Node descriptors
          // create a visible console window. Keep bounded diagnostics inside
          // DSH and rely on bridge/bridge.log for persistent diagnostics.
          stdio: { stdin: 'pipe', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
          graceMs: 3000,
          env: {
            DSH_BASE_URL: 'http://' + ws.host + ':' + ws.port,
            DSH_BRIDGE_TOKEN: SECRET,
            WECHAT_STORAGE_DIR: BRIDGE_DIR + '/wechat-credentials',
            WECHAT_BOT_AGENT: 'DSH-WeChat-Bridge/1.0',
          },
        })
        if (stopping || nonce !== bridgeRestartNonce) {
          try { proc.terminate() } catch (e) {}
          return
        }
        bridgeProc = proc
        state.bridgePid = proc.pid
        proc.done.then((outcome) => {
          if (nonce !== bridgeRestartNonce || bridgeProc !== proc) return
          bridgeProc = null
          state.bridgeAlive = false
          state.bridgePid = null
          state.pairingRequired = false
          state.lastExit = { exitCode: outcome.exitCode, signal: outcome.signal }
          console.log('[wechat] bridge exited:', JSON.stringify(outcome))
          if (outcome.exitCode === LOGIN_TIMEOUT_EXIT_CODE || suppressRestartOnExit) {
            state.phase = 'idle'
            state.qrState = 'expired'
            state.nextRetryMs = null
            state.detail = '微信登录请求超时，bridge 已停止。点击“重新获取二维码”后才会重新启动。'
            return
          }
          if (!stopping) {
            state.retryAttempt += 1
            const delayMs = Math.min(30000, 3000 * (2 ** Math.min(state.retryAttempt - 1, 3)))
            state.detail = 'bridge 进程退出（code=' + outcome.exitCode + '），' + Math.round(delayMs / 1000) + ' 秒后重试'
            scheduleBridgeStart(delayMs)
          }
        }, (err) => {
          if (nonce !== bridgeRestartNonce || bridgeProc !== proc) return
          bridgeProc = null
          state.bridgeAlive = false
          state.bridgePid = null
          state.phase = 'error'
          state.detail = 'bridge 运行失败：' + String((err && err.message) || err).slice(0, 200)
        })
      } catch (err) {
        console.error('[wechat] bridge spawn failed:', err)
        state.phase = 'error'
        state.detail = 'bridge 启动失败：' + String((err && err.message) || err).slice(0, 200)
      } finally {
        bridgeStarting = false
        if (restartAfterStart && !stopping && !bridgeProc) {
          restartAfterStart = false
          scheduleBridgeStart(0)
        }
      }
    }

    const restartBridge = () => {
      bridgeRestartNonce += 1
      suppressRestartOnExit = false
      state.retryAttempt = 0
      state.nextRetryMs = 800
      state.pairingRequired = false
      state.detail = '正在重启 bridge 进程…'
      if (bridgeStarting) restartAfterStart = true
      const p = bridgeProc
      bridgeProc = null
      if (p) { try { p.terminate() } catch (e) {} }
      const nonce = bridgeRestartNonce
      ctx.timeout(() => {
        if (!stopping && nonce === bridgeRestartNonce) {
          state.nextRetryMs = null
          startBridge()
        }
      }, 800)
    }

    ctx.effect(() => {
      loadUserGen()
      ensureWechatWorkspace()
      startBridge()
      return async () => {
        stopping = true
        bridgeRestartNonce += 1
        if (bridgeProc) { try { bridgeProc.terminate() } catch (e) {} }
        try {
          await mobileRemote.stop()
        } catch (e) {
          console.error('[mobile-remote] stop failed:', e)
        }
        for (const d of routeDisposers) { try { d() } catch (e) {} }
        routeDisposers.length = 0
      }
    })

    ctx.interval(() => {
      if (state.lastHeartbeat && Date.now() - state.lastHeartbeat > 60000 && state.bridgeAlive) {
        state.bridgeAlive = false
        state.detail = 'bridge 心跳超时，可能已离线'
      }
    }, 10000)

    ctx.effect(() => () => {
      for (const [userId, entry] of userAgents) {
        entry.handle.dispose().catch(() => {})
      }
      userAgents.clear()
      for (const [userId, entry] of retiredHandles) {
        entry.handle.dispose().catch(() => {})
      }
      retiredHandles.clear()
      if (selectedTarget) {
        selectedTarget.retired = true
        disposeSelectedTarget(selectedTarget)
        selectedTarget = null
      }
    })

    // Optional panel RPCs — only present in the dynamic-plugin runtime.
    if (typeof harness !== 'undefined') {
      harness.handle('status', async () => statusSnapshot())
      harness.handle('qr', async () => ({ image: state.qrImage || null, url: state.qrUrl || null, rev: state.qrRev }))
      harness.handle('action', async (args) => {
        const action = args && args.action
        if (action === 'restart-bridge') { restartBridge(); return { ok: true } }
        return { ok: false, error: 'unknown action' }
      })
    }

    console.log('[wechat] bridge plugin ready, base = ' + BASE + ', bridge dir = ' + BRIDGE_DIR + ', approval = ' + APPROVAL_POLICY)
  },
}
