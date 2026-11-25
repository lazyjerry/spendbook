// 統計頁：一次取回全部歷史（可加關鍵字），在瀏覽器彙總。不同幣別分開看（不做匯率換算），一次統計一種幣別。
// 分成五個頁籤（Jerry UI A4:tabs）：總覽與搜尋、走勢、週期、警告、分享。
// 幣別與關鍵字套用到全部頁籤；日期範圍套用到總覽、走勢、分享與警告要檢查的紀錄，週期與警告的基準用全部歷史（docs/afk-skill/adr/008）。
import { $, APP_NAME, WEEKDAYS, addDays, addMonths, bindLogout, currencyInfo, dateLabel, esc, fetchRange, formatAmount, formatMoney, hm, parseYmd, rangeLabel, setStatus, startOfDay, startOfMonth, sumByCurrency, toast, ymd } from "./common.js";
import { barChart } from "./chart.js";
import { alerts, cycleOf, cycles } from "./insights.js";

bindLogout();

const MAX = 20000;
const form = $("#range-form");
const fromInput = $("#range-from");
const toInput = $("#range-to");
const qInput = $("#stats-q");
const currencySel = $("#stats-currency");
const status = $("#stats-status");
const summaryText = $("#summary-text");
const summaryStatus = $("#summary-status");
let history = []; // 符合關鍵字的全部紀錄（全部幣別，新到舊）
let loadedQ = null; // history 是用哪個關鍵字取的
let range = { from: null, to: null }; // to 不含
let seq = 0;

function presetRange(value) {
  const today = startOfDay(new Date());
  if (value === "month") return { from: startOfMonth(today), to: addMonths(startOfMonth(today), 1) };
  if (value === "last-month") return { from: addMonths(startOfMonth(today), -1), to: startOfMonth(today) };
  if (value === "90") return { from: addDays(today, -89), to: addDays(today, 1) };
  if (value === "year") return { from: new Date(today.getFullYear(), 0, 1), to: new Date(today.getFullYear() + 1, 0, 1) };
  return { from: null, to: null };
}

function fillInputs(r) {
  fromInput.value = r.from ? ymd(r.from) : "";
  toInput.value = r.to ? ymd(addDays(r.to, -1)) : "";
}

const compactTick = (currency) => (v) => formatAmount(v, currency, { compact: true });
const dayText = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
const timesText = (ratio) => `${ratio.toFixed(1).replace(/\.0$/, "")} 倍`;

// 間隔天數換成好讀的說法
function spanText(days) {
  if (days < 60) return `${Math.round(days)} 天`;
  if (days < 548) return `${Math.round(days / 30.44)} 個月`;
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, "")} 年`;
}

const STATE_TEXT = { soon: "太密", overdue: "太久沒發生", ok: "正常" };

// 週期的一列：title 可以是連結 HTML
function cycleItem(titleHtml, c, approx) {
  const warn = c.state !== "ok";
  const ago = c.since > 0 ? `（${c.since} 天前）` : c.since === 0 ? "（今天）" : "";
  const next = c.next < startOfDay(new Date()) ? `預計 ${dayText(c.next)} 該再發生，已過 ${-Math.round((c.next - startOfDay(new Date())) / 86400000)} 天` : `預計下次 ${dayText(c.next)}`;
  const detail =
    c.state === "soon"
      ? `最近一次只隔 ${spanText(c.lastGap)}，之前平常隔 ${spanText(c.earlier)}`
      : c.state === "overdue"
        ? `距上次已 ${spanText(c.since)}，平常隔 ${spanText(c.usual)}`
        : `平常每隔約 ${spanText(c.usual)}`;
  return `<li class="${warn ? "app-insight-warn" : "app-insight-ok"}"><span class="app-insight-title">${titleHtml}</span><span class="app-insight-flag">${STATE_TEXT[c.state]}</span>
