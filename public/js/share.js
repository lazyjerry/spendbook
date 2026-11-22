// 分享頁：選一段日期（可再加關鍵字），做成時間軸圖、列表圖或純文字。
// 有 Web Share API 就叫出系統的分享選單；沒有就下載圖片或複製文字。
import { $, addDays, addMonths, bindLogout, fetchRange, loadSettings, parseYmd, rangeLabel, setStatus, startOfDay, startOfMonth, startOfWeek, sumByCurrency, formatMoney, toast, ymd } from "./common.js";
import { MAX_ROWS, drawShareImage, shareText } from "./share-draw.js";

bindLogout();

const form = $("#share-form");
const fromInput = $("#share-from");
const toInput = $("#share-to");
const qInput = $("#share-q");
const status = $("#share-status");
const actionStatus = $("#action-status");
const imageEl = $("#share-image");
const textEl = $("#share-text");
const emptyEl = $("#share-empty");
const shareBtn = $("#share-btn");
const downloadBtn = $("#download-btn");
const copyBtn = $("#copy-btn");

let settings = { nickname: "", weekStart: 1 };
let records = []; // 由舊到新
let range = null; // { from, to }，to 不含
let output = null; // { kind: "image", blob, url, name } 或 { kind: "text", text }
let seq = 0;

function presetRange(value) {
  const today = startOfDay(new Date());
  if (value === "today") return { from: today, to: addDays(today, 1) };
  if (value === "week") {
    const from = startOfWeek(today, settings.weekStart);
    return { from, to: addDays(from, 7) };
  }
  if (value === "last-month") return { from: addMonths(startOfMonth(today), -1), to: startOfMonth(today) };
  return { from: startOfMonth(today), to: addMonths(startOfMonth(today), 1) };
}

const checked = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
const options = () => ({
  style: checked("style") || "timeline",
  showTotal: $("#opt-total").checked,
  showDesc: $("#opt-desc").checked,
  showAmount: $("#opt-amount").checked,
  nickname: $("#opt-nickname").checked ? settings.nickname : "",
});

function setOutput(next) {
  if (output?.url) URL.revokeObjectURL(output.url);
  output = next;
  const kind = next?.kind;
  imageEl.hidden = kind !== "image";
  textEl.hidden = kind !== "text";
  emptyEl.hidden = Boolean(kind);
  shareBtn.disabled = !kind;
  downloadBtn.hidden = kind === "text";
  downloadBtn.disabled = kind !== "image";
  copyBtn.hidden = kind !== "text";
  copyBtn.disabled = kind !== "text";
  if (kind === "image") imageEl.src = next.url;
  if (kind === "text") textEl.value = next.text;
}

async function render() {
  const mine = ++seq;
  setStatus(actionStatus, "");
  if (!records.length) {
    setOutput(null);
    return;
  }
  const opts = options();
  const now = new Date();
  const data = {
    rangeText: rangeLabel(range.from, range.to),
    count: records.length,
    totals: sumByCurrency(records).map((t) => formatMoney(t.total, t.currency)),
    madeText: ymd(now).replace(/-/g, "/"),
  };
  if (opts.style === "text") {
    setOutput({ kind: "text", text: shareText(records, data, opts) });
    setStatus(status, `共 ${records.length} 筆`);
    return;
  }
  try {
    const canvas = await drawShareImage(records, data, opts);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (mine !== seq) return;
    if (!blob) throw new Error("這個瀏覽器無法產生圖片，請改用文字樣式");
    const name = `spendbook-${ymd(range.from).replace(/-/g, "")}-${ymd(addDays(range.to, -1)).replace(/-/g, "")}.png`;
    setOutput({ kind: "image", blob, url: URL.createObjectURL(blob), name });
    setStatus(status, records.length > MAX_ROWS ? `共 ${records.length} 筆，圖片只畫前 ${MAX_ROWS} 筆；要全部列出請縮短範圍或改用文字` : `共 ${records.length} 筆`);
  } catch (err) {
    if (mine !== seq) return;
    setOutput(null);
    setStatus(status, err.message, "error");
  }
}

async function load() {
  const mine = ++seq;
  const from = parseYmd(fromInput.value);
  const last = parseYmd(toInput.value);
  if (!from || !last) {
    setStatus(status, "請選擇開始與結束日期", "error");
    return;
  }
  if (last < from) {
    setStatus(status, "結束日期不能早於開始日期", "error");
    return;
  }
  range = { from, to: addDays(last, 1) };
  setStatus(status, "載入中…");
  try {
    const res = await fetchRange({ q: qInput.value.trim(), from: range.from, to: range.to, max: 2000 });
    if (mine !== seq) return;
    records = res.records.slice().reverse();
    setStatus(status, records.length ? "" : "這段範圍沒有紀錄");
    await render();
  } catch (err) {
    if (mine !== seq) return;
    setStatus(status, err.message, "error");
  }
}

// ---------- 事件 ----------
for (const radio of form.querySelectorAll('input[name="range"]')) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    const r = presetRange(radio.value);
    fromInput.value = ymd(r.from);
    toInput.value = ymd(addDays(r.to, -1));
    load();
  });
}
for (const input of [fromInput, toInput]) {
  input.addEventListener("change", () => {
    for (const radio of form.querySelectorAll('input[name="range"]')) radio.checked = false;
    load();
  });
}
let qTimer = 0;
qInput.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(load, 400);
});
for (const el of form.querySelectorAll('input[name="style"], .switch input')) el.addEventListener("change", render);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});

function download() {
  const a = document.createElement("a");
  a.href = output.url;
  a.download = output.name;
  document.body.append(a);
  a.click();
  a.remove();
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(output.text);
  } catch {
    textEl.select();
    document.execCommand("copy"); // 舊瀏覽器或沒有剪貼簿權限時的退路
  }
  setStatus(actionStatus, "已複製文字", "ok");
  toast("已複製文字");
}

shareBtn.addEventListener("click", async () => {
  if (!output) return;
  try {
    if (output.kind === "text") {
      if (navigator.share) await navigator.share({ text: output.text });
      else await copyText();
      return;
    }
    const file = new File([output.blob], output.name, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
    } else {
      download();
      setStatus(actionStatus, "這個瀏覽器不能直接分享圖片，已改成下載", "ok");
    }
  } catch (err) {
    if (err.name !== "AbortError") setStatus(actionStatus, `分享失敗：${err.message}`, "error"); // AbortError 是使用者自己關掉分享選單
  }
});
downloadBtn.addEventListener("click", () => {
  if (output?.kind !== "image") return;
  download();
  setStatus(actionStatus, "已下載圖片", "ok");
});
copyBtn.addEventListener("click", () => {
  if (output?.kind === "text") copyText();
});

settings = await loadSettings();
const first = presetRange("week");
fromInput.value = ymd(first.from);
toInput.value = ymd(addDays(first.to, -1));
load();
