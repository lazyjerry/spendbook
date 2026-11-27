// 新增／修改紀錄：/edit 是新增，/edit?id=<編號> 是修改；/edit?date=YYYY-MM-DD 帶入指定日期（時間用現在）。
// 儲存順序：先存紀錄，再處理照片（先移除、再逐張上傳新的）。照片在裝置上壓成 JPEG 才上傳，一筆最多 MAX_PHOTOS 張。
// 沒儲存的內容邊打邊存成這台裝置上的草稿（draft.js），重新開啟時還原；儲存或刪除成功才清掉。
import { $, CURRENCIES, amountInputValue, api, bindLogout, charCount, currencyInfo, esc, loadSettings, localInputValue, mediaUrl, parseYmd, setFlash, setStatus, showFlash } from "./common.js";
import { attachCalculator } from "./calc.js";
import { draftKey, isStale, readDraft, removeDraft, writeDraft } from "./draft.js";
import { createMap } from "./map.js";
import { compressImage } from "./photo.js";
import { openPhotos } from "./photo-view.js";
import { tagSuggest } from "./tag-suggest.js";

bindLogout();

const form = $("#record-form");
const title = $("#title");
const currency = $("#currency");
const amount = $("#amount");
const amountHint = $("#amount-hint");
const occurredAt = $("#occurred-at");
const description = $("#description");
const descHint = $("#description-hint");
const saveBtn = $("#save-btn");
const saveStatus = $("#save-status");
const deleteBtn = $("#delete-btn");
const photoList = $("#photo-list");
const photoStatus = $("#photo-status");

const params = new URLSearchParams(location.search);
const id = Number(params.get("id")) || 0;
let settings = null;
let existingPhotos = []; // 伺服器上目前的照片 [{ id, key, width, height }]
let pendingPhotos = []; // 剛選、還沒上傳的照片 [{ blob, width, height, url }]
const removedPhotoIds = new Set(); // 要在儲存時移除的已上傳照片
let dirty = false;

currency.innerHTML = CURRENCIES.map(([code, name]) => `<option value="${code}">${code}　${name}</option>`).join("");

function updateAmountHint() {
  const { decimals, name } = currencyInfo(currency.value);
  amountHint.textContent = decimals ? `${name}，最多 ${decimals} 位小數` : `${name}，整數`;
  amount.inputMode = decimals ? "decimal" : "numeric";
}
function updateDescHint() {
  descHint.textContent = `${charCount(description.value)}／1024 字`;
}
currency.addEventListener("change", updateAmountHint);
description.addEventListener("input", updateDescHint);
$("#now-btn").addEventListener("click", () => {
  occurredAt.value = localInputValue(new Date());
  markDirty();
});
form.addEventListener("input", () => {
  markDirty();
});

// ---------- 金額計算機 ----------
attachCalculator({
  input: amount,
  toggle: $("#calc-btn"),
  panel: $("#calc"),
  decimals: () => currencyInfo(currency.value).decimals,
  onSubmit(minor) {
    amount.value = amountInputValue(minor, currency.value);
    markInvalid(amount, false);
    markDirty();
  },
});

// ---------- 照片（可多張，見 docs/afk-skill/adr/020） ----------
const MAX_PHOTOS = 10; // 與 src/db.js 相同
const keptPhotos = () => existingPhotos.filter((p) => !removedPhotoIds.has(p.id));
const photoCount = () => keptPhotos().length + pendingPhotos.length;
const photoSrcs = () => [...keptPhotos().map((p) => mediaUrl(p.key)), ...pendingPhotos.map((p) => p.url)];

function showPhotos() {
  let n = 0; // 縮圖在畫面上的順序，點了從這張開始看
  const item = (src, info, attrs) => `<li class="app-photo"><button class="app-photo-btn" type="button" data-view="${n}" aria-label="放大看第 ${++n} 張照片"><img src="${esc(src)}" alt="" loading="lazy"></button>
  <div class="app-photo-bar"><span>${esc(info)}</span><button class="btn is-sm secondary" type="button" ${attrs}>移除</button></div></li>`;
  photoList.innerHTML = [
    ...keptPhotos().map((p, i) => item(mediaUrl(p.key), `第 ${i + 1} 張`, `data-photo-id="${p.id}" aria-label="移除第 ${i + 1} 張照片"`)),
    ...pendingPhotos.map((p, i) => item(p.url, `${Math.round(p.blob.size / 1024)} KB，儲存時上傳`, `data-pending="${i}" aria-label="移除剛選的照片 ${i + 1}"`)),
  ].join("");
  const full = photoCount() >= MAX_PHOTOS;
  $("#camera-btn").disabled = full;
  $("#pick-btn").disabled = full;
}

