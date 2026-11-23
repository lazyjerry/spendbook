#!/usr/bin/env bash
# 重拍 README 的截圖與操作影片。
# 用法：bash scripts/readme-media.sh [--port 8790]
#   在一次性的本機 D1／R2（暫存目錄，不碰 .wrangler/ 與正式環境）起 wrangler dev，
#   寫入 scripts/readme_media.py 裡的虛構示範紀錄，用 Playwright 拍 docs/readme-media/*.png，
#   再錄一段手機尺寸的操作影片：先轉成 docs/readme-media/demo.mp4（留在本機，不進版控），再由 mp4 轉 demo.gif。
#   需要：Python 3 + Playwright + Pillow、ffmpeg。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8790
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT=$2; shift 2 ;;
    *) echo "用法：bash scripts/readme-media.sh [--port 8790]" >&2; exit 2 ;;
  esac
done

command -v ffmpeg > /dev/null || { echo "缺 ffmpeg" >&2; exit 1; }
if curl -s -o /dev/null "http://localhost:$PORT/"; then echo "port $PORT 已被佔用，用 --port 換一個" >&2; exit 1; fi

STATE=$(mktemp -d)
PASS="readme-media-password"
DEV_PID=""
cleanup() {
  # 只 kill npx 會留下 workerd 子行程繼續佔 port，所以整個行程群組一起停
  if [ -n "$DEV_PID" ]; then kill -- "-$DEV_PID" 2> /dev/null || true; wait "$DEV_PID" 2> /dev/null || true; fi
  rm -rf "$STATE"
}
trap cleanup EXIT

echo "套用 migration 到暫存 D1"
npx wrangler d1 migrations apply DB --local --persist-to "$STATE/state" > "$STATE/migrate.log" 2>&1 \
  || { cat "$STATE/migrate.log" >&2; exit 1; }
# 當成已經改過密碼的帳號，畫面上才不會出現「請更新帳號與密碼」的提示
npx wrangler d1 execute DB --local --persist-to "$STATE/state" --command "UPDATE users SET password_changed_at = '2026-01-01T00:00:00.000Z'" > /dev/null 2>&1

echo "啟動 wrangler dev（port ${PORT}）"
printf 'APP_PASSWORD=%s\n' "$PASS" > "$STATE/vars"
set -m  # 背景工作自成行程群組，cleanup 才能整組停掉
npx wrangler dev --port "$PORT" --persist-to "$STATE/state" --env-file "$STATE/vars" > "$STATE/dev.log" 2>&1 < /dev/null &
DEV_PID=$!
set +m
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then break; fi
  if ! kill -0 "$DEV_PID" 2> /dev/null; then cat "$STATE/dev.log" >&2; exit 1; fi
  sleep 1
done
curl -s -o /dev/null "http://localhost:$PORT/login" || { echo "wrangler dev 60 秒內沒起來" >&2; tail -20 "$STATE/dev.log" >&2; exit 1; }

python3 scripts/readme_media.py "http://localhost:$PORT" "$PASS" --out docs/readme-media --video-dir "$STATE/video"

echo "轉檔影片"
WEBM=$(ls "$STATE"/video/*.webm | head -1)
MP4=docs/readme-media/demo.mp4
ffmpeg -loglevel error -y -i "$WEBM" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an "$MP4"
# fps 8 加上只重畫變動區塊（diff_mode），統計頁籤那段加長後 GIF 仍壓在 10MB 以內
ffmpeg -loglevel error -y -i "$MP4" \
  -vf "fps=8,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  docs/readme-media/demo.gif
ls -l docs/readme-media/
