# 花錢事件簿

花大錢的事件紀錄：只記金額大、或對使用者重要的花費，不是逐筆記帳的帳本。

單一 Cloudflare Worker：靜態頁面（`public/`）加 `/api/*` 與 `/media/*`。紀錄、設定、帳號存 D1，壓縮後的照片存 R2。原生 JavaScript，沒有建置步驟。功能與部署見 `README.md`。

## 產品定位

- **記的是事件，不是流水帳**：每一筆是一件值得記住的事（買車、旅行、換家電），重點在金額、時間與來龍去脈。
- **文案**：頁面標題、導言、欄位提示、空白狀態、範例文字都從「大筆花費、重要的事」出發；範例用機票、筆電、家電這類，不用午餐、咖啡。品牌名維持「花錢事件簿」，首屏主標用「花大錢／事件簿」。共用的標語在 `scripts/build_pages.py` 的 `TAGLINE`。
- **不做的功能**：預算、收支結餘、快速連續記帳、匯率換算、多人分帳。有人提這類需求時先確認是否偏離定位。
- **類別與地點是選填的標籤**：類別可多選，只用來整理與搜尋，不做類別預算或類別報表（`docs/afk-skill/adr/012`）；地點是名稱或地址加上選填的經緯度。新增或修改紀錄都不能因為沒填這兩項而擋下。
- **不設金額門檻**：多大算「大」由使用者決定，程式不擋小額。
- **示範資料**：README 截圖與測試用的示範紀錄也用大筆花費。
- **README 的圖與影片**：`docs/readme-media/` 由 `npm run readme-media`（`scripts/readme-media.sh` 加 `scripts/readme_media.py`）產生，不手動截圖。影片先錄成 `demo.mp4` 再轉 `demo.gif`；mp4 留在本機、不進版控，進版控的只有 gif 與 png。改了畫面或文案後重拍。

## 規則

- **頁面是產出物**：`public/*.html` 由 `scripts/build_pages.py` 把 `scripts/pages/<頁面>.html` 套進共用頁面殼產生，不手改。改完跑 `npm run pages`。
- **畫面照 Jerry UI 規範**：成品是 Worker，不是 Pages；`build-jerry-cloudflare-page` skill 在這裡只當畫面規範用，不走它的 Pages 發布流程。`public/jerry-ui.css`、`public/jerry-ui.js`、`public/jerry.png` 是元件庫的固定檔，不改。元件結構用 skill 的 `jerry-ui.py snippet <編號>` 產生；專案專屬樣式寫在 `public/app.css`，選擇器以 `.app-*` 為主體、值只用 token、不覆寫元件庫的 class。頁尾（L3:mono）不放連結。
- **首頁導言要短**：手機寬度下導言換成兩行，首屏大標就會超過規範的高度（視窗 1/3），`jerry-ui-visual.py` 會失敗。改 `scripts/build_pages.py` 的 `lede` 後要跑 visual。
- **畫面檢查**：`jerry-ui.py check public` 要 0 錯誤 0 警告（`npm run check` 會跑）；動到版面再跑 `jerry-ui-visual.py public/*.html`。
- **資料以帳號隔離**：`src/db.js` 每個查詢都帶 `user_id`；照片 key 是 `u<帳號編號>/<uuid>.jpg`，`src/media.js` 讀取時核對擁有者。新增查詢或資料表時照做。
- **金額存整數**：`records.amount_minor` 是幣別的最小單位。幣別清單有兩份要一起改：`src/db.js` 的 `CURRENCIES`、`public/js/common.js` 的 `CURRENCIES`。設定預設值同理（兩邊的 `DEFAULT_SETTINGS`）。
- **時間**：`occurred_at` 存 UTC ISO 字串；依日期分組、範圍換算都在前端用裝置時區做，後端只比對 UTC 時間。
- **service worker 不快取私人資料**：`public/sw.js` 只預先快取離線頁與它用到的檔案。改了這些檔案要把 `VERSION` 加一。
- **初始密碼提示**：帳號的 `password_changed_at` 是 NULL 代表還在用 `APP_PASSWORD` 登入。登入回應與 `/api/account` 以 `initialPassword` 回報，登入頁據此帶去設定頁，各頁由 `public/js/common.js` 的 `bindLogout()` 顯示提示。新增登入後的頁面要呼叫 `bindLogout()`。
- **地點查詢走後端代理**：前端只打 `/api/geo/search`、`/api/geo/reverse`，由 `src/geo.js` 轉 OpenStreetMap Nominatim（通用 User-Agent、快取 1 天）；前端反查等 1.1 秒防抖，遵守每秒 1 次。OSM 圖磚要帶 `referrerPolicy`（全站 `Referrer-Policy: same-origin`）。Leaflet 自行託管在 `public/vendor/leaflet`（`npm run vendor`），樣式表由 `public/js/map.js` 動態載入。測試不打 Nominatim。
- **機密**：`APP_PASSWORD` 用 `wrangler secret put`，本機放 `.dev.vars`。設定檔、程式碼、文件、log 只寫變數名稱。
- **個人部署資訊不進版控**：實際的資料庫編號與自訂網域只寫在 `wrangler.local.jsonc`；進版控的 `wrangler.jsonc` 是給 Deploy Button 與本機測試用的通用設定。
- **錯誤訊息**：一律繁體中文，說明哪裡錯、怎麼改；回給前端的錯誤不含堆疊。

## 驗證

`npm test` 要通過：`scripts/check.sh`（JS 語法、頁面引用、PWA 檔案）加 `scripts/smoke-api.sh`（用暫存資料庫起一個 `wrangler dev`，從 HTTP 介面走一遍登入、紀錄、搜尋、分頁、照片、設定）。對正式環境跑要帶目前的帳號密碼，而且會新增再刪除測試紀錄；擁有者改過密碼後不要拿初始密碼去試，會吃掉登入次數。改 API 先在 `smoke-api.sh` 加會失敗的檢查。
