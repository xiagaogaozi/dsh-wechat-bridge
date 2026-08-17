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
      [data-dsh-wechat-bridge-settings] { color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; gap: 16px; font-size: 14px; line-height: 22px; }
      [data-dsh-wechat-bridge-settings] .wxb-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
      [data-dsh-wechat-bridge-settings] .wxb-title { margin: 0; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 500; line-height: 24px; }
      [data-dsh-wechat-bridge-settings] .wxb-subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      [data-dsh-wechat-bridge-settings] .wxb-status { display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }
      [data-dsh-wechat-bridge-settings] .wxb-status-text { min-width: 0; flex: 1; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      [data-dsh-wechat-bridge-settings] .wxb-pill { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 12px; line-height: 18px; }
      [data-dsh-wechat-bridge-settings] .wxb-pill-online { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-tertiary); }
      [data-dsh-wechat-bridge-settings] .wxb-pill-waiting { color: var(--dsw-alias-state-warn-label); background: var(--dsw-alias-state-warn-tertiary); }
      [data-dsh-wechat-bridge-settings] .wxb-pill-error { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover-danger); }
      [data-dsh-wechat-bridge-settings] .wxb-card { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; }
      [data-dsh-wechat-bridge-settings] .wxb-card h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; line-height: 22px; }
      [data-dsh-wechat-bridge-settings] .wxb-card p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      [data-dsh-wechat-bridge-settings] .wxb-qr { width: min(240px, 100%); aspect-ratio: 1; box-sizing: border-box; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-static-neutral-00); image-rendering: pixelated; }
      [data-dsh-wechat-bridge-settings] .wxb-pair-row { display: flex; width: min(360px, 100%); align-items: center; gap: 8px; }
      [data-dsh-wechat-bridge-settings] .wxb-pair-row > span { flex: 1; min-width: 0; }
      [data-dsh-wechat-bridge-settings] .wxb-empty { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
      [data-dsh-wechat-bridge-settings] .wxb-error { display: flex; align-items: flex-start; gap: 8px; color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; }
      [data-dsh-wechat-bridge-settings] .wxb-meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
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
      const refresh = useCallback(async () => {
        try {
          const data = await request('GET')
          setSnapshot(data)
          setError(null)
        } catch (err) {
          setError(`无法读取微信桥接状态：${err instanceof Error ? err.message : String(err)}`)
        }
      }, [])

      useEffect(() => {
        installStyles()
        let active = true
        const load = async () => {
          try {
            const data = await request('GET')
            if (!active) return
            setSnapshot(data)
            setError(null)
          } catch (err) {
            if (active) setError(`无法读取微信桥接状态：${err instanceof Error ? err.message : String(err)}`)
          }
        }
        void load()
        const timer = window.setInterval(() => { void load() }, 2500)
        return () => { active = false; window.clearInterval(timer) }
      }, [])

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

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'wechat-bridge',
        order: 60,
        label: () => '微信桥接',
      }, WeChatBridgeSettings))
    }

    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
