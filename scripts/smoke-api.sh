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
[ "$(field initialPassword)" = "true" ] || [ -z "$dev_pid" ] && ok "第一次登入回報還在用初始密碼" || ng "初始密碼旗標" "$(head -c 200 "$tmp/body")"
expect "讀帳號" 200 "$(req GET /api/account)"
[[ "$(field id)" =~ ^[1-9][0-9]*$ ]] && ok "帳號帶編號（編輯頁草稿依它區隔帳號）" || ng "帳號編號" "$(head -c 200 "$tmp/body")"

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

# 類別與地點（選填）
expect "類別含空白回 422" 422 "$(req POST /api/records '{"title":"x","currency":"TWD","amount":"1","occurredAt":"2026-11-20T04:00:00.000Z","categories":["家 電"]}')"
expect "只填緯度回 422" 422 "$(req POST /api/records '{"title":"x","currency":"TWD","amount":"1","occurredAt":"2026-11-20T04:00:00.000Z","lat":25}')"
expect "緯度超出範圍回 422" 422 "$(req POST /api/records '{"title":"x","currency":"TWD","amount":"1","occurredAt":"2026-11-20T04:00:00.000Z","lat":91,"lng":121}')"
place_body='{"title":"冒煙測試冷氣","currency":"TWD","amount":"42800","occurredAt":"2026-11-19T04:00:00.000Z","categories":["#家電","冒煙類別","家電"],"place":"冒煙測試電器行","lat":25.0478123456,"lng":121.517}'
expect "新增有類別與地點的紀錄" 201 "$(req POST /api/records "$place_body")"
id3=$(field record.id)
[ "$(field record.categories.length)" = "2" ] && [ "$(field record.categories.0)" = "家電" ] && ok "類別去掉 # 並去重" || ng "類別內容" "$(head -c 200 "$tmp/body")"
[ "$(field record.lat)" = "25.047812" ] && [ "$(field record.place)" = "冒煙測試電器行" ] && ok "地點與座標存起來（小數 6 位）" || ng "地點內容" "$(head -c 200 "$tmp/body")"
expect "搜尋比對類別" 200 "$(req GET "/api/records?q=$(node -e 'process.stdout.write(encodeURIComponent("冒煙類別"))')")"
[ "$(field records.0.id)" = "$id3" ] && [ "$(field records.length)" = "1" ] && ok "依類別搜得到" || ng "類別搜尋" "$(head -c 200 "$tmp/body")"
expect "類別清單" 200 "$(req GET /api/categories)"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(d.categories.some(c=>c.name==="冒煙類別"&&c.count>=1)?0:1)' "$tmp/body" && ok "類別清單含剛用的類別" || ng "類別清單內容" "$(head -c 200 "$tmp/body")"
clear_body='{"title":"冒煙測試冷氣","currency":"TWD","amount":"42800","occurredAt":"2026-11-19T04:00:00.000Z","categories":[],"place":"","lat":null,"lng":null}'
expect "清除類別與地點" 200 "$(req PUT "/api/records/$id3" "$clear_body")"
[ "$(field record.lat)" = "null" ] && [ "$(field record.categories.length)" = "0" ] && ok "清除後座標為空" || ng "清除結果" "$(head -c 200 "$tmp/body")"
expect "刪除有地點的那筆" 200 "$(req DELETE "/api/records/$id3")"
expect "地點查詢缺文字回 400" 400 "$(req GET /api/geo/search)"
expect "座標反查格式錯誤回 400" 400 "$(req GET '/api/geo/reverse?lat=abc&lng=121')"

