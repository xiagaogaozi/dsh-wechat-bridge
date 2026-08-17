import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const client = readFileSync(new URL('client.js', root), 'utf8')

assert.equal(packageJson.exports['./client'], './client.js', 'The client entry must be package-resolvable.')
assert.equal(packageJson.exports['./package.json'], './package.json', 'DSH resolves package metadata before it can discover the client entry.')
assert.equal(packageJson.dsh.client.platform, 'web', 'Desktop renders the DSH Web client bundle.')
assert.ok(packageJson.files.includes('bridge/bridge.js'), 'The bridge runtime must ship in the tarball.')
assert.ok(!packageJson.files.includes('bridge'), 'The tarball must not include bridge logs, caches, credentials, or node_modules.')
assert.match(client, /name:\s*'settings\.section'/, 'The page must register in DSH Settings, not as a standalone window.')
assert.match(client, /@deepseek-ai\/dsh-client-ui-primitives/, 'The page must use DSH primitives.')
assert.doesNotMatch(client, /#[0-9a-fA-F]{3,8}\b/, 'Desktop UI may not add hard-coded colour values.')
assert.match(client, /--dsw-alias-border-l2/, 'Desktop UI must reuse DSH theme tokens.')

console.log('desktop client contract: PASS')
