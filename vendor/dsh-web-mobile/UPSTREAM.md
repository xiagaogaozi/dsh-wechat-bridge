# dsh-web-mobile migration source

- Upstream: https://github.com/mexiaosqwq/dsh-web-mobile
- Pinned commit: `a96035f1b18162adefa5d322b24123159fb85855`
- Upstream package version: `1.0.0`
- License: MIT; the original notice is preserved in `LICENSE`.

`client.js` is the upstream built client bundle. `scripts/build-client.mjs`
embeds its mobile navigation and responsive UI into the single
`dsh-wechat-bridge` client module, renames ownership labels, and maps visual
colour variables to DSH's built-in `--dsw-*` theme variables. No separate
`dsh-web-mobile` profile dependency is required at runtime.
