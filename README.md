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
- 🖥️ **Desktop 设置页**：设置列表只注册「远程控制」，页面内切换「微信桥接」和「移动端远程」
- 🎯 **可选转发目标**：在 Desktop 设置页选择已有 DSH 工作区及其一个空闲对话，让微信消息继续写入该对话
- 🌐 **配对后局域网访问**：插件独立监听 `0.0.0.0:3080`，不修改 DSH 或 Desktop 的回环监听
- 📱 **手机竖屏 UI**：内置迁移自 `mexiaosqwq/dsh-web-mobile` 1.0.0 的目录抽屉、会话头部、设置 sheet、文件/预览浮层和响应式排版
- 🔐 **独立设备令牌**：二维码五分钟有效，扫码后签发 HttpOnly/SameSite 设备 Cookie，可在电脑撤销
- 📖 **配对 Reader**：已配对手机可访问 `http://电脑局域网IP:3080/reader`，并支持 Reader WebSocket
- ⚙️ **网页配置页**：在 DSH 上游端口打开 `/wxb/config` 仍可修改 host 配置（Web Profile 为 `3081`）
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

移动端远程使用第二条独立链路；Web Profile 与 Desktop 的上游端口分别独立：

```text
已配对手机 ── HTTP / WebSocket / SSE ──► dsh-wechat-bridge 网关 0.0.0.0:3080
                                             │ 配对 Cookie、Host/Origin 校验、敏感路由阻断
                                             ▼
                                      DSH Web 127.0.0.1:3081（Web Profile）
                                      或 DSH Desktop 127.0.0.1:<动态端口，例如 5541>
```

## 安装

### 安装到 Profile（推荐）

```bash
dsh plugin --profile web add github:xiagaogaozi/dsh-wechat-bridge
```

该命令把包加入 web profile 的依赖和 bundle 列表；包内 `cordis.patch.yml` 会同时注册 bridge host 与可被 Desktop/Web 加载的 client bundle。重启 DSH Desktop 后，打开设置列表中的「远程控制」：首次登录在「微信桥接」中扫码；手机出现配对码时直接输入并提交。凭据保存在 `bridge/wechat-credentials/`，之后免扫码。

### 本地 tarball 安装

```bash
cd /path/to/dsh-wechat-bridge
npm pack
dsh plugin --profile web add ./dsh-wechat-bridge-1.4.1.tgz
```

不要再把 `index.js` 单独追加到 profile 的 `cordis.patch.yml`；那种旧安装方式只挂载 host，Desktop 无法发现 client 设置页。

## Desktop 扫码与配对码

在 DSH Desktop 的设置列表选择「远程控制」→「微信桥接」。该页每 2.5 秒刷新状态，展示二维码、扫码/在线状态、bridge PID，以及微信要求时出现的配对码输入框。点击「重新获取二维码」会受控重启 bridge；bridge 不再继承 Electron 的控制台，因此不会创建可见 Node 黑窗。二维码、配对码提交接口仅接受本机 loopback 请求，远程 Web 页面不能读取或提交它们。

### 选择工作区和对话

同一设置页的「微信转发目标」先列出 DSH 工作区，再只列出所选工作区内未归档的对话。选定两者后，微信收到的普通消息会继续写入该对话；插件不会移动该对话、修改其工作区、预设或模型。为了避免打断现有工作，正在运行的对话不能绑定；若之后它正在运行，微信消息会明确提示未写入而不是排队、取消或新建替代会话。

未选择目标对话时，插件保持原有行为：每个微信用户拥有独立的 WeChat 会话，`/new` 和 `/history` 仍然可用。已绑定到指定对话时，`/new` 和 `/history` 不会改动该对话，请在 DSH 对话列表中管理其历史。

## 移动端远程

在「远程控制」→「移动端远程」点击“启动移动端远程”。插件会创建独立的
`0.0.0.0:3080` 网关，页面显示：

- `http://本机局域网IP:3080`
- `http://本机局域网IP:3080/reader`
- 五分钟内有效的一次性配对二维码
- 已配对设备及最近访问时间

扫码后手机先交换一次性口令，再获得独立的 HttpOnly、SameSite=Strict
设备 Cookie。未配对请求、跨站 Origin、非当前 LAN 接口及不可信 Host 会被拒绝；
`/wxb/*`、Desktop 控制接口，以及 DSH 的设置、凭据、本机路径和 Agent Preset
等回环特权 API 不会通过网关转发。停止网关会释放 3080、断开 WebSocket 并撤销
全部设备会话。

网关原生流式转发 HTTP、WebSocket 和 SSE。手机加载同一个 DSH Web shell，
但其 client bundle 已内置 `dsh-web-mobile` 的竖屏导航与响应式 UI，无需再把
`dsh-web-mobile` 作为第二个 Profile 插件安装。

> 当前地址使用 HTTP；配对可以阻止未授权设备和跨站请求，但不能抵御已控制同一
> 局域网链路的流量窃听。只应在可信的专用网络使用。Windows 防火墙应仅允许
> Private 网络的 TCP 3080，并按需要进一步限制 WLAN/LocalSubnet。

## 配置页面

host 安装后无需碰终端：浏览器打开 **`http://127.0.0.1:<DSH上游端口>/wxb/config`**
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
- 依赖 Node.js ≥ 22；`/wxb/*` 端点只允许回环请求，移动端网关明确阻止转发。
- 普通 Web Profile 必须把自身从默认 3080 移到 3081，才能同时启动 3080 移动网关；
  DSH Desktop 继续使用自己的回环动态端口，不需要改 DSH 或 Desktop 核心源码。

## 第三方 UI

移动端 UI 派生自 MIT 许可的
[`mexiaosqwq/dsh-web-mobile`](https://github.com/mexiaosqwq/dsh-web-mobile)，
固定提交 `a96035f1b18162adefa5d322b24123159fb85855`。原始许可证保存在
`vendor/dsh-web-mobile/LICENSE`，详情见 `THIRD_PARTY_NOTICES.md`。

## License

MIT