function photoNote() {
  const parts = [];
  if (pendingPhotos.length) parts.push(`${pendingPhotos.length} 張新照片`);
  if (removedPhotoIds.size) parts.push(`移除 ${removedPhotoIds.size} 張`);
  const note = parts.length ? `儲存後才會${parts.join("、")}` : "";
  return photoCount() >= MAX_PHOTOS ? `${note ? note + "；" : ""}已達 ${MAX_PHOTOS} 張上限` : note;
}

async function pickPhotos(input) {
  const files = [...(input.files || [])];
  input.value = "";
  if (!files.length) return;
  const room = MAX_PHOTOS - photoCount();
  const take = files.slice(0, Math.max(room, 0));
  const errors = [];
  for (const [i, file] of take.entries()) {
    setStatus(photoStatus, take.length > 1 ? `壓縮中 ${i + 1}／${take.length}…` : "壓縮中…");
    try {
      const out = await compressImage(file, { maxEdge: settings.maxEdge, quality: settings.quality });
      pendingPhotos.push({ ...out, url: URL.createObjectURL(out.blob) });
      markDirty();
      showPhotos();
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (files.length > take.length) errors.push(`一筆最多 ${MAX_PHOTOS} 張，多選的 ${files.length - take.length} 張沒有加入`);
  setStatus(photoStatus, errors.length ? errors.join("；") : photoNote(), errors.length ? "error" : "");
}
$("#camera-btn").addEventListener("click", () => $("#camera-input").click());
$("#pick-btn").addEventListener("click", () => $("#pick-input").click());
$("#camera-input").addEventListener("change", (e) => pickPhotos(e.target));
$("#pick-input").addEventListener("change", (e) => pickPhotos(e.target));
photoList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.view !== undefined) return openPhotos(photoSrcs(), Number(btn.dataset.view));
  if (btn.dataset.pending !== undefined) {
    const [p] = pendingPhotos.splice(Number(btn.dataset.pending), 1);
    URL.revokeObjectURL(p.url);
  } else {
    removedPhotoIds.add(Number(btn.dataset.photoId));
  }
  markDirty();
  showPhotos();
  setStatus(photoStatus, photoNote());
});

// 照片的增刪逐張送出；每成功一張就更新狀態，失敗後再按儲存只重做剩下的
async function syncPhotos(recordId) {
  for (const photoId of [...removedPhotoIds]) {
    setStatus(saveStatus, "移除照片中…");
    const data = await api(`/api/records/${recordId}/photos/${photoId}`, { method: "DELETE" });
    removedPhotoIds.delete(photoId);
    existingPhotos = data.record.photos;
    baseUpdatedAt = data.record.updatedAt;
    await saveDraftNow(); // 中途關掉頁面，草稿只留還沒處理的照片
  }
  const total = pendingPhotos.length;
  while (pendingPhotos.length) {
    const p = pendingPhotos[0];
    setStatus(saveStatus, total > 1 ? `上傳照片中 ${total - pendingPhotos.length + 1}／${total}…` : "上傳照片中…");
    const data = await api(`/api/records/${recordId}/photos?w=${p.width}&h=${p.height}`, { method: "POST", body: p.blob, headers: { "Content-Type": "image/jpeg" } });
    pendingPhotos.shift();
    URL.revokeObjectURL(p.url);
    existingPhotos = data.record.photos;
    baseUpdatedAt = data.record.updatedAt;
    await saveDraftNow();
  }
}

// ---------- 類別（選填，可多個；見 docs/afk-skill/adr/014） ----------
// 建議清單 = 這個帳號用過的類別（依次數）加上預設建議；預設只是建議，不必照用
const DEFAULT_CATEGORIES = ["旅行", "3C", "家電", "家具", "交通", "保險", "醫療", "教育", "房屋", "稅費", "紅包禮金", "維修保養"];
const MAX_CATEGORIES = 10; // 與 src/db.js 相同
const CATEGORY_HINT = "最多 10 個，每個 20 字內、不含空白；點已加的類別可移除";
const categoryInput = $("#category-input");
const categoryHint = $("#category-hint");
const categoryList = $("#category-list");
let categories = [];
let categoryOptions = [...DEFAULT_CATEGORIES];

