# dsh-wechat-bridge Desktop UI 变量说明

## 适用范围

本文件仅覆盖 `client.js` 注册到 DSH Desktop/Web 设置列表的“微信桥接”页面。运行时主题变量由 DeepSeek Harness 提供，变量源为 `packages/client/ui-theme/src/styles/design-platform.css`；本插件不声明或覆盖任何 CSS 自定义属性。

## 复用规则

- 设置页通过 DSH 的 `settings.section` 槽位挂载，不自行创建窗口、主题或图标。
- 操作控件仅使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button` 与 `Input`。
- 颜色、边框和状态表意只使用下表中 DSH 已有变量；布局尺寸沿用 DSH 设置页的 8/12/16px 间距节奏，不新增命名变量。

| 变量 | 层级 | 当前引用 | 中文说明 | 来源 | 主要使用位置 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `--dsw-alias-label-primary` | 语义 | DSH 主题 | 主要文字与标题 | `design-platform.css` | 页面标题、卡片标题、工作区/对话字段标签与选择框 | 在用 |
| `--dsw-alias-label-secondary` | 语义 | DSH 主题 | 次级说明和连接详情 | `design-platform.css` | 状态详情、说明文案 | 在用 |
| `--dsw-alias-label-tertiary` | 语义 | DSH 主题 | 暂无二维码等低优先级提示 | `design-platform.css` | 空状态、元信息、禁用选择框 | 在用 |
| `--dsw-alias-border-l2` | 语义 | DSH 主题 | 设置区块与二维码容器的标准细边框 | `design-platform.css` | 头部分隔、卡片、二维码、工作区/对话选择框 | 在用 |
| `--dsw-alias-bg-module-platform` | 语义 | DSH 主题 | 模块状态提示底色 | `design-platform.css` | 连接状态条、工作区/对话选择框底色 | 在用 |
| `--dsw-static-neutral-00` | 基础 | DSH 主题 | 保证二维码在深浅主题下都保留白底扫描区 | `design-platform.css` | 二维码图像容器 | 在用 |
| `--dsw-alias-state-success-primary` / `--dsw-alias-state-success-tertiary` | 语义 | DSH 主题 | 在线状态的文字与浅底色 | `design-platform.css` | 在线状态胶囊 | 在用 |
| `--dsw-alias-state-warn-label` / `--dsw-alias-state-warn-tertiary` | 语义 | DSH 主题 | 等待扫码、配对码和连接中的提示色 | `design-platform.css` | 等待状态胶囊 | 在用 |
| `--dsw-alias-state-error-primary` | 语义 | DSH 主题 | 连接或接口错误的文字色 | `design-platform.css` | 错误提示 | 在用 |
| `--dsw-alias-interactive-bg-hover-danger` | 语义 | DSH 主题 | 错误状态胶囊的轻量背景 | `design-platform.css` | 错误状态胶囊 | 在用 |

## 合法硬编码

`client.js` 中的 8/12/16/20/22/24px、`999px` 和 `100%` 只描述 DSH 设置页已有的布局节奏、可访问的行高和内容尺寸；它们不承载颜色、主题或可复用设计语义，因此没有新增变量。二维码本身由微信登录链接生成，其黑白像素不属于页面设计令牌。

## 本次同步记录

- 2026-08-17：新增 Desktop “微信桥接”设置页，复用 DSH 的 `settings.section`、`Button`、`Input`、图标和上述主题变量；未新增、修改或覆盖任何 DSH 变量。
- 2026-08-18：新增“微信转发目标”的工作区与对话选择控件，复用已有 `--dsw-alias-label-primary`、`--dsw-alias-label-tertiary`、`--dsw-alias-border-l2`、`--dsw-alias-bg-module-platform` 和 `Button`；未新增、修改或覆盖任何 DSH 变量。
