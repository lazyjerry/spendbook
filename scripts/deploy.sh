#!/bin/sh
# 部署：先套 D1 migration，再部署 Worker。
# 有 wrangler.local.jsonc（本機、含實際的資料庫編號與自訂網域）就用它；沒有（Deploy Button、Workers Builds）就用進版控的 wrangler.jsonc。
# migration 用 binding 名稱 DB 指定，資料庫改名也找得到。
set -eu
cd "$(dirname "$0")/.."

config=wrangler.jsonc
[ -f wrangler.local.jsonc ] && config=wrangler.local.jsonc
echo "使用設定檔：$config" >&2

npx wrangler d1 migrations apply DB --remote -c "$config"
exec npx wrangler deploy -c "$config" "$@"
