import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../bridge/bridge.js', import.meta.url), 'utf8')

assert.doesNotMatch(
  source,
  /process\.exit\(1\)/,
  'An unattended QR-login timeout must not terminate the bridge process and trigger a new Node process.',
)
assert.match(
  source,
  /while\s*\(\s*!stopping\s*\)[\s\S]*?await\s+login\(/,
  'The bridge must retry QR login within the same process while it is running.',
)
assert.match(
  source,
  /sendEvent\('login-retry'/,
  'Desktop must receive a status update when the bridge retries a login.',
)

console.log('bridge login retry contract: PASS')
