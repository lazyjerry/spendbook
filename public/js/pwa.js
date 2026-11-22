// 註冊 service worker（public/sw.js），讓「花錢事件簿」可安裝成 App、離線時顯示離線頁。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("service worker 註冊失敗", err));
  });
}
