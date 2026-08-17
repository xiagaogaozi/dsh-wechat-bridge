import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const startBridge = source.slice(source.indexOf('const startBridge = async () =>'))

assert.doesNotMatch(
  startBridge,
  /stdio:\s*\{[^}]*\b(?:stdout|stderr):\s*'inherit'/s,
  'Desktop bridge startup must not inherit stdout/stderr, or Electron creates a visible Node console window.',
)
assert.match(
  startBridge,
  /stdio:\s*\{\s*stdin:\s*'pipe',\s*stdout:\s*\{\s*maxBytes:\s*65536\s*\},\s*stderr:\s*\{\s*maxBytes:\s*65536\s*\}\s*\}/s,
  'Bridge output must be bounded and captured while stdin remains available for the Desktop pairing code.',
)

console.log('desktop bridge spawn contract: PASS')
