# dsh-wechat-bridge

把微信接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：扫码登录后，
微信消息由 DSH agent（coding agent）回复；会话按轮次管理并挂在独立的 **WeChat 工作区**，
支持 `/new`（新对话，旧对话保留）、`/history`（回看历史）。适合"在手机上用 DSH"。

基于微信官方 **iLink Bot API**（`ilinkai.weixin.qq.com`，同腾讯开源项目
[openclaw-weixin](https://github.com/Tencent/openclaw-weixin) 所用协议），
消息收发由 `@wechatbot/wechatbot` SDK 完成。

## 特性

- 📱 **扫码登录**：凭据持久化，重启免扫码
- 🤖 **DSH agent 回复**：每个微信用户一个稳定会话（cordis preset，含完整工具链）
- 🗂️ **独立 WeChat 工作区**：所有微信会话在 Web GUI 侧边栏单独分组，标题自动摘要为
  `微信 · 对话内容`
- 🔄 **/new 保留旧对话**：新对话用轮次后缀创建，旧对话完整保存、随时回看
- 📜 **/history 查询**：微信内直接列出/查看任意历史轮次
- 🖼️ **媒体支持**：图片/文件自动落盘并给出路径，agent 可读取处理
- 🖥️ **Desktop 设置页**：设置 →「微信桥接」内直接扫码、查看状态、提交手机显示的配对码
- ⚙️ **网页配置页**：`http://127.0.0.1:3080/wxb/config` 仍可修改 host 配置
- 🔌 **标准 DSH 插件包**：安装后同时挂载 host 与 Desktop/Web client，不改 DSH 内核

## 架构

```
┌──────────┐   iLink 官方协议   ┌──────────────────┐   HTTP (127.0.0.1)   ┌────────────────────────────┐
│ 微信 App  │ ◄────────────────► │   bridge 进程     │ ◄─────────────────► │   DSH Host（Cordis 插件）  │
│ (手机)    │   （扫码登录/长轮询）│  bridge/bridge.js │   /wxb/inbound       │   index.js                 │
└──────────┘                     └──────────────────┘   /wxb/outbox        │   ├─ agents.create/resume   │
                                  Node ≥ 22            /wxb/event          │   ├─ 按用户驱动回合+回复     │
                                  依赖 @wechatbot/wechatbot + qrcode        │   └─ WeChat 工作区挂载     │
                                                                            └────────────────────────────┘
```

## 安装

### 安装到 Profile（推荐）

```bash
dsh plugin --profile web add github:xiagaogaozi/dsh-wechat-bridge
```

该命令把包加入 web profile 的依赖和 bundle 列表；包内 `cordis.patch.yml` 会同时注册 bridge host 与可被 Desktop/Web 加载的 client bundle。重启 DSH Desktop 后，打开设置列表中的「微信桥接」：首次登录在其中扫码；手机出现配对码时直接输入并提交。凭据保存在 `bridge/wechat-credentials/`，之后免扫码。

### 本地 tarball 安装

```bash
cd /path/to/dsh-wechat-bridge
npm pack
dsh plugin --profile web add ./dsh-wechat-bridge-1.1.5.tgz
```

不要再把 `index.js` 单独追加到 profile 的 `cordis.patch.yml`；那种旧安装方式只挂载 host，Desktop 无法发现 client 设置页。

## Desktop 扫码与配对码

在 DSH Desktop 的设置列表选择「微信桥接」。该页每 2.5 秒刷新状态，展示二维码、扫码/在线状态、bridge PID，以及微信要求时出现的配对码输入框。点击「重新获取二维码」会受控重启 bridge；bridge 不再继承 Electron 的控制台，因此不会创建可见 Node 黑窗。二维码、配对码提交接口仅接受本机 loopback 请求，远程 Web 页面不能读取或提交它们。

## 配置页面

host 安装后无需碰终端：浏览器打开 **`http://127.0.0.1:3080/wxb/config`**
（与 `/wxb/qr` 同策略、仅 127.0.0.1 可访问），即可查看/修改全部配置并保存。
保存的值写入 DSH 的 `settings.yaml`（`dsh-wechat-bridge` 命名空间），
**覆盖** `cordis.patch.yml` 中 `config` 的同名字段；留空的字段回落到默认值。

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `bridgeDir` | bridge 进程目录 | 包内 `./bridge` |
| `wechatWsPath` | WeChat 工作区路径 | 包目录 |
| `secret` | `/wxb/*` 端点共享密钥 | `dsh-wechat-bridge-local-token`（仅 127.0.0.1） |
| `preset` | 微信 agent 的 preset | `cordis` |
| `approvalPolicy` | `never` / `ask` | `never`（手机端无法点批准） |
| `base` | 端点前缀 | `/wxb` |
| `workspaceTitle` | GUI 工作区名称 | `WeChat` |

保存行为：
- `secret` 保存后 **立即生效**（路由重新鉴权 + bridge 自动重启）；
- 其余字段（`preset`/`approvalPolicy`/`base`/`bridgeDir`/`wechatWsPath`/
  `workspaceTitle`）在启动时读入常量，保存后需**重启 DSH** 完全生效，页面会提示；
- 页面上的「恢复默认」按钮可一键清空所有已保存覆盖，回到组合配置。

> 配置页仍保留给 host 配置；扫码和配对码使用 DSH client 的 `settings.section` 槽位，而不是 DSH settings namespace，因此不需要修改内核白名单。

## 微信内命令

| 命令 | 说明 |
|------|------|
| `/new`（或 `/重置`） | 开启新对话（第 N+1 轮），旧对话完整保留 |
| `/history`（或 `/历史`） | 列出历史会话 |
| `/history 数字` | 查看对应轮次对话内容 |
| `/help`（或 `/帮助`） | 命令帮助 |

## 注意事项

- **扫码的账号成为机器人**：它对收到的消息自动回复，建议使用小号。
- 任何能给机器人发消息的人都获得一个带完整工具权限、免批准的 DSH agent
  （`approvalPolicy: never` + workspace-write 沙箱）。多人使用务必自行加白名单
  （`bridge/bridge.js` 的 `WECHAT_ALLOW_USERS` 环境变量）。
- 依赖 Node.js ≥ 22；`/wxb/*` 端点仅监听 `127.0.0.1`。

## License

MIT
