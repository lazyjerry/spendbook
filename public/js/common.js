// 各頁共用：API 呼叫、登入導向、幣別與金額、日期工具、設定預設值、小工具。

// [代碼, 名稱, 小數位數, 符號]。代碼與小數位數要和 src/db.js 的 CURRENCIES 一致。
export const CURRENCIES = [
  ["TWD", "新台幣", 2, "NT$"],
  ["JPY", "日圓", 0, "¥"],
  ["USD", "美元", 2, "US$"],
  ["EUR", "歐元", 2, "€"],
  ["CNY", "人民幣", 2, "CN¥"],
  ["HKD", "港幣", 2, "HK$"],
  ["KRW", "韓元", 0, "₩"],
  ["GBP", "英鎊", 2, "£"],
  ["SGD", "新加坡幣", 2, "S$"],
  ["THB", "泰銖", 2, "฿"],
  ["AUD", "澳幣", 2, "A$"],
  ["CAD", "加幣", 2, "C$"],
  ["MYR", "馬來西亞令吉", 2, "RM"],
  ["VND", "越南盾", 0, "₫"],
];
const CURRENCY_MAP = new Map(CURRENCIES.map(([code, name, decimals, symbol]) => [code, { code, name, decimals, symbol }]));
export const currencyInfo = (code) => CURRENCY_MAP.get(code) || { code, name: code, decimals: 2, symbol: code };

// 要和 src/db.js 的 DEFAULT_SETTINGS 一致。
export const DEFAULT_SETTINGS = { nickname: "", defaultCurrency: "TWD", weekStart: 1, maxEdge: 1600, quality: 80 };

export const APP_NAME = "花錢事件簿";
export const $ = (sel, root = document) => root.querySelector(sel);

export async function api(path, { method = "GET", json, body, headers = {}, keepalive = false } = {}) {
  const opts = { method, headers: { ...headers }, credentials: "same-origin", keepalive };
  if (json !== undefined) {
    opts.body = JSON.stringify(json);
    opts.headers["Content-Type"] = "application/json";
  } else if (body !== undefined) {
    opts.body = body;
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error("連不上伺服器，請確認網路後再試一次");
  }
  if (res.status === 401 && path !== "/api/login" && !path.startsWith("/api/passkeys/login/")) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    throw new Error("請先登入");
  }
  const data = (res.headers.get("Content-Type") || "").includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `伺服器錯誤（${res.status}），請稍後再試`);
    err.fields = data?.fields;
    throw err;
  }
  return data;
}

export async function loadSettings() {
  try {
    const data = await api("/api/settings");
    return { ...DEFAULT_SETTINGS, ...data.settings };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const charCount = (s) => [...(s || "")].length;

export function mediaUrl(key) {
  return "/media/" + key.split("/").map(encodeURIComponent).join("/");
}

export function setStatus(el, text, state = "") {
  if (!el) return;
  if (window.JerryUI) window.JerryUI.setStatus(el, text, state);
  else el.textContent = text;
}

// 還在用初始密碼時，在頁面最上方放一則提示，連到設定頁的「帳號與密碼」。改過密碼後就不再出現。
// 讀不到帳號資料時不顯示，不擋頁面其他功能。
async function remindInitialPassword() {
  let me;
  try {
    me = await api("/api/account");
  } catch {
    return;
  }
  if (!me?.initialPassword) return;
  const note = document.createElement("aside");
  note.className = "note app-setup-note";
  note.innerHTML = `<span class="note-icon" aria-hidden="true">!</span>
  <div><strong>請更新帳號與密碼</strong><p>你還在用第一次登入的初始帳號密碼。${location.pathname.startsWith("/settings") ? "請在下方「帳號與密碼」改成自己的帳號與新密碼。" : '請到<a href="/settings?setup=1#account-title">設定頁的「帳號與密碼」</a>改成自己的帳號與新密碼。'}</p></div>`;
  $("#main")?.prepend(note);
}

// 每個登入後的頁面都會呼叫：頁首右上角的重新整理與登出（登出先 confirm），以及初始密碼提示
export function bindLogout() {
  remindInitialPassword();
  $("#refresh-btn")?.addEventListener("click", () => location.reload());
  const btn = $("#logout-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("確定要登出嗎？")) return;
    try {
      await api("/api/logout", { method: "POST" });
    } finally {
      location.href = "/login";
    }
  });
}

// 右上角 toast（樣式見 app.css 的 .app-toast）：同一時間只留一個，連續呼叫會換文字並重新計時。
// 設 aria-hidden，因為呼叫端都另有 role=status 的狀態列負責朗讀，避免報讀兩次。
let toastEl = null;
let toastTimer = 0;
export function toast(text, ms = 2500) {
  if (!toastEl) {
    toastEl = document.createElement("p");
    toastEl.className = "app-toast";
    toastEl.setAttribute("aria-hidden", "true");
    document.body.append(toastEl);
  }
  toastEl.textContent = text;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => toastEl.classList.add("is-shown"));
  toastTimer = setTimeout(() => toastEl.classList.remove("is-shown"), ms);
}

