# dsh-wechat-bridge Desktop UI 变量说明

## 适用范围

本文件覆盖 `client.js` 注册到 DSH Desktop/Web 设置列表的唯一“远程控制”设置页，以及页面内部的“微信桥接”和“移动端远程”导航页。移动端应用 UI 不再由本插件内置，用户可单独安装原版 `dsh-web-mobile` 插件。运行时主题变量由 DeepSeek Harness 提供；本插件不声明或覆盖任何 CSS 自定义属性。

## 复用规则

- 仅“远程控制”通过 DSH 的 `settings.section` 槽位挂载；两个功能页是该页面内部导航，不自行创建窗口或主题。
- 操作控件仅使用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Button`、`Input` 和内置图标。
- 颜色、边框和状态表意只使用 DSH 已有的 `--dsw-*` 变量。

| 变量 | 用途 | 主要使用位置 |
| --- | --- | --- |
| `--dsw-alias-label-primary` | 主要文字与标题 | 页面标题、卡片标题、字段标签、地址 |
| `--dsw-alias-label-secondary` | 次级说明 | 状态详情与说明文案 |
| `--dsw-alias-label-tertiary` | 低优先级提示 | 空状态、元信息、二维码占位 |
| `--dsw-alias-border-l2` | 标准细边框 | 头部分隔、卡片、二维码、地址和选择框 |
| `--dsw-alias-bg-module-platform` | 模块表面底色 | 状态条、选择框、二维码占位和地址 |
| `--dsw-alias-state-success-primary` / `--dsw-alias-state-success-tertiary` | 在线状态 | 状态胶囊 |
| `--dsw-alias-state-warn-label` / `--dsw-alias-state-warn-tertiary` | 等待和安全提示 | 等待状态、停止状态、安全边界提示 |
| `--dsw-alias-state-error-primary` / `--dsw-alias-interactive-bg-hover-danger` | 错误状态 | 错误提示和状态胶囊 |

## 同步记录

- 2026-08-18：将两个设置注册项收敛为一个“远程控制”注册项；内部导航复用 `Button`、图标和现有 `--dsw-*` 变量。
- 2026-08-19：移除 Bridge 内置的 `dsh-web-mobile` UI；移动端 UI 改由用户自行安装的独立插件提供。
