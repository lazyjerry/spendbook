// 紀錄頁：搜尋，加上五種檢視——列表、時間軸（兩者依時間新到舊、捲到底續載）、月曆、週曆、日曆（依期間取資料，可前後翻）。
// 檢視方式、日期與關鍵字寫進網址（?view=&date=&q=），從編輯頁回來或重新整理都停在同一個畫面。
import { $, WEEKDAYS, addDays, addMonths, autoLoadMore, bindLogout, dateLabel, esc, fetchPage, fetchRange, formatAmount, formatMoney, groupByDay, hm, loadSettings, mediaUrl, parseYmd, rangeLabel, setStatus, showFlash, startOfDay, startOfMonth, startOfWeek, sumByCurrency, totalsText, ymd } from "./common.js";

bindLogout();
showFlash();

const VIEWS = ["list", "timeline", "month", "week", "day"];
const PAGED = new Set(["list", "timeline"]);
const viewEl = $("#view");
const status = $("#list-status");
const summary = $("#summary");
const moreBtn = $("#more-btn");
const periodBar = $("#period-bar");
const periodLabel = $("#period-label");
const qInput = $("#q");

const params = new URLSearchParams(location.search);
const state = {
  view: VIEWS.includes(params.get("view")) ? params.get("view") : "list",
  date: parseYmd(params.get("date")) || startOfDay(new Date()),
  q: params.get("q") || "",
  weekStart: 1,
};
let records = []; // 列表／時間軸已載入的紀錄
let cursor = "";
let loadSeq = 0; // 每次重新載入加一，過期的回應直接丟掉

