// Browser half of dsh-wechat-bridge.  This deliberately follows DSH's client
// bundle wrapper instead of shipping a separate web app: the settings shell,
// Button and Input primitives, and all colours remain owned by DSH.
window.__ModuleLoader__.load({
  id: 'dsh-wechat-bridge',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const {
      Button,
      IconRefreshOutline16,
      IconSendOutline16,
      IconWarningOutline16,
      Input,
    } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const DESKTOP_ROUTE = '/plugins/dsh-wechat-bridge/desktop'
    const STYLE_ID = 'dsh-wechat-bridge-settings-style'
    const STYLE = `
      :is([data-dsh-remote-control-settings], [data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) { color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; gap: 16px; font-size: 14px; line-height: 22px; }
      :is([data-dsh-remote-control-settings], [data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
      :is([data-dsh-remote-control-settings], [data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 500; line-height: 24px; }
      :is([data-dsh-remote-control-settings], [data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-status { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-status-text { min-width: 0; flex: 1; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pill { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 12px; line-height: 18px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pill-online { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pill-waiting { color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pill-error { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-card { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-card h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-card p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-qr { width: min(240px, 100%); aspect-ratio: 1; box-sizing: border-box; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-static-neutral-00); image-rendering: pixelated; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pair-row { display: flex; width: min(360px, 100%); align-items: center; gap: 8px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-pair-row > span { flex: 1; min-width: 0; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-target-fields { display: flex; width: min(560px, 100%); flex-direction: column; gap: 12px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-field { display: flex; flex-direction: column; gap: 4px; width: 100%; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-field-label { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 20px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-select { width: 100%; min-height: 32px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; line-height: 20px; padding: 5px 8px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-select:disabled { color: var(--dsw-alias-label-tertiary); }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-empty { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-error { display: flex; align-items: flex-start; gap: 8px; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; }
      :is([data-dsh-wechat-bridge-settings], [data-dsh-mobile-remote-settings]) .wxb-meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
      [data-dsh-mobile-remote-settings] .wxb-remote-qr { width: min(240px, 100%); aspect-ratio: 1; box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-tertiary); text-align: center; }
      [data-dsh-mobile-remote-settings] .wxb-address { width: min(560px, 100%); box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
      [data-dsh-mobile-remote-settings] .wxb-warning { display: flex; align-items: flex-start; gap: 8px; width: 100%; box-sizing: border-box; padding: 12px; border-radius: 12px; color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); font-size: 13px; line-height: 20px; }
      [data-dsh-remote-control-settings] .wxb-tabs { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    `

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    async function request(method, body) {
      const res = await fetch(DESKTOP_ROUTE, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch (err) { data = { error: text || `HTTP ${res.status}` } }
      if (!res.ok) throw new Error(String(data.error || `HTTP ${res.status}`))
      return data
    }

    function phaseLabel(snapshot) {
      if (snapshot.phase === 'online') return '在线'
      if (snapshot.phase === 'waiting-qr') return '等待扫码'
      if (snapshot.phase === 'waiting-pair-code') return '等待配对码'
      if (snapshot.phase === 'scanned') return '等待手机确认'
      if (snapshot.phase === 'error') return '错误'
      if (snapshot.phase === 'expired') return '会话已过期'
      if (snapshot.phase === 'idle') return '已停止'
      return '连接中'
    }

    function phaseClass(snapshot) {
      if (snapshot.phase === 'online') return 'wxb-pill-online'
      if (snapshot.phase === 'error' || snapshot.phase === 'expired') return 'wxb-pill-error'
      return 'wxb-pill-waiting'
    }

    function WeChatBridgeSettings() {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)
      const [pairingCode, setPairingCode] = useState('')
      const [busy, setBusy] = useState(false)
      const [target, setTarget] = useState({ workspaceId: '', sessionId: '', mode: 'per-user-session' })
      const [workspaces, setWorkspaces] = useState([])
      const [sessions, setSessions] = useState([])
      const [targetBusy, setTargetBusy] = useState(false)
      const refresh = useCallback(async () => {
        try {
          const data = await request('GET')
          setSnapshot(data)
          if (data.target) setTarget(data.target)
          setError(null)
        } catch (err) {
          setError(`无法读取微信桥接状态：${err instanceof Error ? err.message : String(err)}`)
        }
      }, [])

      const loadTargetSessions = useCallback(async (workspaceId) => {
        if (!workspaceId) {
          setSessions([])
          return
        }
        try {
          const data = await request('POST', { action: 'list-target-sessions', workspaceId })
          setSessions(data.sessions || [])
          if (data.target) setTarget(data.target)
        } catch (err) {
          setSessions([])
          setError(`无法读取工作区对话：${err instanceof Error ? err.message : String(err)}`)
        }
      }, [])

      const loadTargets = useCallback(async () => {
        try {
          const data = await request('POST', { action: 'list-targets' })
          setWorkspaces(data.workspaces || [])
          if (data.target) setTarget(data.target)
          if (data.unavailable) setError(data.unavailable)
        } catch (err) {
          setError(`无法读取 DSH 工作区：${err instanceof Error ? err.message : String(err)}`)
        }
      }, [])

      const saveTarget = async (next, previous) => {
        setTargetBusy(true)
        try {
          const data = await request('POST', {
            action: 'save-target',
            workspaceId: next.workspaceId,
            sessionId: next.sessionId,
          })
          setTarget(data.target || next)
          if (data.snapshot) setSnapshot(data.snapshot)
          setError(null)
        } catch (err) {
          setTarget(previous)
          setError(`保存微信转发目标失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setTargetBusy(false)
        }
      }

      const chooseWorkspace = (workspaceId) => {
        const previous = target
        const next = { workspaceId, sessionId: '', mode: workspaceId ? 'per-user-session' : 'per-user-session' }
        setTarget(next)
        setSessions([])
        void saveTarget(next, previous)
        if (workspaceId) void loadTargetSessions(workspaceId)
      }

      const chooseSession = (sessionId) => {
        const previous = target
        const next = { workspaceId: target.workspaceId, sessionId, mode: sessionId ? 'selected-session' : 'per-user-session' }
        setTarget(next)
        void saveTarget(next, previous)
      }

      useEffect(() => {
        installStyles()
        let active = true
        const load = async () => {
          try {
            const data = await request('GET')
            if (!active) return
            setSnapshot(data)
            if (data.target) setTarget(data.target)
            setError(null)
          } catch (err) {
            if (active) setError(`无法读取微信桥接状态：${err instanceof Error ? err.message : String(err)}`)
          }
        }
        void load()
        void loadTargets()
        const timer = window.setInterval(() => { void load() }, 2500)
        return () => { active = false; window.clearInterval(timer) }
      }, [loadTargets])

      useEffect(() => {
        if (target.workspaceId) void loadTargetSessions(target.workspaceId)
      }, [loadTargetSessions, target.workspaceId])

      const restart = async () => {
        setBusy(true)
        try {
          const data = await request('POST', { action: 'restart-bridge' })
          setSnapshot(data.snapshot || data)
          setPairingCode('')
          setError(null)
        } catch (err) {
          setError(`重启 bridge 失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      const submitPairingCode = async () => {
        if (!pairingCode.trim()) return
        setBusy(true)
        try {
          const data = await request('POST', { action: 'submit-pairing-code', code: pairingCode })
          setSnapshot(data.snapshot || data)
          setPairingCode('')
          setError(null)
        } catch (err) {
          setError(`提交配对码失败：${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      if (snapshot === null) {
        return h('section', { 'data-dsh-wechat-bridge-settings': '' },
          h('div', { className: 'wxb-empty' }, error || '正在加载微信桥接状态…'))
      }

      const retry = snapshot.nextRetryMs === null || snapshot.nextRetryMs === undefined
        ? ''
        : ` · 下次重试约 ${Math.max(0, Math.ceil(snapshot.nextRetryMs / 1000))} 秒后`
      return h('section', { 'data-dsh-wechat-bridge-settings': '' },
        h('div', { className: 'wxb-header' },
          h('div', null,
            h('h2', { className: 'wxb-title' }, '微信桥接'),
            h('p', { className: 'wxb-subtitle' }, '扫码登录、查看连接状态，并在微信要求时输入配对码。')),
          h(Button, {
            variant: 'outline', size: 'sm', disabled: busy, icon: h(IconRefreshOutline16, null),
            onClick: () => { void refresh() },
          }, '刷新')),
        h('div', { className: 'wxb-status', role: 'status' },
          h('span', { className: `wxb-pill ${phaseClass(snapshot)}` }, phaseLabel(snapshot)),
          h('span', { className: 'wxb-status-text' }, `${snapshot.detail || '暂无状态'}${retry}`)),
        error === null ? null : h('div', { className: 'wxb-error', role: 'alert' },
          h(IconWarningOutline16, { size: 16 }), h('span', null, error)),
        h('div', { className: 'wxb-card' },
          h('h3', null, '扫码登录'),
          h('p', null, snapshot.qrImage
            ? '请用手机微信扫描下方二维码。二维码过期后会自动刷新。'
            : 'bridge 正在获取二维码；若长时间没有出现，可重启 bridge。'),
          snapshot.qrImage
            ? h('img', { className: 'wxb-qr', src: snapshot.qrImage, alt: '微信登录二维码' })
            : h('div', { className: 'wxb-empty' }, '暂无二维码'),
           h(Button, {
             variant: 'outline', size: 'sm', disabled: busy, icon: h(IconRefreshOutline16, null),
             onClick: () => { void restart() },
           }, '重新获取二维码')),
        h('div', { className: 'wxb-card' },
          h('h3', null, '微信转发目标'),
          h('p', null, '选择一个 DSH 工作区及其中的对话后，微信消息会继续写入该对话。未选择对话时，仍按原有方式为每个微信用户创建独立会话。运行中或已归档的对话不能绑定，以免打断任务。'),
          h('div', { className: 'wxb-target-fields' },
            h('label', { className: 'wxb-field' },
              h('span', { className: 'wxb-field-label' }, '工作区'),
              h('select', {
                className: 'wxb-select',
                value: target.workspaceId || '',
                disabled: targetBusy,
                'aria-label': '微信转发目标工作区',
                onChange: (event) => chooseWorkspace(event.target.value),
              }, [
                h('option', { key: 'default', value: '' }, '不指定工作区（独立 WeChat 会话）'),
                ...workspaces.map((workspace) => h('option', { key: workspace.id, value: workspace.id }, `${workspace.title || workspace.path} · ${workspace.sessionCount || 0} 个对话`)),
              ])),
            target.workspaceId
              ? h('label', { className: 'wxb-field' },
                h('span', { className: 'wxb-field-label' }, '对话'),
                h('select', {
                  className: 'wxb-select',
                  value: target.sessionId || '',
                  disabled: targetBusy,
                  'aria-label': '微信转发目标对话',
                  onChange: (event) => chooseSession(event.target.value),
                }, [
                  h('option', { key: 'default', value: '' }, '不指定对话（保持独立 WeChat 会话）'),
                  ...sessions.map((session) => h('option', {
                    key: session.id,
                    value: session.id,
                    disabled: Boolean(session.running && session.id !== target.sessionId),
                  }, `${session.title || '未命名对话'}${session.running ? '（运行中，不能绑定）' : ''}`)),
                ]))
              : null,
            target.workspaceId && sessions.length === 0
              ? h('div', { className: 'wxb-empty' }, '该工作区暂时没有可选择的未归档对话。')
              : null),
          h(Button, {
            variant: 'outline', size: 'sm', disabled: targetBusy, icon: h(IconRefreshOutline16, null),
            onClick: () => { void loadTargets(); if (target.workspaceId) void loadTargetSessions(target.workspaceId) },
          }, '刷新工作区和对话列表')),
        snapshot.pairingRequired ? h('div', { className: 'wxb-card' },
          h('h3', null, '输入配对码'),
          h('p', null, '手机微信显示配对码时，在此输入并提交；代码不会保存。'),
          h('div', { className: 'wxb-pair-row' },
            h(Input, {
              value: pairingCode,
              type: 'password',
              inputMode: 'numeric',
              autoComplete: 'one-time-code',
              placeholder: '请输入手机显示的配对码',
              disabled: busy,
              onChange: (event) => setPairingCode(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') void submitPairingCode() },
            }),
            h(Button, {
              variant: 'primary', size: 'sm', disabled: busy || !pairingCode.trim(), icon: h(IconSendOutline16, null),
              onClick: () => { void submitPairingCode() },
            }, '提交')))
          : null,
        h('div', { className: 'wxb-meta' },
          `bridge：${snapshot.bridgeAlive ? `运行中（PID ${snapshot.bridgePid || '—'}）` : '未运行'} · 微信用户：${(snapshot.users || []).length}`))
    }

    function MobileRemoteSettings() {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)

      const refresh = useCallback(async () => {
        try {
          setSnapshot(await request('GET'))
          setError(null)
        } catch (err) {
          setError(`无法读取移动端远程状态：${err instanceof Error ? err.message : String(err)}`)
        }
      }, [])

      useEffect(() => {
        installStyles()
        let active = true
        request('GET').then((data) => {
          if (active) {
            setSnapshot(data)
            setError(null)
          }
        }).catch((err) => {
          if (active) setError(`无法读取移动端远程状态：${err instanceof Error ? err.message : String(err)}`)
        })
        return () => { active = false }
      }, [])

      if (snapshot === null) {
        return h('section', { 'data-dsh-mobile-remote-settings': '' },
          h('div', { className: 'wxb-empty' }, error || '正在加载移动端远程状态…'))
      }

      const remote = snapshot.mobileRemote || {}
      const lanUrl = remote.lanUrl || 'http://本机局域网IP:3080'
      const readerUrl = remote.readerUrl || `${lanUrl}/reader`
      return h('section', { 'data-dsh-mobile-remote-settings': '' },
        h('div', { className: 'wxb-header' },
          h('div', null,
            h('h2', { className: 'wxb-title' }, '移动端远程'),
            h('p', { className: 'wxb-subtitle' }, '通过安全配对在手机上访问 DSH；网络暴露尚未启用。')),
          h(Button, {
            variant: 'outline', size: 'sm', icon: h(IconRefreshOutline16, null),
            onClick: () => { void refresh() },
          }, '刷新')),
        error === null ? null : h('div', { className: 'wxb-error', role: 'alert' },
          h(IconWarningOutline16, { size: 16 }), h('span', null, error)),
        h('div', { className: 'wxb-card' },
          h('h3', null, '启动/停止移动端远程'),
          h('div', { className: 'wxb-status', role: 'status' },
            h('span', { className: 'wxb-pill wxb-pill-waiting' }, '已停止'),
            h('span', { className: 'wxb-status-text' }, remote.detail || '移动端远程当前未启用。')),
          h(Button, {
            variant: 'primary', size: 'sm', disabled: true,
          }, '启动移动端远程')),
        h('div', { className: 'wxb-card' },
          h('h3', null, '扫描配对'),
          h('p', null, '安全配对与局域网监听启用后，使用手机扫描此处二维码。'),
          h('div', { className: 'wxb-remote-qr', role: 'img', 'aria-label': '移动端配对二维码尚未生成' },
            '等待安全配置后生成配对二维码'),
          h('div', { className: 'wxb-address' }, lanUrl),
          h('div', { className: 'wxb-meta' }, `Reader：${readerUrl}`),
          h('div', { className: 'wxb-warning' },
            h(IconWarningOutline16, { size: 16 }),
            h('span', null, '当前 DSH 仍只监听 127.0.0.1；以上地址尚不能从手机访问。'))))
    }

    function RemoteControlSettings() {
      const [activePage, setActivePage] = useState('wechat')
      const wechatActive = activePage === 'wechat'

      return h('section', { 'data-dsh-remote-control-settings': '' },
        h('div', { className: 'wxb-header' },
          h('div', null,
            h('h2', { className: 'wxb-title' }, '远程控制'),
            h('p', { className: 'wxb-subtitle' }, '管理微信桥接与移动端远程访问。'))),
        h('div', {
          className: 'wxb-tabs',
          role: 'tablist',
          'aria-label': '远程控制页面',
        },
          h(Button, {
            variant: wechatActive ? 'primary' : 'outline',
            size: 'sm',
            role: 'tab',
            'aria-selected': wechatActive,
            onClick: () => { setActivePage('wechat') },
          }, '微信桥接'),
          h(Button, {
            variant: wechatActive ? 'outline' : 'primary',
            size: 'sm',
            role: 'tab',
            'aria-selected': !wechatActive,
            onClick: () => { setActivePage('mobile') },
          }, '移动端远程')),
        h('div', {
          role: 'tabpanel',
          'aria-label': wechatActive ? '微信桥接' : '移动端远程',
        },
          wechatActive
            ? h(WeChatBridgeSettings, null)
            : h(MobileRemoteSettings, null)))
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'remote-control',
        order: 60,
        label: () => '远程控制',
      }, RemoteControlSettings))
    }

    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
