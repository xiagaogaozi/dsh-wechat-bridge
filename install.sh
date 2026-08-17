#!/usr/bin/env bash
# Install dsh-wechat-bridge as a DSH bundle. The bundle path is required so
# the Desktop/Web client entry is discovered alongside the bridge host entry.
set -euo pipefail

PROFILE_NAME="${DSH_PROFILE:-web}"
PACKAGE_SPEC="${DSH_WECHAT_BRIDGE_PACKAGE:-github:xiagaogaozi/dsh-wechat-bridge}"

if command -v dsh >/dev/null 2>&1; then
  DSH_BIN="dsh"
elif [ -x "${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE_NAME}/node_modules/.bin/dsh" ]; then
  DSH_BIN="${DSH_HOME:-$HOME/.dsh}/profiles/${PROFILE_NAME}/node_modules/.bin/dsh"
else
  echo "未找到 dsh 命令。请先启动一次 DSH，或把 dsh 加入 PATH。" >&2
  exit 1
fi

echo "==> 安装 dsh-wechat-bridge 到 profile: ${PROFILE_NAME}"
"${DSH_BIN}" plugin --profile "${PROFILE_NAME}" add "${PACKAGE_SPEC}"
echo "==> 安装完成。重启 DSH Desktop，然后打开 设置 → 微信桥接。"
