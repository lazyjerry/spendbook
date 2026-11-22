#!/usr/bin/env bash
# API 冒煙測試：對一個跑起來的站台走一遍登入、紀錄增刪改查、搜尋、分頁、照片、設定。
# 用法：bash scripts/smoke-api.sh [網址] [帳號] [密碼]
# 沒給網址時自己用暫存資料庫起一個 wrangler dev（不動 .wrangler/ 的本機資料），跑完關掉。
set -uo pipefail
cd "$(dirname "$0")/.."
BASE=${1:-}
USERNAME=${2:-admin}
PASSWORD=${3:-}
tmp=$(mktemp -d)
jar="$tmp/cookies"
dev_pid=""
cleanup() {
  [ -n "$dev_pid" ] && kill "$dev_pid" 2>/dev/null
  rm -rf "$tmp"
}
trap cleanup EXIT

if [ -z "$BASE" ]; then
  port=8797
  BASE="http://localhost:$port"
  PASSWORD="smoke-test-password"
  printf 'APP_PASSWORD=%s\n' "$PASSWORD" > "$tmp/vars"
  npx wrangler d1 migrations apply DB --local --persist-to "$tmp/state" > /dev/null 2>&1 || { echo "套用本機 migration 失敗" >&2; exit 1; }
  npx wrangler dev --port "$port" --persist-to "$tmp/state" --env-file "$tmp/vars" > "$tmp/dev.log" 2>&1 &
  dev_pid=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$BASE/login" && break
    sleep 0.5
  done
fi

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "  ✓ $1"; }
ng() { fail=$((fail + 1)); echo "  ✗ $1（$2）"; }
# req <方法> <路徑> [JSON]：回應本文寫到 $tmp/body，印出狀態碼
req() {
  local method=$1 path=$2 data=${3:-}
  if [ -n "$data" ]; then
    curl -s -o "$tmp/body" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" -H 'Content-Type: application/json' --data "$data" "$BASE$path"
  else
    curl -s -o "$tmp/body" -w '%{http_code}' -b "$jar" -c "$jar" -X "$method" "$BASE$path"
  fi
}
expect() { # expect <說明> <期望狀態碼> <實際狀態碼>
  if [ "$2" = "$3" ]; then ok "$1"; else ng "$1" "期望 $2，得到 $3：$(head -c 200 "$tmp/body")"; fi
}
field() { node -e 'let d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const k of process.argv[2].split("."))d=d?.[k];process.stdout.write(String(d))' "$tmp/body" "$1"; }

echo "對 $BASE 測試"
expect "未登入的 API 回 401" 401 "$(req GET /api/records)"
expect "未登入開首頁轉到登入頁" 302 "$(curl -s -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE/")"
expect "登入頁免登入" 200 "$(curl -s -o /dev/null -w '%{http_code}' -L "$BASE/login")"
expect "manifest 免登入" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/manifest.webmanifest")"
# JSON 先組進變數：bash 3.2 在 "$( … "{\"a\",\"b\"}" )" 這種巢狀引號裡會對大括號做展開，把內容弄壞
bad_login=$(printf '{"username":"%s","password":"wrong-password"}' "$USERNAME")
good_login=$(printf '{"username":"%s","password":"%s"}' "$USERNAME" "$PASSWORD")
expect "密碼錯誤回 401" 401 "$(req POST /api/login "$bad_login")"
expect "登入成功" 200 "$(req POST /api/login "$good_login")"
expect "讀帳號" 200 "$(req GET /api/account)"

expect "缺標題回 422" 422 "$(req POST /api/records '{"title":"","currency":"TWD","amount":"100","occurredAt":"2026-11-20T04:00:00.000Z"}')"
expect "不在清單的幣別回 422" 422 "$(req POST /api/records '{"title":"x","currency":"XXX","amount":"100","occurredAt":"2026-11-20T04:00:00.000Z"}')"
expect "日圓帶小數回 422" 422 "$(req POST /api/records '{"title":"x","currency":"JPY","amount":"100.5","occurredAt":"2026-11-20T04:00:00.000Z"}')"
long=$(node -e 'process.stdout.write("字".repeat(1025))')
long_body=$(printf '{"title":"x","currency":"TWD","amount":"1","description":"%s","occurredAt":"2026-11-20T04:00:00.000Z"}' "$long")
expect "描述超過 1024 字回 422" 422 "$(req POST /api/records "$long_body")"