<span class="app-insight-meta">${esc(detail)}；共 ${c.count} 次，平均每次 ${esc(approx(c.average))}</span>
<span class="app-insight-meta">上次 ${dayText(c.last)}${ago}，${esc(next)}</span></li>`;
}

function reasonText(reason, approx) {
  if (reason.kind === "pricier") return `比同一件事平常（中位數 ${approx(reason.base)}）貴，是 ${timesText(reason.ratio)}`;
  return `遠高於你平常的大筆（中位數 ${approx(reason.base)}），是 ${timesText(reason.ratio)}`;
}

function render() {
  const currency = currencySel.value;
  const cur = history.filter((r) => r.currency === currency);
  const inRange = (d) => (!range.from || d >= range.from) && (!range.to || d < range.to);
  const list = cur.filter((r) => inRange(new Date(r.occurredAt)));
  const money = (v) => formatMoney(v, currency);
  const unit = 10 ** currencyInfo(currency).decimals;
  const round = (v) => Math.round(v / unit) * unit; // 平均值取到整數元，不顯示小數
  const approx = (v) => money(round(v));
  const q = loadedQ || "";
  const filterText = `${currencyInfo(currency).name}${q ? `，關鍵字「${q}」` : ""}`;

  // 實際統計的日期範圍：沒指定就用資料的頭尾
  const times = list.map((r) => new Date(r.occurredAt));
  const from = range.from || (times.length ? startOfDay(new Date(Math.min(...times))) : startOfDay(new Date()));
  const lastDay = startOfDay(new Date());
  const to = range.to || addDays(times.length ? startOfDay(new Date(Math.max(...times))) : lastDay, 1);
  // 範圍延伸到未來時，「平均每天」只算到今天，免得月初的平均被還沒到的日子拉低
  const avgTo = to > addDays(lastDay, 1) && from <= lastDay ? addDays(lastDay, 1) : to;
  const dayCount = Math.max(1, Math.round((avgTo - from) / 86400000));
  const rangeText = rangeLabel(from, to);

  const total = list.reduce((n, r) => n + r.amountMinor, 0);
  const biggest = list.reduce((a, r) => (!a || r.amountMinor > a.amountMinor ? r : a), null);
  const activeDays = new Set(times.map(ymd)).size;
  const sorted = list.map((r) => r.amountMinor).sort((a, b) => a - b);
  const median = sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0;
  const dd = $("#kpi").querySelectorAll("dd");
  const values = list.length
    ? [money(total), `${list.length} 筆`, money(round(total / list.length)), money(round(total / dayCount)), `${activeDays} 天`, money(round(median)), money(biggest.amountMinor)]
    : ["—", "0 筆", "—", "—", "0 天", "—", "—"];
  dd.forEach((node, i) => {
    node.textContent = values[i];
  });
  $("#overview-range").textContent = `${rangeText}，${filterText}`;
  setFilterSummary(`${rangeText}，${filterText}`);

  // 走勢：範圍 62 天以內逐日，超過就逐月
  const daily = Math.round((to - from) / 86400000) <= 62;
  const buckets = [];
  if (daily) {
    for (let d = from; d < to; d = addDays(d, 1)) buckets.push({ key: ymd(d), label: `${d.getMonth() + 1}/${d.getDate()}`, name: dateLabel(d), value: 0, count: 0 });
  } else {
    for (let d = startOfMonth(from); d < to; d = addMonths(d, 1)) buckets.push({ key: ymd(d).slice(0, 7), label: `${String(d.getFullYear()).slice(2)}/${d.getMonth() + 1}`, name: `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`, value: 0, count: 0 });
  }
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const r of list) {
    const key = ymd(new Date(r.occurredAt));
    const b = index.get(daily ? key : key.slice(0, 7));
    if (b) {
      b.value += r.amountMinor;
      b.count += 1;
    }
  }
  $("#trend-sub").textContent = `${rangeText}，${filterText}：大筆的錢落在哪幾${daily ? "天" : "個月"}`;
  const chartItems = (rows) => rows.map((b) => ({ label: b.label, value: b.value, title: `${b.name}：${money(b.value)}（${b.count} 筆）` }));
  barChart($("#trend-chart"), chartItems(buckets), { formatValue: money, formatTick: compactTick(currency), ariaLabel: `${daily ? "每日" : "每月"}花費長條圖` });
  $("#trend-table").innerHTML = `<table class="app-table"><thead><tr><th scope="col">${daily ? "日期" : "月份"}</th><th scope="col">筆數</th><th scope="col">花費</th></tr></thead><tbody>${buckets
    .filter((b) => b.count)
    .map((b) => `<tr><th scope="row">${esc(b.name)}</th><td>${b.count}</td><td>${esc(money(b.value))}</td></tr>`)
    .join("")}</tbody></table>`;

  // 星期分布（週一排最前）
  const week = [1, 2, 3, 4, 5, 6, 0].map((w) => ({ w, label: WEEKDAYS[w], name: `星期${WEEKDAYS[w]}`, value: 0, count: 0 }));
  // 時段分布
  const slots = [
    [0, 6, "凌晨"],
    [6, 10, "早上"],
    [10, 14, "中午"],
    [14, 18, "下午"],
    [18, 22, "晚上"],
    [22, 24, "深夜"],
  ].map(([a, b, label]) => ({ a, b, label, name: `${label}（${a}–${b} 點）`, value: 0, count: 0 }));
  for (const t of times.map((at, i) => ({ at, r: list[i] }))) {
    const wd = week.find((x) => x.w === t.at.getDay());
    wd.value += t.r.amountMinor;
    wd.count += 1;
    const slot = slots.find((s) => t.at.getHours() >= s.a && t.at.getHours() < s.b);
    slot.value += t.r.amountMinor;
    slot.count += 1;
  }
  barChart($("#weekday-chart"), chartItems(week), { formatValue: money, formatTick: compactTick(currency), ariaLabel: "各星期花費長條圖", height: 220 });
  barChart($("#hour-chart"), chartItems(slots), { formatValue: money, formatTick: compactTick(currency), ariaLabel: "各時段花費長條圖", height: 220 });

  // 最花錢的 10 筆
  const top = list.slice().sort((a, b) => b.amountMinor - a.amountMinor).slice(0, 10);
  $("#top-list").innerHTML = top.length
    ? top
        .map((r) => {
          const at = new Date(r.occurredAt);
          return `<li><a href="/edit?id=${r.id}">${esc(r.title)}</a><span class="app-rank-meta">${esc(dateLabel(at))} ${hm(at)}</span><strong class="app-amount">${esc(money(r.amountMinor))}</strong></li>`;
        })
        .join("")
    : '<li class="app-rank-empty">這段範圍沒有紀錄</li>';

  // 週期：全部歷史
  const today = new Date();
  const repeat = cycles(cur, today);
  const whole = q ? cycleOf(cur, today) : null;
  const keywordBox = $("#cycle-keyword");
  keywordBox.hidden = !whole || whole.state === "few";
  keywordBox.innerHTML = keywordBox.hidden ? "" : cycleItem(esc(`「${q}」整體`), whole, approx);
  $("#cycle-sub").textContent = `${filterText}；標題相同的紀錄算同一件事，以全部歷史計算間隔`;
  $("#cycle-list").innerHTML = repeat.length
    ? repeat.map((c) => cycleItem(`<a href="/edit?id=${c.items[c.items.length - 1].id}">${esc(c.name)}</a>`, c, approx)).join("")
    : '<li class="app-insight-empty">還沒有重複發生的事：同一件事至少要在兩個不同的日子各記一次，才算得出週期</li>';

  // 警告：範圍內的紀錄與月份，基準是全部歷史
  const warn = alerts(cur, { from: range.from, to: range.to, today });
  $("#alert-sub").textContent = `${rangeText}，${filterText}；跟自己的歷史比`;
  $("#alert-list").innerHTML = warn.records.length
    ? warn.records
        .map(({ record: r, reasons }) => {
          const at = new Date(r.occurredAt);
          return `<li class="app-insight-warn"><a class="app-insight-title" href="/edit?id=${r.id}">${esc(r.title)}</a><strong class="app-amount">${esc(money(r.amountMinor))}</strong>