function syncUrl() {
  const p = new URLSearchParams();
  if (state.view !== "list") p.set("view", state.view);
  if (!PAGED.has(state.view)) p.set("date", ymd(state.date));
  if (state.q) p.set("q", state.q);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

const editUrl = (r) => `/edit?id=${r.id}`;
const newUrl = (date) => `/edit?date=${ymd(date)}`;
const thumb = (r, cls) => (r.photoKey ? `<a class="${cls}" href="${editUrl(r)}" tabindex="-1" aria-hidden="true"><img src="${esc(mediaUrl(r.photoKey))}" alt="" loading="lazy" width="${r.photoWidth || 1}" height="${r.photoHeight || 1}"></a>` : "");

// 一筆紀錄的卡片；withDate 時顯示完整日期，否則只有時間
function recordCard(r, withDate) {
  const at = new Date(r.occurredAt);
  return `<article class="app-record${r.photoKey ? " app-has-photo" : ""}">
  ${thumb(r, "app-record-cover")}
  <div class="app-record-body">
    <div class="app-record-head"><h3><a href="${editUrl(r)}">${esc(r.title)}</a></h3><strong class="app-amount">${esc(formatMoney(r.amountMinor, r.currency))}</strong></div>
    <p class="meta"><time datetime="${esc(r.occurredAt)}">${withDate ? esc(dateLabel(at)) + " " : ""}${hm(at)}</time></p>
    ${r.description ? `<p class="app-record-text">${esc(r.description)}</p>` : ""}
  </div>
</article>`;
}

function renderList() {
  viewEl.innerHTML = `<div class="app-record-list">${records.map((r) => recordCard(r, true)).join("")}</div>`;
}

// 垂直時間軸：一天一個節點，底下依時間列出當天的紀錄
function renderTimeline(list = records) {
  viewEl.innerHTML = `<ol class="app-timeline">${groupByDay(list)
    .map(
      (g) => `<li class="app-tl-day">
  <h3 class="app-tl-date">${esc(dateLabel(g.date))}<span>${g.items.length} 筆 · ${esc(totalsText(g.items))}</span></h3>
  <ol class="app-tl-items">${g.items
    .map((r) => {
      const at = new Date(r.occurredAt);
      return `<li class="app-tl-item"><time datetime="${esc(r.occurredAt)}">${hm(at)}</time>
    <div class="app-tl-card"><div class="app-record-head"><h4><a href="${editUrl(r)}">${esc(r.title)}</a></h4><strong class="app-amount">${esc(formatMoney(r.amountMinor, r.currency))}</strong></div>
    ${r.description ? `<p class="app-record-text">${esc(r.description)}</p>` : ""}${thumb(r, "app-tl-photo")}</div></li>`;
    })
    .join("")}</ol>
</li>`,
    )
    .join("")}</ol>`;
}

function setSummary(list, truncated = false) {
  if (!list.length) {
    summary.textContent = "";
    return;
  }
  summary.textContent = `${truncated ? "已載入 " : "共 "}${list.length} 筆，合計 ${totalsText(list)}`;
}

function emptyText() {
  if (state.q) return `找不到符合「${state.q}」的紀錄`;
  return PAGED.has(state.view) ? "還沒有紀錄，按上面的「新增紀錄」記下第一筆大花費" : "這段時間沒有紀錄";
}

// ---------- 列表、時間軸：分頁續載 ----------
async function loadPaged(reset) {
  const seq = reset ? ++loadSeq : loadSeq;
  if (reset) {
    records = [];
    cursor = "";
    viewEl.innerHTML = "";
    moreBtn.hidden = true;
  }
  moreBtn.disabled = true;
  setStatus(status, "載入中…");
  try {
    const page = await fetchPage({ q: state.q, limit: 50, cursor });
    if (seq !== loadSeq) return;
    records.push(...page.records);
    cursor = page.nextCursor || "";
    if (state.view === "list") renderList();
    else renderTimeline();
    moreBtn.hidden = !cursor;
    setSummary(records, Boolean(cursor));
    setStatus(status, records.length ? "" : emptyText());
    moreBtn.disabled = false;
    recheck();
  } catch (err) {
    if (seq !== loadSeq) return;
    moreBtn.disabled = false;
    setStatus(status, err.message, "error");
  }
}
const recheck = autoLoadMore(moreBtn, () => loadPaged(false));
moreBtn.addEventListener("click", () => loadPaged(false));

// ---------- 月曆、週曆、日曆：依期間取資料 ----------
function period() {
  if (state.view === "month") {
    const first = startOfMonth(state.date);
    const next = addMonths(first, 1);
    const gridFrom = startOfWeek(first, state.weekStart);
    const gridTo = addDays(startOfWeek(addDays(next, -1), state.weekStart), 7);
    return { from: first, to: next, gridFrom, gridTo, label: `${first.getFullYear()} 年 ${first.getMonth() + 1} 月` };
  }
  if (state.view === "week") {
    const from = startOfWeek(state.date, state.weekStart);
    const to = addDays(from, 7);
    return { from, to, label: rangeLabel(from, to) };
  }
  const from = startOfDay(state.date);
  return { from, to: addDays(from, 1), label: dateLabel(from) };
}

function step(n) {
  if (state.view === "month") state.date = addMonths(startOfMonth(state.date), n);
  else state.date = addDays(state.date, state.view === "week" ? 7 * n : n);
  reload();
}

function byDayMap(list) {
  const map = new Map();
  for (const r of list) {
    const key = ymd(new Date(r.occurredAt));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}

const weekdayOrder = () => Array.from({ length: 7 }, (_, i) => (state.weekStart + i) % 7);

function renderMonth(list, p) {
  const days = byDayMap(list);
  const today = ymd(new Date());
  const cells = [];
  for (let d = p.gridFrom; d < p.gridTo; d = addDays(d, 1)) {
    const key = ymd(d);
    const items = days.get(key) || [];
    const sums = sumByCurrency(items); // 格子窄，只放筆數最多那個幣別的數字（不帶符號），完整金額在 aria-label 與日曆
    const outside = d < p.from || d >= p.to;
    const amount = sums.length ? `<span class="app-cal-amount">${esc(formatAmount(sums[0].total, sums[0].currency, { compact: true }))}${sums.length > 1 ? "＋" : ""}</span><span class="app-cal-count">${items.length} 筆</span>` : "";
    const label = `${dateLabel(d)}${items.length ? `，${items.length} 筆，${totalsText(items)}` : "，沒有紀錄"}`;
    cells.push(`<button type="button" class="app-cal-day${outside ? " app-is-outside" : ""}${key === today ? " app-is-today" : ""}${items.length ? " app-has-items" : ""}" data-day="${key}" aria-label="${esc(label)}"><span class="app-cal-num">${d.getDate()}</span>${amount}</button>`);
  }
  viewEl.innerHTML = `<div class="app-cal" role="group" aria-label="${esc(p.label)}">
  ${weekdayOrder().map((w) => `<span class="app-cal-head" aria-hidden="true">${WEEKDAYS[w]}</span>`).join("")}
  ${cells.join("")}
</div><p class="hint">點日期看當天的紀錄</p>`;
}

function renderWeek(list, p) {
  const days = byDayMap(list);
  const today = ymd(new Date());
  const cols = [];
  for (let d = p.from; d < p.to; d = addDays(d, 1)) {
    const key = ymd(d);
    const items = (days.get(key) || []).slice().reverse(); // 當天由早到晚
    cols.push(`<section class="app-week-day${key === today ? " app-is-today" : ""}">
  <h3><button type="button" class="app-week-link" data-day="${key}">${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）</button></h3>
  <p class="app-week-total">${items.length ? esc(totalsText(items)) : "—"}</p>
  <ul class="app-week-items">${items.map((r) => `<li><a href="${editUrl(r)}"><time datetime="${esc(r.occurredAt)}">${hm(new Date(r.occurredAt))}</time><span>${esc(r.title)}</span><strong>${esc(formatMoney(r.amountMinor, r.currency))}</strong></a></li>`).join("")}</ul>
</section>`);
  }
  viewEl.innerHTML = `<div class="app-week">${cols.join("")}</div>`;
}

function renderDay(list, p) {
  const items = list.slice().reverse(); // 由早到晚
  viewEl.innerHTML = `<div class="app-record-list">${items.map((r) => recordCard(r, false)).join("")}</div>
<div class="actions"><a class="btn secondary" href="${newUrl(p.from)}">在這天記一筆</a></div>`;
}

async function loadPeriod() {
  const seq = ++loadSeq;
  const p = period();
  periodLabel.textContent = p.label;
  moreBtn.hidden = true;
  setStatus(status, "載入中…");
  try {
    const { records: list } = await fetchRange({ q: state.q, from: p.gridFrom || p.from, to: p.gridTo || p.to });
    if (seq !== loadSeq) return;
    const inPeriod = list.filter((r) => {
      const at = new Date(r.occurredAt);
      return at >= p.from && at < p.to;
    });
    if (state.view === "month") renderMonth(list, p);
    else if (state.view === "week") renderWeek(inPeriod, p);
    else renderDay(inPeriod, p);
    setSummary(inPeriod);
    setStatus(status, inPeriod.length ? "" : emptyText());
  } catch (err) {
    if (seq !== loadSeq) return;
    viewEl.innerHTML = "";
    setStatus(status, err.message, "error");
  }
}

function reload() {
  syncUrl();
  const paged = PAGED.has(state.view);
  periodBar.hidden = paged;
  summary.textContent = "";
  if (paged) loadPaged(true);
  else loadPeriod();
}

// ---------- 事件 ----------
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  state.q = qInput.value.trim();
  reload();
});
qInput.addEventListener("search", () => {
  // 按輸入框的清除鈕
  if (!qInput.value && state.q) {
    state.q = "";
    reload();
  }
});
for (const radio of document.querySelectorAll('input[name="view"]')) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.view = radio.value;
    reload();
  });
}
$("#prev-btn").addEventListener("click", () => step(-1));
$("#next-btn").addEventListener("click", () => step(1));
$("#today-btn").addEventListener("click", () => {
  state.date = startOfDay(new Date());
  reload();
});
// 月曆的日期格、週曆的日期標題：切到那天的日曆
viewEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-day]");
  const date = btn && parseYmd(btn.dataset.day);
  if (!date) return;
  state.date = date;
  state.view = "day";
  document.querySelector('input[name="view"][value="day"]').checked = true;
  reload();
});

qInput.value = state.q;
document.querySelector(`input[name="view"][value="${state.view}"]`).checked = true;
state.weekStart = (await loadSettings()).weekStart;
reload();
