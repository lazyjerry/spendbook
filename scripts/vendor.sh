#!/usr/bin/env bash
# 把 node_modules 內的 SimpleWebAuthn 前端（通行金鑰）複製到 public/vendor（自行託管，不走 CDN）。
# UMD 版，全域變數 SimpleWebAuthnBrowser。
set -euo pipefail
cd "$(dirname "$0")/.."
src=node_modules/@simplewebauthn/browser
[ -f "$src/dist/bundle/index.umd.min.js" ] || { echo "找不到 $src，請先執行 npm install" >&2; exit 1; }
wa=public/vendor/simplewebauthn
rm -rf "$wa"
mkdir -p "$wa"
cp "$src/dist/bundle/index.umd.min.js" "$wa/browser.umd.min.js"
cp "$src/LICENSE.md" "$wa/LICENSE.md"
echo "已複製 SimpleWebAuthn 到 $wa"
