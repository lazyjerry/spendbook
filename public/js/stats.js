// 統計頁：取範圍內的全部紀錄，在瀏覽器彙總。不同幣別分開看（不做匯率換算），一次統計一種幣別。
import { $, WEEKDAYS, addDays, addMonths, bindLogout, currencyInfo, dateLabel, esc, fetchRange, formatAmount, formatMoney, hm, parseYmd, rangeLabel, setStatus, startOfDay, startOfMonth, sumByCurrency, ymd } from "./common.js";
import { barChart } from "./chart.js";

bindLogout();

const form = $("#range-form");
const fromInput = $("#range-from");
const toInput = $("#range-to");
const currencySel = $("#stats-currency");
const status = $("#stats-status");
let all = []; // 範圍內全部幣別的紀錄
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

function render() {
  const currency = currencySel.value;
  const list = all.filter((r) => r.currency === currency);
  const money = (v) => formatMoney(v, currency);
  const unit = 10 ** currencyInfo(currency).decimals;
  const round = (v) => Math.round(v / unit) * unit; // 平均值取到整數元，不顯示小數

  // 實際統計的日期範圍：沒指定就用資料的頭尾
  const times = list.map((r) => new Date(r.occurredAt));
  const from = range.from || (times.length ? startOfDay(new Date(Math.min(...times))) : startOfDay(new Date()));
  const lastDay = startOfDay(new Date());
  const to = range.to || addDays(times.length ? startOfDay(new Date(Math.max(...times))) : lastDay, 1);
  // 範圍延伸到未來時，「平均每天」只算到今天，免得月初的平均被還沒到的日子拉低
  const avgTo = to > addDays(lastDay, 1) && from <= lastDay ? addDays(lastDay, 1) : to;
  const dayCount = Math.max(1, Math.round((avgTo - from) / 86400000));

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
  $("#overview-range").textContent = `${rangeLabel(from, to)}，${currencyInfo(currency).name}`;

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
  $("#trend-sub").textContent = daily ? "大筆的錢落在哪幾天" : "大筆的錢落在哪幾個月";
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
}

async function load() {
  const mine = ++seq;
  setStatus(status, "載入中…");
  try {
    const { records, truncated } = await fetchRange({ from: range.from, to: range.to, max: 20000 });
    if (mine !== seq) return;
    all = records;
    const sums = sumByCurrency(all);
    const keep = currencySel.value;
    currencySel.innerHTML = sums.length
      ? sums.map((s) => `<option value="${s.currency}">${s.currency}　${esc(currencyInfo(s.currency).name)}（${s.count} 筆）</option>`).join("")
      : '<option value="TWD">TWD　新台幣（0 筆）</option>';
    if (sums.some((s) => s.currency === keep)) currencySel.value = keep;
    render();
    setStatus(status, truncated ? "紀錄太多，只統計最新的 20000 筆" : all.length ? "" : "這段範圍沒有紀錄");
  } catch (err) {
    if (mine !== seq) return;
    setStatus(status, err.message, "error");
  }
}

for (const radio of form.querySelectorAll('input[name="range"]')) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    range = presetRange(radio.value);
    fillInputs(range);
    load();
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
  for (const radio of form.querySelectorAll('input[name="range"]')) radio.checked = false;
  range = { from, to: last ? addDays(last, 1) : null };
  load();
});
currencySel.addEventListener("change", render);

// 視窗寬度變了就重畫圖（SVG 依容器寬度配置刻度與標籤）
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

range = presetRange("month");
fillInputs(range);
load();
