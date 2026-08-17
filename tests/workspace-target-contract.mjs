import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const host = readFileSync(new URL('index.js', root), 'utf8')
const client = readFileSync(new URL('client.js', root), 'utf8')

assert.match(host, /targetWorkspaceId:\s*z\.string\(\)/, 'The selected workspace id must persist in the plugin settings namespace.')
assert.match(host, /targetSessionId:\s*z\.string\(\)/, 'The selected session id must persist in the plugin settings namespace.')
assert.match(host, /action === 'list-targets'/, 'Desktop must be able to enumerate DSH workspaces.')
assert.match(host, /action === 'list-target-sessions'/, 'Desktop must enumerate conversations only after a workspace is selected.')
assert.match(host, /action === 'save-target'/, 'Desktop target changes must be persisted through the host route.')
assert.match(host, /archivedSessionIds/, 'Archived conversations must not be bindable.')
assert.match(host, /目标对话正在运行/, 'A live DSH task must be protected from WeChat binding.')
assert.match(host, /agentsSvc\.resume\(\{ resumeSessionId: sessionId \}\)/, 'Selected conversations must resume without replacing their preset or model.')
assert.match(host, /retireSelectedTarget\(\)/, 'Changing the target must retire only the bridge-owned handle.')
assert.match(host, /inject:\s*\[[^\]]*'workspaceRegistry'/, 'The bridge must wait for the DSH workspace service before it starts.')
assert.match(host, /const getWorkspaceRegistry = \(\) => ctx\.get\('workspaceRegistry'\)/, 'Workspace lookups must resolve the current service instead of caching an early undefined value.')
assert.doesNotMatch(host, /const wsReg = ctx\.get\('workspaceRegistry'\)/, 'A startup-time workspace service lookup becomes permanently stale when DSH starts the service later.')
assert.match(client, /微信转发目标/, 'The Desktop settings page must expose the target controls.')
assert.match(client, /微信转发目标工作区/, 'The workspace selector needs an accessible label.')
assert.match(client, /微信转发目标对话/, 'The conversation selector needs an accessible label.')
assert.match(client, /--dsw-alias-bg-module-platform/, 'The new selector must reuse DSH theme tokens.')

console.log('workspace target contract: PASS')