const cleanCategory = (s) => String(s).normalize("NFKC").trim().replace(/^#+/, "").trim();
const markInvalid = (el, bad) => el.closest(".field").classList.toggle("is-invalid", bad);

function renderCategories() {
  categoryList.innerHTML = categories
    .map((t, i) => `<button class="chip" type="button" data-i="${i}" aria-label="移除類別 ${esc(t)}">#${esc(t)} ×</button>`)
    .join("");
}

// 輸入框內容依空白、逗號、頓號拆成多個類別；回傳錯誤訊息，沒有錯誤回空字串
function addCategories(text) {
  const parts = String(text).split(/[\s,，、]+/).map(cleanCategory).filter(Boolean);
  for (const t of parts) {
    if ([...t].length > 20) return `類別「${t}」超過 20 字`;
    if (categories.includes(t)) continue;
    if (categories.length >= MAX_CATEGORIES) return `類別最多 ${MAX_CATEGORIES} 個`;
    categories.push(t);
    markDirty();
  }
  renderCategories();
  return "";
}

function commitCategoryInput() {
  const msg = addCategories(categoryInput.value);
  markInvalid(categoryInput, Boolean(msg));
  categoryHint.textContent = msg || CATEGORY_HINT;
  if (!msg) categoryInput.value = "";
  return msg;
}

// 建議清單要比下面的 Enter 監聽先註冊：清單有選中項目時由它處理 Enter，不再走 commitCategoryInput
const suggest = tagSuggest(categoryInput, {
  options: () => categoryOptions,
  taken: () => categories,
  clean: cleanCategory,
  onPick: (t) => {
    categoryInput.value = t;
    commitCategoryInput();
  },
});
$("#category-add-btn").addEventListener("click", () => {
  commitCategoryInput();
  categoryInput.focus();
});
categoryInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return; // 中文輸入法選字時的 Enter 不算
  e.preventDefault();
  commitCategoryInput();
});
categoryList.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-i]");
  if (!btn) return;
  categories.splice(Number(btn.dataset.i), 1);
  markDirty();
  renderCategories();
  categoryInput.focus();
});

async function loadCategoryOptions() {
  try {
    const data = await api("/api/categories");
    categoryOptions = [...new Set([...data.categories.map((c) => c.name), ...DEFAULT_CATEGORIES])];
    suggest.refresh();
  } catch {
    // 建議清單拿不到不影響輸入，仍有預設建議
  }
}

// ---------- 地點（選填；地圖與地址互轉，見 docs/afk-skill/adr/015） ----------
const FALLBACK = { lat: 25.0478, lng: 121.517 }; // 台北車站：沒有座標時地圖的起點，不放標記
const place = $("#place");
const lat = $("#lat");
const lng = $("#lng");
const geoStatus = $("#geo-status");
const geoResults = $("#geo-results");
let geoMap = null;
let reverseTimer;
let reverseSeq = 0;
let autoPlace = ""; // 上次自動帶入的地址；地點欄還是它（或空白）時，移動標記才覆蓋，自己打的名稱不蓋掉

const clipPlace = (s) => [...String(s || "")].slice(0, 256).join("");
const readCoords = () => {
  const la = Number(lat.value);
  const ln = Number(lng.value);
  return lat.value !== "" && lng.value !== "" && Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : null;
};

function setCoords(la, ln, { moveMap = true, zoom } = {}) {
  lat.value = la.toFixed(6);
  lng.value = ln.toFixed(6);
  markInvalid(lat, false);
  markInvalid(lng, false);
  markDirty();
  if (moveMap && geoMap) geoMap.setPosition(la, ln, zoom);
}

function fillPlace(text, { force = false } = {}) {
  if (!text) return false;
  if (!force && place.value.trim() && place.value !== autoPlace) return false;
  place.value = autoPlace = clipPlace(text);
  markInvalid(place, false);
  markDirty();
  return true;
}

async function reverseLookup({ force = true } = {}) {
  const c = readCoords();
  if (!c) {
    setStatus(geoStatus, "請先輸入緯度與經度，或在地圖上點選位置", "error");
    return;
  }
  const seq = ++reverseSeq;
  setStatus(geoStatus, "依座標查詢地址中…");
  try {
    const data = await api(`/api/geo/reverse?lat=${c.lat}&lng=${c.lng}`);
    if (seq !== reverseSeq) return;
    const filled = fillPlace(data.address, { force });
    setStatus(geoStatus, filled ? "已依座標帶入地址，可再手動修改" : `座標已更新；地點欄保留你輸入的名稱（這裡是 ${data.address}）`, "ok");
  } catch (err) {
    if (seq === reverseSeq) setStatus(geoStatus, err.message, "error");
  }
}