# 1x1 JPEG
node -e 'require("fs").writeFileSync(process.argv[1],Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=","base64"))' "$tmp/p.jpg"
upload() { curl -s -o "$tmp/body" -w '%{http_code}' -b "$jar" -X POST -H "Content-Type: ${2:-image/jpeg}" --data-binary "@$tmp/p.jpg" "$BASE/api/records/$1/photos?w=1&h=1"; }
expect "上傳第一張照片" 201 "$(upload "$id1")"
key=$(field record.photos.0.key)
expect "上傳第二張照片" 201 "$(upload "$id1")"
[ "$(field record.photos.length)" = "2" ] && [ "$(field record.photos.0.key)" = "$key" ] && ok "兩張照片依上傳順序" || ng "照片清單" "$(head -c 300 "$tmp/body")"
photo2=$(field record.photos.1.id)
key2=$(field record.photos.1.key)
photo1=$(field record.photos.0.id)
expect "列表帶照片清單" 200 "$(req GET "/api/records?limit=200")"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(d.records.some(r=>r.id===Number(process.argv[2])&&r.photos.length===2)?0:1)' "$tmp/body" "$id1" && ok "列表的紀錄有兩張照片" || ng "列表的照片" "$(head -c 300 "$tmp/body")"
expect "讀照片" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/$key")"
expect "未登入讀不到照片" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/media/$key")"
expect "別的帳號的照片 key 回 404" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/u999/00000000-0000-0000-0000-000000000000.jpg")"
expect "非 JPEG 回 415" 415 "$(upload "$id1" image/png)"
expect "不存在的紀錄上傳照片回 404" 404 "$(upload 999999)"
for _ in 3 4 5 6 7 8 9 10; do upload "$id1" > /dev/null; done
expect "超過 10 張回 409" 409 "$(upload "$id1")"
expect "移除第二張照片" 200 "$(req DELETE "/api/records/$id1/photos/$photo2")"
[ "$(field record.photos.length)" = "9" ] && [ "$(field record.photos.0.key)" = "$key" ] && ok "移除後剩下其他照片" || ng "移除後的照片清單" "$(head -c 300 "$tmp/body")"
expect "移除後那張讀不到" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/$key2")"
expect "再移除同一張回 404" 404 "$(req DELETE "/api/records/$id1/photos/$photo2")"
expect "別筆紀錄的路徑移除不了照片" 404 "$(req DELETE "/api/records/$id2/photos/$photo1")"

expect "存設定" 200 "$(req PUT /api/settings '{"nickname":"測試","defaultCurrency":"JPY","weekStart":0,"maxEdge":1280,"quality":70}')"
expect "讀設定" 200 "$(req GET /api/settings)"
[ "$(field settings.defaultCurrency)" = "JPY" ] && ok "設定有存起來" || ng "設定內容" "$(head -c 200 "$tmp/body")"
expect "還原設定" 200 "$(req PUT /api/settings '{}')"

expect "刪除第一筆" 200 "$(req DELETE "/api/records/$id1")"
expect "刪除第二筆" 200 "$(req DELETE "/api/records/$id2")"
expect "刪除後讀不到" 404 "$(req GET "/api/records/$id1")"
expect "刪除紀錄後照片一併刪除" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$jar" "$BASE/media/$key")"
# 改帳號與密碼會動到真的帳號，只在自己起的暫存站台上測
if [ -n "$dev_pid" ]; then
  [ "$(req GET /api/account >/dev/null; field initialPassword)" = "true" ] && ok "還沒改密碼前帳號帶初始密碼旗標" || ng "帳號的初始密碼旗標" "$(head -c 200 "$tmp/body")"
  body=$(printf '{"currentPassword":"%s","username":"smoke.user"}' "$PASSWORD")
  expect "修改帳號" 200 "$(req PUT /api/account/username "$body")"
  expect "目前的密碼錯誤時不能改密碼" 400 "$(req PUT /api/account/password '{"currentPassword":"wrong-password","newPassword":"new-smoke-password"}')"
  body=$(printf '{"currentPassword":"%s","newPassword":"new-smoke-password"}' "$PASSWORD")
  expect "修改密碼" 200 "$(req PUT /api/account/password "$body")"
  [ "$(req GET /api/account >/dev/null; field initialPassword)" = "false" ] && ok "改過密碼後不再帶初始密碼旗標" || ng "改密碼後的旗標" "$(head -c 200 "$tmp/body")"
  expect "舊帳號密碼不能再登入" 401 "$(req POST /api/login "$good_login")"
  expect "新帳號密碼可以登入" 200 "$(req POST /api/login '{"username":"smoke.user","password":"new-smoke-password"}')"
  [ "$(field initialPassword)" = "false" ] && ok "之後登入不再提示" || ng "登入的初始密碼旗標" "$(head -c 200 "$tmp/body")"
fi
expect "登出" 200 "$(req POST /api/logout)"
expect "登出後 API 回 401" 401 "$(req GET /api/records)"

echo "通過 $pass 項，失敗 $fail 項"
[ "$fail" -eq 0 ]
