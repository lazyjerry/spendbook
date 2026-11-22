#!/usr/bin/env bash
# 靜態檢查：JS 語法、頁面引用的站內檔案都存在、PWA 需要的檔案沒被排除。
set -euo pipefail
cd "$(dirname "$0")/.."
for f in public/js/*.js src/*.js public/sw.js; do node --check "$f"; done
echo "JS 語法檢查通過"

missing=0
for page in public/*.html; do
  while IFS= read -r ref; do
    ref=${ref%%\?*}
    [ -f "public/${ref#/}" ] || { echo "$page 引用的檔案不存在：$ref" >&2; missing=1; }
  done < <(grep -oE '(src|href)="[^"#:]+\.(js|css|png|ico|webmanifest)"' "$page" | sed -E 's/^(src|href)="//; s/"$//')
done
[ "$missing" -eq 0 ] || exit 1
echo "頁面引用檢查通過"

for f in public/manifest.webmanifest public/sw.js public/offline.html public/icons/icon-192.png public/icons/icon-512.png public/icons/icon-maskable-512.png public/icons/apple-touch-icon.png public/favicon.ico; do
  [ -f "$f" ] || { echo "缺 PWA 檔案：$f" >&2; exit 1; }
  if git check-ignore -q "$f"; then echo "PWA 檔案被 .gitignore 排除：$f" >&2; exit 1; fi
done
echo "PWA 檔案檢查通過"