function scheduleReverse() {
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(() => reverseLookup({ force: false }), 1100); // Nominatim 每秒最多 1 次
}

function applyResult(r) {
  setCoords(r.lat, r.lng, { zoom: 17 });
  geoResults.innerHTML = "";
  setStatus(geoStatus, "已依查詢移動標記，可再拖曳微調", "ok");
}

async function geocode() {
  const q = place.value.trim();
  geoResults.innerHTML = "";
  if (!q) {
    markInvalid(place, true);
    setStatus(geoStatus, "請先輸入地點名稱或地址，再按「查座標」", "error");
    place.focus();
    return;
  }
  setStatus(geoStatus, "依地點查詢座標中…");
  try {
    const data = await api("/api/geo/search?q=" + encodeURIComponent(q));
    if (!data.results.length) {
      setStatus(geoStatus, "查不到這個地點，試著去掉樓層、巷弄，或直接在地圖上點選", "error");
      return;
    }
    if (data.results.length === 1) return applyResult(data.results[0]);
    geoResults.innerHTML = data.results
      .map((r, i) => `<button class="btn is-sm secondary app-geo-option" type="button" data-i="${i}">${esc(r.label)}</button>`)
      .join("");
    geoResults.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => applyResult(data.results[Number(b.dataset.i)])));
    setStatus(geoStatus, `找到 ${data.results.length} 個地點，請選一個`, "ok");
  } catch (err) {
    setStatus(geoStatus, err.message, "error");
  }
}

function locate() {
  if (!navigator.geolocation) {
    setStatus(geoStatus, "這個瀏覽器不支援定位，請在地圖上點選或輸入地點", "error");
    return;
  }
  setStatus(geoStatus, "取得目前位置中…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setCoords(pos.coords.latitude, pos.coords.longitude, { zoom: 17 });
      reverseLookup({ force: false });
    },
    (err) => {
      const msg = err.code === 1 ? "沒有定位權限，請在瀏覽器允許位置存取，或直接在地圖上點選" : "無法取得目前位置，請在地圖上點選或輸入地點";
      setStatus(geoStatus, msg, "error");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

function clearPlace() {
  clearTimeout(reverseTimer);
  reverseSeq++;
  place.value = lat.value = lng.value = autoPlace = "";
  geoResults.innerHTML = "";
  for (const el of [place, lat, lng]) markInvalid(el, false);
  if (geoMap) geoMap.clear();
  markDirty();
  setStatus(geoStatus, "已清除地點與座標");
}

async function initMap(start) {
  try {
    geoMap = await createMap($("#map"), {
      lat: (start || FALLBACK).lat,
      lng: (start || FALLBACK).lng,
      zoom: start ? 16 : 12,
      pinned: Boolean(start),
      onPick(la, ln) {
        setCoords(la, ln, { moveMap: false });
        scheduleReverse();
      },
    });
  } catch (err) {
    setStatus(geoStatus, err.message, "error");
  }
}

for (const el of [lat, lng]) {
  el.addEventListener("change", () => {
    const c = readCoords();
    if (c && geoMap) geoMap.setPosition(c.lat, c.lng);
  });
}
$("#geocode-btn").addEventListener("click", geocode);
place.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  geocode();
});
$("#reverse-btn").addEventListener("click", () => reverseLookup());
$("#locate-btn").addEventListener("click", locate);
$("#place-clear-btn").addEventListener("click", clearPlace);

