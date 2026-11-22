// Service worker：只負責「離線時顯示離線頁」，不快取紀錄、照片與 API。
// 頁面與資料都在登入後才拿得到，快取它們會讓登出後、換帳號後還看得到舊內容，所以一律走網路。
// 只預先快取離線頁與它用到的檔案；線上時這些檔案也照樣走網路，避免部署後新舊版本混用。
// 改了離線頁或它用到的檔案就把 VERSION 加一，舊快取會在 activate 時清掉。
const VERSION = 1;
const CACHE = `offline-v${VERSION}`;
const OFFLINE_URL = "/offline"; // 不要寫 /offline.html：assets 會 307 轉到 /offline，轉址過的回應不能拿來回應頁面導覽
const PRECACHE = [OFFLINE_URL, "/jerry-ui.css", "/app.css", "/jerry-ui.js", "/jerry.png", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 頁面導覽：走網路，連不上才給離線頁
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  // 離線頁用到的檔案：走網路，連不上才用快取；其他請求（API、照片、各頁 JS）不經手
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
  }
});