expect "新增紀錄" 201 "$(req POST /api/records '{"title":"冒煙測試午餐","currency":"TWD","amount":"120.5","description":"牛肉麵加蛋","occurredAt":"2026-11-20T04:00:00.000Z"}')"
id1=$(field record.id)
[ "$(field record.amountMinor)" = "12050" ] && ok "金額存成最小單位" || ng "金額存成最小單位" "$(field record.amountMinor)"
expect "新增第二筆（日圓）" 201 "$(req POST /api/records '{"title":"冒煙測試拉麵","currency":"JPY","amount":"980","occurredAt":"2026-11-21T10:30:00.000Z"}')"
id2=$(field record.id)
expect "讀單筆" 200 "$(req GET "/api/records/$id1")"
expect "修改紀錄" 200 "$(req PUT "/api/records/$id1" '{"title":"冒煙測試午餐改","currency":"TWD","amount":"130","description":"","occurredAt":"2026-11-20T04:00:00.000Z"}')"
[ "$(field record.amountMinor)" = "13000" ] && ok "修改後的金額" || ng "修改後的金額" "$(field record.amountMinor)"

expect "搜尋" 200 "$(req GET "/api/records?q=$(node -e 'process.stdout.write(encodeURIComponent("冒煙測試 拉麵"))')")"
[ "$(field records.0.id)" = "$id2" ] && [ "$(field records.length)" = "1" ] && ok "搜尋只回符合全部關鍵字的" || ng "搜尋結果" "$(head -c 200 "$tmp/body")"
expect "依時間範圍查" 200 "$(req GET '/api/records?from=2026-11-20T00:00:00.000Z&to=2026-11-21T00:00:00.000Z')"
[ "$(field records.0.id)" = "$id1" ] && [ "$(field records.length)" = "1" ] && ok "範圍只含起、不含訖" || ng "範圍結果" "$(head -c 200 "$tmp/body")"
expect "分頁第一頁" 200 "$(req GET "/api/records?limit=1&q=$(node -e 'process.stdout.write(encodeURIComponent("冒煙測試"))')")"
cursor=$(field nextCursor)
[ "$(field records.0.id)" = "$id2" ] && [ "$cursor" != "null" ] && [ "$cursor" != "undefined" ] && ok "新的排前面、有下一頁" || ng "分頁排序" "$(head -c 200 "$tmp/body")"
expect "分頁第二頁" 200 "$(req GET "/api/records?limit=1&cursor=$cursor&q=$(node -e 'process.stdout.write(encodeURIComponent("冒煙測試"))')")"
[ "$(field records.0.id)" = "$id1" ] && ok "第二頁是較舊的那筆" || ng "第二頁" "$(head -c 200 "$tmp/body")"

# 1x1 JPEG
node -e 'require("fs").writeFileSync(process.argv[1],Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=","base64"))' "$tmp/p.jpg"
code=$(curl -s -o "$tmp/body" -w '%{http_code}' -b "$jar" -X PUT -H 'Content-Type: image/jpeg' --data-binary "@$tmp/p.jpg" "$BASE/api/records/$id1/photo?w=1&h=1")
expect "上傳照片" 200 "$code"
key=$(field record.photoKey)
expect "讀照片" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/$key")"
expect "未登入讀不到照片" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/media/$key")"
expect "別的帳號的照片 key 回 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/u999/00000000-0000-0000-0000-000000000000.jpg")"
code=$(curl -s -o "$tmp/body" -w '%{http_code}' -b "$jar" -X PUT -H 'Content-Type: image/png' --data-binary "@$tmp/p.jpg" "$BASE/api/records/$id1/photo")
expect "非 JPEG 回 415" 415 "$code"
expect "移除照片" 200 "$(req DELETE "/api/records/$id1/photo")"
expect "移除後照片讀不到" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/$key")"

expect "存設定" 200 "$(req PUT /api/settings '{"nickname":"測試","defaultCurrency":"JPY","weekStart":0,"maxEdge":1280,"quality":70}')"
expect "讀設定" 200 "$(req GET /api/settings)"
[ "$(field settings.defaultCurrency)" = "JPY" ] && ok "設定有存起來" || ng "設定內容" "$(head -c 200 "$tmp/body")"
expect "還原設定" 200 "$(req PUT /api/settings '{}')"

expect "刪除第一筆" 200 "$(req DELETE "/api/records/$id1")"
expect "刪除第二筆" 200 "$(req DELETE "/api/records/$id2")"
expect "刪除後讀不到" 404 "$(req GET "/api/records/$id1")"
expect "登出" 200 "$(req POST /api/logout)"
expect "登出後 API 回 401" 401 "$(req GET /api/records)"

echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ]
