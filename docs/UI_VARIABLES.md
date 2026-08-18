# dsh-wechat-bridge Desktop UI 变量说明

## 适用范围

本文件覆盖 `client.js` 注册到 DSH Desktop/Web 设置列表的“远程控制”设置页、其内部的“微信桥接”“移动端远程”导航页，以及从 `mexiaosqwq/dsh-web-mobile`（MIT，固定提交 `a96035f`）迁移的手机竖屏导航和响应式界面。运行时主题变量由 DeepSeek Harness 提供，变量源为 `packages/client/ui-theme/src/styles/design-platform.css`；本插件不声明或覆盖任何 CSS 自定义属性。

## 复用规则

- 仅“远程控制”通过 DSH 的 `settings.section` 槽位挂载；“微信桥接”和“移动端远程”是该页面内部导航，不自行创建窗口、主题或图标。
- 操作控件仅使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` 与 `Input`。
- 手机导航继续使用 DSH 的 `slots`、`layout`、`locale`、`sessionLogDownload` 和内置图标，不创建第二套应用壳。
- 颜色、边框、遮罩和状态表意只使用下表中 DSH 已有变量；`scripts/build-client.mjs` 会拒绝上游 `--aion-*`、`--ds-*`、十六进制和 `rgb()/rgba()` 原始颜色进入最终 bundle。

| 变量 | 层级 | 当前引用 | 中文说明 | 来源 | 主要使用位置 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `--dsw-alias-label-primary` | 语义 | DSH 主题 | 主要文字与标题 | `design-platform.css` | 两页标题、卡片标题、工作区/对话字段标签、选择框与移动端地址 | 在用 |
| `--dsw-alias-label-secondary` | 语义 | DSH 主题 | 次级说明和连接详情 | `design-platform.css` | 两页状态详情与说明文案 | 在用 |
| `--dsw-alias-label-tertiary` | 语义 | DSH 主题 | 暂无二维码等低优先级提示 | `design-platform.css` | 空状态、元信息、禁用选择框与待生成配对二维码 | 在用 |
| `--dsw-alias-label-dimmed` | 语义 | DSH 主题 | 弱化的禁用图标和移动控件文字 | `design-platform.css` | 手机目录与悬浮控件禁用态 | 在用 |
| `--dsw-alias-bg-base` | 语义 | DSH 主题 | 应用基础表面背景 | `design-platform.css` | 手机目录抽屉、浮层基础表面 | 在用 |
| `--dsw-alias-bg-mask-2` | 语义 | DSH 主题 | 轻遮罩与手机浮层阴影颜色 | `design-platform.css` | 悬浮按钮、底部浮层阴影 | 在用 |
| `--dsw-alias-bg-mask-3` | 语义 | DSH 主题 | 目录打开后的较强背景遮罩 | `design-platform.css` | 手机目录 backdrop | 在用 |
| `--dsw-alias-bg-mask-photo` | 语义 | DSH 主题 | 高对比诊断浮层背景 | `design-platform.css` | `?mobile-nav-debug=1` 诊断徽章 | 在用 |
| `--dsw-alias-border-l2` | 语义 | DSH 主题 | 设置区块与二维码容器的标准细边框 | `design-platform.css` | 两页头部分隔、卡片、二维码、地址与工作区/对话选择框 | 在用 |
| `--dsw-alias-border-l1` | 语义 | DSH 主题 | 手机控件和兼容浮层的轻边框 | `design-platform.css` | 目录按钮、文件/预览浮层、设置横向滚动条 | 在用 |
| `--dsw-alias-bg-module-platform` | 语义 | DSH 主题 | 模块状态提示底色 | `design-platform.css` | 状态条、工作区/对话选择框、配对二维码占位和地址底色 | 在用 |
| `--dsw-static-neutral-00` | 基础 | DSH 主题 | 保证二维码在深浅主题下都保留白底扫描区 | `design-platform.css` | 二维码图像容器 | 在用 |
| `--dsw-alias-button-floating-fill` / `--dsw-alias-button-floating-hover` | 语义 | DSH 主题 | 手机悬浮目录按钮的默认和悬停表面 | `design-platform.css` | 无会话页面的目录 FAB | 在用 |
| `--dsw-alias-interactive-bg-hover` / `--dsw-alias-interactive-bg-hover-solid` | 语义 | DSH 主题 | 手机按钮、预览控制和兼容行的交互反馈 | `design-platform.css` | 目录按钮、预览全屏按钮、文件树活动行 | 在用 |
| `--dsw-alias-state-success-primary` / `--dsw-alias-state-success-tertiary` | 语义 | DSH 主题 | 在线状态的文字与浅底色 | `design-platform.css` | 在线状态胶囊 | 在用 |
| `--dsw-alias-state-warn-label` / `--dsw-alias-state-warn-tertiary` | 语义 | DSH 主题 | 等待扫码、配对码和连接中的提示色 | `design-platform.css` | 等待状态胶囊、移动端远程停止状态和安全边界提示 | 在用 |
| `--dsw-alias-state-error-primary` | 语义 | DSH 主题 | 连接或接口错误的文字色 | `design-platform.css` | 错误提示 | 在用 |
| `--dsw-alias-interactive-bg-hover-danger` | 语义 | DSH 主题 | 错误状态胶囊的轻量背景 | `design-platform.css` | 错误状态胶囊 | 在用 |
| `--dsw-alias-state-business-primary` | 语义 | DSH 主题 | 手机控件键盘焦点轮廓 | `design-platform.css` | 目录、文件和全屏预览按钮焦点态 | 在用 |

## 合法硬编码

`client.js` 中的像素尺寸、`768px`/`1023px` 响应式断点、百分比、`env(safe-area-inset-*)`、`dvh`、过渡时长和标准缓动只描述 DSH 现有结构的移动端几何、触控尺寸、安全区和动效，不承载颜色或主题语义。`1023px` 与 DSH 的 sidebar 自动折叠阈值一致；`768px` 区分手机与平板竖屏。二维码黑白像素和 `image-rendering: pixelated` 属于可扫描内容，不是设计令牌。

## 本次同步记录

- 2026-08-17：新增 Desktop “微信桥接”设置页，复用 DSH 的 `settings.section`、`Button`、`Input`、图标和上述主题变量；未新增、修改或覆盖任何 DSH 变量。
- 2026-08-18：新增“微信转发目标”的工作区与对话选择控件，复用已有 `--dsw-alias-label-primary`、`--dsw-alias-label-tertiary`、`--dsw-alias-border-l2`、`--dsw-alias-bg-module-platform` 和 `Button`；未新增、修改或覆盖任何 DSH 变量。
- 2026-08-18：拆分“微信桥接”与“移动端远程”两个设置导航页；移动端页新增停止状态、配对二维码占位、LAN/Reader 地址与安全提示，复用 `Button`、内置图标和现有 `--dsw-*` 变量；未新增、修改、废弃或覆盖任何 DSH 变量。
- 2026-08-18：将微信桥接与移动端远程从两个 `settings.section` 注册项收敛为一个“远程控制”注册项；内部导航复用 `Button`、现有 `--dsw-*` 变量和 `--dsw-alias-border-l2`；未新增、修改或覆盖任何 DSH 变量。
- 2026-08-18：迁移 `dsh-web-mobile` 1.0.0 的手机目录、会话头部、设置 sheet、文件/预览浮层和正文响应式适配；上游非 DSH 颜色变量统一映射到 23 个已存在的 `--dsw-*` 变量，最终 bundle 未保留原始颜色或非 `--dsw-*` 视觉变量。
- 2026-08-18：移动端远程页接通启动/停止、一次性配对二维码、设备状态和撤销操作；新增布局类只复用既有设置页变量，未新增、修改、废弃或覆盖 DSH 变量。
- 2026-08-18：修复手机网关旧 HTML 缓存导致的旧客户端复用；移动端悬浮目录按钮固定到视口左上安全区，composer 明确保持权限模式在“+”右侧、发送按钮在右下；仅复用已有 `--dsw-*` 变量，未新增、修改或废弃变量，并确认 `/api/workspace.list` 不在网关阻断列表。
