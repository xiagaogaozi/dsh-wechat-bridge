import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const client = readFileSync(new URL('client.js', root), 'utf8')
const host = readFileSync(new URL('index.js', root), 'utf8')

assert.equal((client.match(/name:\s*'settings\.section'/g) || []).length, 2, 'The plugin must register two Settings navigation sections.')
assert.match(client, /id:\s*'wechat-bridge'[\s\S]*label:\s*\(\)\s*=>\s*'微信桥接'/, 'The existing WeChat navigation page must remain registered.')
assert.match(client, /id:\s*'mobile-remote'[\s\S]*label:\s*\(\)\s*=>\s*'移动端远程'/, 'The mobile remote navigation page must be registered.')

const startStop = client.indexOf("h('h3', null, '启动/停止移动端远程')")
const scanPair = client.indexOf("h('h3', null, '扫描配对')")
assert.ok(startStop >= 0 && scanPair > startStop, 'Start/stop must appear before scan pairing.')
assert.match(client, /disabled:\s*true[\s\S]*'启动移动端远程'/, 'The unsafe start action must remain disabled in the UI shell.')
assert.match(client, /http:\/\/本机局域网IP:3080/, 'The page must retain a readable fallback LAN address.')
assert.match(client, /Reader：\$\{readerUrl\}/, 'The page must display the Reader address below the pairing area.')

assert.match(host, /import \{ networkInterfaces \} from 'node:os'/, 'The host must derive the LAN address without shell commands.')
assert.match(host, /mobileRemote:[\s\S]*enabled:\s*false[\s\S]*canStart:\s*false/, 'The host snapshot must honestly report the remote shell as stopped.')
assert.match(host, /readerUrl:\s*lanUrl \? `\$\{lanUrl\}\/reader` : null/, 'The host must expose the Reader URL.')
assert.doesNotMatch(client, /child_process|powershell|netsh|New-NetFirewallRule/i, 'The client shell must not execute system or firewall commands.')

console.log('mobile remote client contract: PASS')
