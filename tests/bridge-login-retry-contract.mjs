import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const source = readFileSync(new URL('bridge/bridge.js', root), 'utf8')
const host = readFileSync(new URL('index.js', root), 'utf8')
const client = readFileSync(new URL('client.js', root), 'utf8')

assert.match(
  source,
  /const LOGIN_TIMEOUT_EXIT_CODE = 75/,
  'A QR-login timeout needs a stable, host-recognizable exit code.',
)
assert.match(
  source,
  /sendEvent\('login-timeout'/,
  'The bridge must tell Desktop that it stopped because login timed out.',
)
assert.match(
  source,
  /shutdown\(LOGIN_TIMEOUT_EXIT_CODE\)/,
  'A QR-login timeout must stop the child process instead of sleeping and retrying.',
)
assert.match(
  host,
  /const LOGIN_TIMEOUT_EXIT_CODE = 75/,
  'The host must recognize the controlled timeout exit.',
)
assert.match(
  host,
  /outcome\.exitCode === LOGIN_TIMEOUT_EXIT_CODE/,
  'The host must not respawn a bridge that stopped after a QR-login timeout.',
)
assert.match(
  host,
  /restartBridge[\s\S]*?suppressRestartOnExit = false/,
  'Only an explicit QR refresh may enable bridge startup again.',
)
assert.match(
  client,
  /snapshot\.phase === 'idle'\) return '已停止'/,
  'The UI must label a timeout-stopped bridge as stopped instead of connecting.',
)

console.log('bridge login timeout shutdown contract: PASS')
