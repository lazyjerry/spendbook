// 編輯頁的 Leaflet 地圖（見 docs/afk-skill/adr/015）。leaflet.js 由頁面載入，leaflet.css 在這裡動態載入。
// 地點是選填：沒有座標時地圖停在起點、不放標記；點地圖、拖曳、setPosition() 才放上標記，clear() 拿掉。
const CSS_HREF = "/vendor/leaflet/leaflet.css";

function loadCss() {
  return new Promise((resolve) => {
    if (document.querySelector("link[data-leaflet]")) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    link.dataset.leaflet = "";
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

// pinned：一開始就在 (lat, lng) 放標記；onPick(lat, lng)：使用者點地圖或拖曳標記
export async function createMap(el, { lat, lng, zoom = 17, pinned = true, onPick }) {
  await loadCss();
  const L = window.L;
  if (!L) throw new Error("地圖元件載入失敗，請重新整理頁面；仍可手動輸入座標");
  L.Icon.Default.imagePath = "/vendor/leaflet/images/";
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    // 全站是 Referrer-Policy: same-origin，圖磚請求不帶 Referer 會被 OSM 擋（403）；圖磚只送網域
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  let marker = null;
  function place(la, ln) {
    if (marker) return marker.setLatLng([la, ln]);
    marker = L.marker([la, ln], { draggable: true, keyboard: true, title: "花錢的地點，可拖曳", alt: "花錢的地點" }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      onPick(p.lat, p.lng);
    });
  }
  if (pinned) place(lat, lng);
  map.on("click", (e) => {
    place(e.latlng.lat, e.latlng.lng);
    onPick(e.latlng.lat, e.latlng.lng);
  });
  return {
    setPosition(la, ln, z) {
      place(la, ln);
      map.setView([la, ln], z ?? map.getZoom());
    },
    clear() {
      if (marker) marker.remove();
      marker = null;
    },
  };
}