// ---------- 儲存 ----------
function focusField(fields) {
  const map = { title, currency, amount, description, occurredAt, categories: categoryInput, place, lat, lng };
  const key = Object.keys(fields || {}).find((k) => map[k]);
  if (key) map[key].focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saveBtn.disabled) return;
  const at = new Date(occurredAt.value);
  const categoryError = categoryInput.value.trim() ? commitCategoryInput() : ""; // 輸入框還有沒按「加入」的類別，一併存
  const local = {};
  if (!title.value.trim()) local.title = "請輸入標題";
  else if (!/^\d[\d,]*(\.\d+)?$/.test(amount.value.trim())) local.amount = "請輸入金額（數字）";
  else if (!occurredAt.value || Number.isNaN(at.getTime())) local.occurredAt = "請選擇時間";
  else if (charCount(description.value.trim()) > 1024) local.description = "描述最多 1024 個字";
  else if (categoryError) local.categories = categoryError;
  else if ((lat.value === "") !== (lng.value === "")) local[lat.value === "" ? "lat" : "lng"] = "經緯度要一起填，或一起清空";
  if (Object.keys(local).length) {
    setStatus(saveStatus, Object.values(local)[0], "error");
    focusField(local);
    return;
  }
  saveBtn.disabled = true;
  form.inert = true;
  setStatus(saveStatus, "儲存中…");
  await saveDraftNow(); // 送出前先把最後幾個字存進草稿，儲存失敗或連線中斷時都還在
  let savedId = id;
  try {
    const json = { title: title.value, currency: currency.value, amount: amount.value.trim(), description: description.value, occurredAt: at.toISOString() };
    Object.assign(json, { categories, place: place.value, lat: lat.value === "" ? null : Number(lat.value), lng: lng.value === "" ? null : Number(lng.value) });
    const data = id ? await api(`/api/records/${id}`, { method: "PUT", json }) : await api("/api/records", { method: "POST", json });
    savedId = data.record.id;
    baseUpdatedAt = data.record.updatedAt;
  } catch (err) {
    saveBtn.disabled = false;
    form.inert = false;
    setStatus(saveStatus, err.message, "error");
    focusField(err.fields);
    return;
  }
  // 紀錄已存好；草稿改記在這筆紀錄名下，只剩還沒處理的照片。照片失敗時留在這筆的修改頁，再按一次儲存就會重傳剩下的
  if (!id && userId) {
    await removeDraft(draftId);
    draftId = draftKey(userId, savedId);
  }
  await saveDraftNow();
  try {
    await syncPhotos(savedId);
  } catch (err) {
    dirty = false;
    if (!id) {
      setFlash(`紀錄已儲存，但照片沒傳上去：${err.message}。照片留在這頁，再按一次儲存重試`);
      location.replace(`/edit?id=${savedId}`);
      return;
    }
    saveBtn.disabled = false;
    form.inert = false;
    markDirty(); // 還有沒處理完的照片，離開前要提醒
    showPhotos();
    setStatus(saveStatus, `紀錄已儲存，但照片沒處理好：${err.message}。再按一次儲存重試`, "error");
    return;
  }
  dirty = false;
  await removeDraft(draftId);
  setFlash(id ? "已更新紀錄" : "已新增紀錄");
  location.href = backUrl();
});

// 回到來的那個畫面（紀錄頁會把檢視方式寫在網址上）；不是從站內來就回首頁
function backUrl() {
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin && ref.pathname === "/") return ref.pathname + ref.search;
  } catch {}
  return "/";
}
$("#back-link").href = backUrl();

deleteBtn.addEventListener("click", async () => {
  if (!confirm(`確定要刪除「${title.value.trim() || "這筆紀錄"}」？照片會一併刪除，無法復原。`)) return;
  deleteBtn.disabled = true;
  try {
    await api(`/api/records/${id}`, { method: "DELETE" });
    dirty = false;
    await removeDraft(draftId);
    setFlash("已刪除紀錄");
    location.href = backUrl();
  } catch (err) {
    deleteBtn.disabled = false;
    setStatus(saveStatus, err.message, "error");
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});

// ---------- 草稿（沒儲存的內容存在這台裝置，見 draft.js） ----------
// 要放在「載入」之前：載入區塊會 await，期間觸發的事件要能用到這裡的變數
let userId = 0; // 讀不到帳號就不存草稿
let draftId = ""; // draftKey(userId, 紀錄編號)；新增的紀錄存好後改成那筆的 key
let baseUpdatedAt = null; // 開始編輯時伺服器上紀錄的 updatedAt，用來判斷還原的草稿是不是過時了
let draftTimer = 0;

function markDirty() {
  dirty = true;
  if (!draftId) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraftNow, 400);
}

function snapshot() {
  return {
    baseUpdatedAt,
    title: title.value,
    currency: currency.value,
    amount: amount.value,
    occurredAt: occurredAt.value,
    description: description.value,
    categories,
    categoryText: categoryInput.value,
    place: place.value,
    autoPlace,
    lat: lat.value,
    lng: lng.value,
    removedPhotoIds: [...removedPhotoIds],
    pendingPhotos: pendingPhotos.map(({ blob, width, height }) => ({ blob, width, height })),
  };
}

