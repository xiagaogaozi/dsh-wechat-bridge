import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const client = readFileSync(new URL('client.js', root), 'utf8')
const host = readFileSync(new URL('index.js', root), 'utf8')
const gateway = readFileSync(new URL('remote-gateway.js', root), 'utf8')

assert.equal((client.match(/name:\s*'settings\.section'/g) || []).length, 1, 'The plugin must register exactly one Settings navigation section.')
assert.match(client, /id:\s*'remote-control'[\s\S]*label:\s*\(\)\s*=>\s*'远程控制'/, 'The Settings list entry must be named 远程控制.')
assert.match(client, /function RemoteControlSettings[\s\S]*role:\s*'tablist'[\s\S]*微信桥接[\s\S]*移动端远程/, 'The remote control page must contain internal navigation tabs.')
assert.match(client, /role:\s*'tabpanel'/, 'The remote control page must expose the selected tab panel.')
assert.match(client, /h\(WeChatBridgeSettings, null\)/, 'The internal WeChat page must remain reachable from the remote control page.')
assert.match(client, /h\(MobileRemoteSettings, null\)/, 'The internal mobile remote page must remain reachable from the remote control page.')
assert.doesNotMatch(client, /id:\s*'(wechat-bridge|mobile-remote)'/, 'The legacy split Settings entries must not remain registered.')

const startStop = client.indexOf("h('h3', null, '启动/停止移动端远程')")
const scanPair = client.indexOf("h('h3', null, '扫描配对')")
assert.ok(startStop >= 0 && scanPair > startStop, 'Start/stop must appear before scan pairing.')
assert.match(client, /start-mobile-remote/, 'The start button must call the authenticated host gateway action.')
assert.match(client, /stop-mobile-remote/, 'The stop button must release the authenticated host gateway.')
assert.match(client, /refresh-mobile-pairing/, 'The pairing QR must be renewable without restarting DSH.')
assert.match(client, /revoke-mobile-device/, 'The Desktop page must be able to revoke a paired device.')
assert.match(client, /pairingQrImage/, 'The Desktop page must render the host-generated one-time pairing QR.')
assert.match(client, /http:\/\/本机局域网IP:3080/, 'The page must retain a readable fallback LAN address.')
assert.match(client, /Reader：\$\{readerUrl\}/, 'The page must display the Reader address below the pairing area.')

assert.match(host, /import \{ networkInterfaces \} from 'node:os'/, 'The host must derive the LAN address without shell commands.')
assert.match(host, /createMobileRemoteGateway/, 'The host must own the second authenticated listener instead of modifying DSH or Desktop.')
assert.match(gateway, /listen\(port, '0\.0\.0\.0'/, 'The plugin gateway must bind the selected all-interfaces address.')
assert.match(gateway, /readerUrl:\s*url \? `\$\{url\}\/reader` : null/, 'The gateway must expose the Reader URL.')
assert.match(gateway, /PRIVILEGED_API_METHODS/, 'The gateway must keep DSH loopback-only privileged API methods blocked.')
assert.match(gateway, /COOKIE_NAME[\s\S]*HttpOnly; SameSite=Strict/, 'Paired devices must receive an HttpOnly same-site session cookie.')
assert.match(client, /dsh-wechat-bridge\/mobile-ui/, 'The migrated dsh-web-mobile UI must be embedded in this plugin client.')
assert.match(client, /id:\s*'mobile-nav-toggle'/, 'The migrated mobile directory controls must be registered.')
assert.doesNotMatch(client, /--aion-|--ds-ease/, 'Migrated UI must use DSH --dsw-* theme variables only.')
assert.doesNotMatch(client, /child_process|powershell|netsh|New-NetFirewallRule/i, 'The client shell must not execute system or firewall commands.')

console.log('mobile remote client contract: PASS')
