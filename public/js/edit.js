// 新增／修改紀錄：/edit 是新增，/edit?id=<編號> 是修改；/edit?date=YYYY-MM-DD 帶入指定日期（時間用現在）。
// 儲存順序：先存紀錄，再處理照片（上傳新的或移除舊的）。照片在裝置上壓成 JPEG 才上傳。
import { $, CURRENCIES, amountInputValue, api, bindLogout, charCount, currencyInfo, loadSettings, localInputValue, mediaUrl, parseYmd, setFlash, setStatus, showFlash } from "./common.js";
import { compressImage } from "./photo.js";

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
const photoPreview = $("#photo-preview");
const photoImg = $("#photo-img");
const photoInfo = $("#photo-info");
const photoStatus = $("#photo-status");

const params = new URLSearchParams(location.search);
const id = Number(params.get("id")) || 0;
let settings = null;
let existingPhotoKey = null; // 伺服器上目前的照片
let pendingPhoto = null; // 剛選、還沒上傳的照片 { blob, width, height, url }
let removeExisting = false;
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
  dirty = true;
});
form.addEventListener("input", () => {
  dirty = true;
});

// ---------- 照片 ----------
function showPhoto() {
  if (pendingPhoto) {
    photoImg.src = pendingPhoto.url;
    photoInfo.textContent = `${pendingPhoto.width}×${pendingPhoto.height}，${Math.round(pendingPhoto.blob.size / 1024)} KB，儲存時上傳`;
    photoPreview.hidden = false;
  } else if (existingPhotoKey && !removeExisting) {
    photoImg.src = mediaUrl(existingPhotoKey);
    photoInfo.textContent = "已上傳";
    photoPreview.hidden = false;
  } else {
    photoImg.removeAttribute("src");
    photoPreview.hidden = true;
  }
}

async function pickPhoto(input) {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  setStatus(photoStatus, "壓縮中…");
  try {
    const out = await compressImage(file, { maxEdge: settings.maxEdge, quality: settings.quality });
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url);
    pendingPhoto = { ...out, url: URL.createObjectURL(out.blob) };
    dirty = true;
    showPhoto();
    setStatus(photoStatus, existingPhotoKey ? "儲存後會換掉原本的照片" : "");
  } catch (err) {
    setStatus(photoStatus, err.message, "error");
  }
}
$("#camera-btn").addEventListener("click", () => $("#camera-input").click());
$("#pick-btn").addEventListener("click", () => $("#pick-input").click());
$("#camera-input").addEventListener("change", (e) => pickPhoto(e.target));
$("#pick-input").addEventListener("change", (e) => pickPhoto(e.target));
$("#photo-remove-btn").addEventListener("click", () => {
  if (pendingPhoto) {
    URL.revokeObjectURL(pendingPhoto.url);
    pendingPhoto = null;
  } else if (existingPhotoKey) {
    removeExisting = true;
  }
  dirty = true;
  showPhoto();
  setStatus(photoStatus, removeExisting ? "儲存後會移除照片" : "");
});

// ---------- 儲存 ----------
function focusField(fields) {
  const map = { title, currency, amount, description, occurredAt };
  const key = Object.keys(fields || {}).find((k) => map[k]);
  if (key) map[key].focus();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saveBtn.disabled) return;
  const at = new Date(occurredAt.value);
  const local = {};
  if (!title.value.trim()) local.title = "請輸入標題";
  else if (!/^\d[\d,]*(\.\d+)?$/.test(amount.value.trim())) local.amount = "請輸入金額（數字）";
  else if (!occurredAt.value || Number.isNaN(at.getTime())) local.occurredAt = "請選擇時間";
  else if (charCount(description.value.trim()) > 1024) local.description = "描述最多 1024 個字";
  if (Object.keys(local).length) {
    setStatus(saveStatus, Object.values(local)[0], "error");
    focusField(local);
    return;
  }
  saveBtn.disabled = true;
  form.inert = true;
  setStatus(saveStatus, "儲存中…");
  let savedId = id;
  try {
    const json = { title: title.value, currency: currency.value, amount: amount.value.trim(), description: description.value, occurredAt: at.toISOString() };
    const data = id ? await api(`/api/records/${id}`, { method: "PUT", json }) : await api("/api/records", { method: "POST", json });
    savedId = data.record.id;
  } catch (err) {
    saveBtn.disabled = false;
    form.inert = false;
    setStatus(saveStatus, err.message, "error");
    focusField(err.fields);
    return;
  }
  // 紀錄已存好；照片失敗時留在這筆的修改頁，再按一次儲存就會重傳
  try {
    if (pendingPhoto) {
      setStatus(saveStatus, "上傳照片中…");
      await api(`/api/records/${savedId}/photo?w=${pendingPhoto.width}&h=${pendingPhoto.height}`, { method: "PUT", body: pendingPhoto.blob, headers: { "Content-Type": "image/jpeg" } });
    } else if (removeExisting) {
      await api(`/api/records/${savedId}/photo`, { method: "DELETE" });
    }
  } catch (err) {
    dirty = false;
    if (!id) {
      setFlash(`紀錄已儲存，但照片沒傳上去：${err.message}`);
      location.replace(`/edit?id=${savedId}`);
      return;
    }
    saveBtn.disabled = false;
    form.inert = false;
    setStatus(saveStatus, `紀錄已儲存，但照片沒處理好：${err.message}。再按一次儲存重試`, "error");
    return;
  }
  dirty = false;
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

// ---------- 載入 ----------
// 設定與紀錄載回來之前先鎖住表單，免得先改的欄位被載入結果蓋掉
form.inert = true;
try {
  settings = await loadSettings();
  if (id) {
    const { record } = await api(`/api/records/${id}`);
    title.value = record.title;
    currency.value = record.currency;
    amount.value = amountInputValue(record.amountMinor, record.currency);
    occurredAt.value = localInputValue(new Date(record.occurredAt));
    description.value = record.description;
    existingPhotoKey = record.photoKey;
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
  updateAmountHint();
  updateDescHint();
  showPhoto();
  form.inert = false;
  if (!id) title.focus();
  showFlash();
} catch (err) {
  setStatus(saveStatus, err.message, "error");
}
