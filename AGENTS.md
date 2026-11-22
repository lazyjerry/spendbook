# 花錢事件簿

單一 Cloudflare Worker：靜態頁面（`public/`）加 `/api/*` 與 `/media/*`。紀錄、設定、帳號存 D1，壓縮後的照片存 R2。原生 JavaScript，沒有建置步驟。功能與部署見 `README.md`。

## 規則

- **頁面是產出物**：`public/*.html` 由 `scripts/build_pages.py` 把 `scripts/pages/<頁面>.html` 套進共用頁面殼產生，不手改。改完跑 `npm run pages`。
- **樣式**：`public/jerry-ui.css`、`public/jerry-ui.js` 是 Jerry UI 的成品，不改。專案專屬樣式寫在 `public/app.css`，只用 `.app-` 開頭的 class 與 Jerry UI 的 token。
- **資料以帳號隔離**：`src/db.js` 每個查詢都帶 `user_id`；照片 key 是 `u<帳號編號>/<uuid>.jpg`，`src/media.js` 讀取時核對擁有者。新增查詢或資料表時照做。
- **金額存整數**：`records.amount_minor` 是幣別的最小單位。幣別清單有兩份要一起改：`src/db.js` 的 `CURRENCIES`、`public/js/common.js` 的 `CURRENCIES`。設定預設值同理（兩邊的 `DEFAULT_SETTINGS`）。
- **時間**：`occurred_at` 存 UTC ISO 字串；依日期分組、範圍換算都在前端用裝置時區做，後端只比對 UTC 時間。
- **service worker 不快取私人資料**：`public/sw.js` 只預先快取離線頁與它用到的檔案。改了這些檔案要把 `VERSION` 加一。
- **機密**：`APP_PASSWORD` 用 `wrangler secret put`，本機放 `.dev.vars`。設定檔、程式碼、文件、log 只寫變數名稱。
- **個人部署資訊不進版控**：實際的資料庫編號與自訂網域只寫在 `wrangler.local.jsonc`；進版控的 `wrangler.jsonc` 是給 Deploy Button 與本機測試用的通用設定。
- **錯誤訊息**：一律繁體中文，說明哪裡錯、怎麼改；回給前端的錯誤不含堆疊。

## 驗證

`npm test` 要通過：`scripts/check.sh`（JS 語法、頁面引用、PWA 檔案）加 `scripts/smoke-api.sh`（用暫存資料庫起一個 `wrangler dev`，從 HTTP 介面走一遍登入、紀錄、搜尋、分頁、照片、設定）。改 API 先在 `smoke-api.sh` 加會失敗的檢查。