// 換頁後才顯示的訊息（例如儲存後回到紀錄頁）：存在 sessionStorage，下一頁讀一次就清掉
const FLASH_KEY = "spendbook.flash";
export function setFlash(text) {
  try {
    sessionStorage.setItem(FLASH_KEY, text);
  } catch {}
}
export function showFlash() {
  try {
    const text = sessionStorage.getItem(FLASH_KEY);
    if (!text) return;
    sessionStorage.removeItem(FLASH_KEY);
    toast(text);
  } catch {}
}

// ---------- 金額 ----------
// 最小單位整數 → 數字字串（不帶符號），例如 12050、TWD → "120.5"
export function formatAmount(minor, currency, { compact = false } = {}) {
  const { decimals } = currencyInfo(currency);
  const value = minor / 10 ** decimals;
  if (compact && Math.abs(value) >= 10000) return new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export function formatMoney(minor, currency, opts) {
  return `${currencyInfo(currency).symbol} ${formatAmount(minor, currency, opts)}`;
}

// 給輸入框用：不帶千分位
export function amountInputValue(minor, currency) {
  const { decimals } = currencyInfo(currency);
  if (!decimals) return String(minor);
  const s = String(minor).padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
}

// 各幣別合計，筆數多的排前面：[{ currency, total, count }]
export function sumByCurrency(records) {
  const map = new Map();
  for (const r of records) {
    const item = map.get(r.currency) || { currency: r.currency, total: 0, count: 0 };
    item.total += r.amountMinor;
    item.count += 1;
    map.set(r.currency, item);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

export function totalsText(records, sep = "、") {
  return sumByCurrency(records).map((t) => formatMoney(t.total, t.currency)).join(sep);
}

// ---------- 日期（一律用裝置時區） ----------
export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n) => String(n).padStart(2, "0");

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// <input type="datetime-local"> 的值
export const localInputValue = (d) => `${ymd(d)}T${hm(d)}`;

// "YYYY-MM-DD" → 當地時間 00:00 的 Date；格式不對回 null
export function parseYmd(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export function startOfWeek(d, weekStart = 1) {
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(d, -diff);
}

export const dateLabel = (d, withYear = true) => `${withYear ? d.getFullYear() + "/" : ""}${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
export function rangeLabel(from, toExclusive) {
  const last = addDays(toExclusive, -1);
  const a = `${from.getFullYear()}/${from.getMonth() + 1}/${from.getDate()}`;
  if (ymd(from) === ymd(last)) return `${a}（${WEEKDAYS[from.getDay()]}）`;
  const b = from.getFullYear() === last.getFullYear() ? `${last.getMonth() + 1}/${last.getDate()}` : `${last.getFullYear()}/${last.getMonth() + 1}/${last.getDate()}`;
  return `${a}–${b}`;
}

// 依當地日期分組，維持傳入的順序：[{ key: "YYYY-MM-DD", date, items }]
export function groupByDay(records) {
  const groups = [];
  let cur = null;
  for (const r of records) {
    const at = new Date(r.occurredAt);
    const key = ymd(at);
    if (!cur || cur.key !== key) {
      cur = { key, date: startOfDay(at), items: [] };
      groups.push(cur);
    }
    cur.items.push(r);
  }
  return groups;
}

// ---------- 取紀錄 ----------
export async function fetchPage({ q = "", from = null, to = null, limit = 50, cursor = "" } = {}) {
  const p = new URLSearchParams({ limit: String(limit) });
  if (q) p.set("q", q);
  if (from) p.set("from", from.toISOString());
  if (to) p.set("to", to.toISOString());
  if (cursor) p.set("cursor", cursor);
  return api(`/api/records?${p}`);
}

// 取一段範圍內的全部紀錄（新到舊）。超過 max 筆就停，回傳 truncated: true。
export async function fetchRange({ q = "", from = null, to = null, max = 5000 } = {}) {
  const records = [];
  let cursor = "";
  do {
    const page = await fetchPage({ q, from, to, limit: 200, cursor });
    records.push(...page.records);
    cursor = page.nextCursor || "";
  } while (cursor && records.length < max);
  return { records, truncated: Boolean(cursor) };
}

// 「載入更多」按鈕接近可視範圍時自動觸發。按鈕隱藏代表沒有下一頁、disabled 代表載入中。
// 回傳 recheck：一頁載入成功後呼叫，按鈕仍在範圍內（例如螢幕很高）就再載一頁；失敗時不呼叫，避免無限重試。
export function autoLoadMore(button, onReach) {
  if (!("IntersectionObserver" in window)) return () => {};
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !button.hidden && !button.disabled) onReach();
  }, { rootMargin: "400px 0px" });
  io.observe(button);
  return () => {
    io.unobserve(button);
    io.observe(button);
  };
}