<span class="app-insight-meta">${esc(dateLabel(at))} ${hm(at)}</span>${reasons.map((x) => `<span class="app-insight-meta">${esc(reasonText(x, approx))}</span>`).join("")}</li>`;
        })
        .join("")
    : `<li class="app-insight-empty">${warn.enough ? "這段範圍沒有金額偏高的紀錄" : "紀錄還太少：同幣別至少 5 筆、或同一件事至少 3 筆，才比得出偏高"}</li>`;
  $("#month-list").innerHTML = warn.months.length
    ? warn.months
        .map(
          (m) => `<li class="app-insight-warn"><span class="app-insight-title">${m.from.getFullYear()} 年 ${m.from.getMonth() + 1} 月</span><strong class="app-amount">${esc(money(m.total))}</strong>
<span class="app-insight-meta">${m.average > 0 ? `前 12 個月平均每月 ${esc(approx(m.average))}，這個月是 ${timesText(m.ratio)}` : "前幾個月都沒有花費"}</span></li>`,
        )
        .join("")
    : '<li class="app-insight-empty">這段範圍沒有花得特別多的月份（歷史要有 3 個月以上才會比較）</li>';

  renderSummary({ money, q, rangeText, filterText, list, total, top, warn, repeat, from, to });
}

// ---------- 分享頁籤 ----------
let summary = "";
function renderSummary({ money, q, rangeText, filterText, list, total, top, warn, repeat, from, to }) {
  const showAmount = $("#sum-amount").checked;
  const lines = [`${APP_NAME}｜統計摘要`, `${rangeText}（${filterText}）`];
  if (!list.length) lines.push("這段範圍沒有紀錄");
  else {
    lines.push(showAmount ? `總花費 ${money(total)}，共 ${list.length} 筆` : `共 ${list.length} 筆`);
    lines.push("", "最大的幾筆：");
    top.slice(0, 5).forEach((r, i) => {
      const at = new Date(r.occurredAt);
      lines.push(`${i + 1}. ${r.title}${showAmount ? ` ${money(r.amountMinor)}` : ""}（${at.getMonth() + 1}/${at.getDate()}）`);
    });
  }
  if ($("#sum-alert").checked && (warn.records.length || warn.months.length)) {
    lines.push("", "金額偏高：");
    for (const { record: r, reasons } of warn.records.slice(0, 5)) lines.push(`・${r.title}${showAmount ? ` ${money(r.amountMinor)}` : ""}：${reasons.map((x) => (x.kind === "pricier" ? `同一件事平常的 ${timesText(x.ratio)}` : `平常大筆的 ${timesText(x.ratio)}`)).join("、")}`);
    for (const m of warn.months) lines.push(`・${m.from.getFullYear()} 年 ${m.from.getMonth() + 1} 月${showAmount ? ` ${money(m.total)}` : ""}${m.average > 0 ? `：前 12 個月平均的 ${timesText(m.ratio)}` : ""}`);
  }
  const flagged = repeat.filter((c) => c.state !== "ok");
  if ($("#sum-cycle").checked && flagged.length) {
    lines.push("", "週期提醒：");
    for (const c of flagged.slice(0, 5)) lines.push(`・${c.name}：${STATE_TEXT[c.state]}，平常每隔約 ${spanText(c.state === "soon" ? c.earlier : c.usual)}，上次 ${dayText(c.last)}`);
  }
  summary = lines.join("\n");
  summaryText.value = summary;
  $("#summary-sub").textContent = `${rangeText}，${filterText}`;
  const p = new URLSearchParams({ from: ymd(from), to: ymd(addDays(to, -1)) });
  if (q) p.set("q", q);
  $("#summary-image").href = `/share?${p}`;
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summary);
  } catch {
    summaryText.select();
    document.execCommand("copy"); // 舊瀏覽器或沒有剪貼簿權限時的退路
  }
  setStatus(summaryStatus, "已複製文字", "ok");
  toast("已複製文字");
}

$("#summary-copy").addEventListener("click", copySummary);
$("#summary-share").addEventListener("click", async () => {
  try {
    if (navigator.share) await navigator.share({ text: summary });
    else await copySummary();
  } catch (err) {
    if (err.name !== "AbortError") setStatus(summaryStatus, `分享失敗：${err.message}`, "error"); // AbortError 是使用者自己關掉分享選單
  }
});
for (const id of ["#sum-amount", "#sum-alert", "#sum-cycle"]) $(id).addEventListener("change", render);

// ---------- 載入 ----------
async function load() {
  const mine = ++seq;
  const q = qInput.value.trim();
  setStatus(status, "載入中…");
  try {
    const { records, truncated } = await fetchRange({ q, max: MAX });
    if (mine !== seq) return;
    history = records;
    loadedQ = q;
    const sums = sumByCurrency(history);
    const keep = currencySel.value;
    currencySel.innerHTML = sums.length
      ? sums.map((s) => `<option value="${s.currency}">${s.currency}　${esc(currencyInfo(s.currency).name)}（${s.count} 筆）</option>`).join("")
      : '<option value="TWD">TWD　新台幣（0 筆）</option>';
    if (sums.some((s) => s.currency === keep)) currencySel.value = keep;
    render();
    setStatus(status, truncated ? `紀錄太多，只統計最新的 ${MAX} 筆` : history.length ? "" : q ? "沒有符合關鍵字的紀錄" : "還沒有紀錄");
  } catch (err) {
    if (mine !== seq) return;
    setStatus(status, err.message, "error");
    setCollapsed(false); // 錯誤訊息在範圍卡裡，收著會看不到
  }
}

// 關鍵字變了才重新取資料；只改日期或幣別就在瀏覽器重算
const refresh = () => (qInput.value.trim() === loadedQ ? render() : load());

for (const radio of form.querySelectorAll('input[name="range"]')) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    range = presetRange(radio.value);
    fillInputs(range);
    refresh();
  });
}
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const from = parseYmd(fromInput.value);
  const last = parseYmd(toInput.value);
  if (from && last && last < from) {
    setStatus(status, "結束日期不能早於開始日期", "error");
    return;
  }
  const next = { from, to: last ? addDays(last, 1) : null };
  if (next.from?.getTime() !== range.from?.getTime() || next.to?.getTime() !== range.to?.getTime()) {
    for (const radio of form.querySelectorAll('input[name="range"]')) radio.checked = false;
  }
  range = next;
  refresh();
});
let qTimer = 0;
qInput.addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(refresh, 400);
});
currencySel.addEventListener("change", render);

// 圖表依容器寬度配置刻度；隱藏的分頁量不到寬度，切到分頁或視窗寬度變了就重畫
for (const tab of document.querySelectorAll("[data-tab]")) tab.addEventListener("click", () => requestAnimationFrame(render));
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

// 範圍卡在子頁籤上方、套用到每個頁籤，可收合；切到別的頁籤就收起來，收合時顯示目前條件。
// render() 會呼叫 setFilterSummary，第一次 render 在 load() 的 await 之後，這裡的 const／let 已初始化
const filterToggle = $("#range-toggle");
const filterSummaryEl = $("#range-summary");
let filterSummary = "";
let currentTab = document.querySelector('[data-tab][aria-pressed="true"]')?.dataset.tab;

function setCollapsed(collapsed) {
  form.hidden = collapsed;
  filterToggle.setAttribute("aria-expanded", String(!collapsed));
  filterToggle.textContent = collapsed ? "展開" : "收合";
  filterSummaryEl.textContent = collapsed ? filterSummary : "";
}
function setFilterSummary(text) {
  filterSummary = text;
  if (form.hidden) filterSummaryEl.textContent = text;
}
filterToggle.addEventListener("click", () => setCollapsed(!form.hidden));
for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => {
    if (tab.dataset.tab !== currentTab) setCollapsed(true);
    currentTab = tab.dataset.tab;
  });
}

range = presetRange("month");
fillInputs(range);
load();
