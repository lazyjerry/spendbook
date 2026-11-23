#!/usr/bin/env bash
# 把 node_modules 內的前端套件複製到 public/vendor（自行託管，不走 CDN）：SimpleWebAuthn（通行金鑰）、Leaflet（地圖）。
# SimpleWebAuthn 用 UMD 版，全域變數 SimpleWebAuthnBrowser。
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

# Leaflet 地圖（編輯頁的地點），連同標記圖示與授權
src=node_modules/leaflet/dist
[ -f "$src/leaflet.js" ] || { echo "找不到 $src，請先執行 npm install" >&2; exit 1; }
dest=public/vendor/leaflet
rm -rf "$dest"
mkdir -p "$dest/images"
cp "$src/leaflet.js" "$src/leaflet.css" "$dest/"
cp "$src/images/"*.png "$dest/images/"
cp node_modules/leaflet/LICENSE "$dest/LICENSE.txt"
echo "已複製 Leaflet 到 $dest"