async function saveDraftNow() {
  clearTimeout(draftTimer);
  draftTimer = 0;
  if (draftId && dirty) await writeDraft(draftId, snapshot());
}

// 把草稿填回表單；回傳要給地圖的起點（草稿有座標才有）
function applyDraft(draft) {
  title.value = draft.title;
  currency.value = draft.currency;
  amount.value = draft.amount;
  occurredAt.value = draft.occurredAt;
  description.value = draft.description;
  categories = [...draft.categories];
  categoryInput.value = draft.categoryText;
  place.value = draft.place;
  autoPlace = draft.autoPlace;
  lat.value = draft.lat;
  lng.value = draft.lng;
  const ids = new Set(existingPhotos.map((p) => p.id)); // 別處已經刪掉的照片不用再移除
  for (const photoId of draft.removedPhotoIds) if (ids.has(photoId)) removedPhotoIds.add(photoId);
  const room = MAX_PHOTOS - keptPhotos().length;
  pendingPhotos = draft.pendingPhotos.slice(0, Math.max(room, 0)).map((p) => ({ ...p, url: URL.createObjectURL(p.blob) }));
  dirty = true;
  return readCoords();
}

function draftNotice(draft, record) {
  const at = new Date(draft.savedAt);
  const when = Number.isNaN(at.getTime()) ? "" : `${at.getMonth() + 1}/${at.getDate()} ${localInputValue(at).slice(11)} `;
  const stale = isStale(draft, record) ? "；這筆紀錄之後在別處改過，儲存會蓋掉那些修改" : "";
  return `已還原 ${when}沒儲存的內容${stale}。不要的話按下方「捨棄沒儲存的內容」`;
}

$("#discard-draft-btn").addEventListener("click", async () => {
  if (!confirm("確定要捨棄沒儲存的內容？會回到上次儲存的樣子。")) return;
  clearTimeout(draftTimer);
  dirty = false;
  await removeDraft(draftId);
  location.reload();
});

// 切到別的 App 或關掉分頁時，把還在等的草稿馬上寫進去
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && draftTimer) saveDraftNow();
});
window.addEventListener("pagehide", () => {
  if (draftTimer) saveDraftNow();
});

// ---------- 載入 ----------
// 設定與紀錄載回來之前先鎖住表單，免得先改的欄位被載入結果蓋掉
form.inert = true;
loadCategoryOptions();
let mapStart = null;
try {
  let me;
  [settings, me] = await Promise.all([loadSettings(), api("/api/account").catch(() => null)]);
  let record = null;
  if (id) {
    ({ record } = await api(`/api/records/${id}`));
    baseUpdatedAt = record.updatedAt;
    title.value = record.title;
    currency.value = record.currency;
    amount.value = amountInputValue(record.amountMinor, record.currency);
    occurredAt.value = localInputValue(new Date(record.occurredAt));
    description.value = record.description;
    existingPhotos = record.photos;
    categories = [...record.categories];
    place.value = record.place;
    if (record.lat != null && record.lng != null) {
      lat.value = record.lat.toFixed(6);
      lng.value = record.lng.toFixed(6);
      mapStart = { lat: record.lat, lng: record.lng };
    }
    deleteBtn.hidden = false;
    document.title = document.title.replace("記一筆", "修改紀錄");
    $("#save-title").textContent = "儲存修改";
    $("h1 em").textContent = "修改紀錄";
  } else {
    currency.value = settings.defaultCurrency;
    const now = new Date();
    const day = parseYmd(params.get("date"));
    if (day) day.setHours(now.getHours(), now.getMinutes());
    occurredAt.value = localInputValue(day || now);
  }
  if (me?.id) {
    userId = me.id;
    draftId = draftKey(userId, id);
    const draft = await readDraft(draftId);
    if (draft) {
      mapStart = applyDraft(draft);
      $("#discard-draft-btn").hidden = false;
      setStatus(saveStatus, draftNotice(draft, record));
    }
  }
  updateAmountHint();
  updateDescHint();
  showPhotos();
  renderCategories();
  form.inert = false;
  initMap(mapStart); // 不等地圖：地圖元件載入失敗也不影響其他欄位
  if (!id) title.focus();
  showFlash();
} catch (err) {
  setStatus(saveStatus, err.message, "error");
}
