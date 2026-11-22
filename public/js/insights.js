// 統計頁的週期與金額警告：純計算，不碰 DOM，也不 import 其他模組（scripts/test-insights.mjs 直接用 node 跑）。
// 「同一件事」由標題推導（docs/afk-skill/adr/007）；判斷門檻都在 RULES（docs/afk-skill/adr/009），不寫死金額。
// records 的形狀同 /api/records：{ id, title, currency, amountMinor, occurredAt }，呼叫端先篩好幣別。

export const RULES = {
  tooSoon: 0.5, // 最近一次間隔不到之前平常間隔的幾倍 → 太密
  overdue: 1.5, // 距上次超過平常間隔的幾倍 → 太久沒發生
  pricier: 1.5, // 單筆超過同一件事其他紀錄中位數的幾倍 → 比平常貴
  pricierMin: 2, // 同一件事其他紀錄至少幾筆才比
  outlierMin: 5, // 同幣別至少幾筆才算 Tukey 上界（Q3 + 1.5 × IQR）
  monthOver: 1.5, // 月合計超過前 12 個月平均的幾倍 → 這個月花太多
  monthHistory: 3, // 前面至少要有幾個月的歷史
};

const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);

export function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 線性內插的分位數；sorted 要先由小到大排好
function quantile(sorted, p) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

// 標題去掉數字、標點、符號、空白並轉小寫：「iPhone 15」「iphone16」都是「iphone」。全部被去掉時用原標題。
export function groupKey(title) {
  const raw = String(title || "").trim();
  return raw.normalize("NFKC").toLowerCase().replace(/[\p{N}\p{P}\p{S}\s]+/gu, "") || raw;
}

const byTime = (a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.id - b.id);

// 依 groupKey 分組，每組由舊到新；顯示名稱用最近一筆的標題
export function groupRecords(records) {
  const map = new Map();
  for (const r of records) {
    const key = groupKey(r.title);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()].map(([key, items]) => {
    items.sort(byTime);
    return { key, name: items[items.length - 1].title, items };
  });
}

// 一組紀錄的週期。同一天的多筆算一次（例如同一天買兩張機票）。
// state：ok、soon（最近一次比之前密）、overdue（距上次比平常久）、few（只有一天，算不出間隔）
export function cycleOf(items, today = new Date()) {
  const sorted = items.slice().sort(byTime);
  const days = [...new Set(sorted.map((r) => startOfDay(new Date(r.occurredAt)).getTime()))].map((t) => new Date(t));
  const total = sorted.reduce((n, r) => n + r.amountMinor, 0);
  const base = { count: sorted.length, total, average: sorted.length ? total / sorted.length : 0, first: days[0] || null, last: days[days.length - 1] || null };
  if (days.length < 2) return { ...base, state: "few", gaps: [], usual: 0, since: base.last ? daysBetween(base.last, today) : 0, lastGap: 0, earlier: 0, next: null };
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  const usual = median(gaps);
  const lastGap = gaps[gaps.length - 1];
  const earlier = median(gaps.slice(0, -1));
  const since = daysBetween(base.last, today);
  let state = "ok";
  if (gaps.length >= 2 && earlier > 0 && lastGap < earlier * RULES.tooSoon) state = "soon";
  else if (usual > 0 && since > usual * RULES.overdue) state = "overdue";
  return { ...base, state, gaps, usual, since, lastGap, earlier, next: addDays(base.last, Math.round(usual)) };
}

const STATE_ORDER = { soon: 0, overdue: 1, ok: 2 };

// 重複發生的事：至少兩個不同日期的組。有狀況的排前面，其餘依預計下次由近到遠。
export function cycles(records, today = new Date()) {
  return groupRecords(records)
    .map((g) => ({ ...g, ...cycleOf(g.items, today) }))
    .filter((g) => g.state !== "few")
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.next - b.next);
}

// 金額警告。history 是同幣別的全部歷史；只檢查 [from, to) 範圍內的紀錄與月份（from、to 是本地時間的 Date，可為 null）。
// 回傳 { records: [{ record, group, reasons: [{ kind, base, ratio }] }], months: [{ key, from, total, average, ratio }], enough }
export function alerts(history, { from = null, to = null, today = new Date() } = {}) {
  const inRange = (d) => (!from || d >= from) && (!to || d < to);
  const sortedAmounts = history.map((r) => r.amountMinor).sort((a, b) => a - b);
  let fence = Infinity;
  let q3 = Infinity;
  if (sortedAmounts.length >= RULES.outlierMin) {
    q3 = quantile(sortedAmounts, 0.75);
    fence = q3 + 1.5 * (q3 - quantile(sortedAmounts, 0.25));
  }
  const overall = median(sortedAmounts);

  const flagged = [];
  for (const g of groupRecords(history)) {
    for (const r of g.items) {
      if (!inRange(new Date(r.occurredAt))) continue;
      const reasons = [];
      const others = g.items.filter((x) => x !== r).map((x) => x.amountMinor);
      if (others.length >= RULES.pricierMin) {
        const base = median(others);
        if (base > 0 && r.amountMinor > base * RULES.pricier) reasons.push({ kind: "pricier", base, ratio: r.amountMinor / base });
      }
      if (r.amountMinor > fence && r.amountMinor > q3) reasons.push({ kind: "outlier", base: overall, ratio: overall > 0 ? r.amountMinor / overall : 0 });
      if (reasons.length) flagged.push({ record: r, group: g.name, reasons });
    }
  }
  flagged.sort((a, b) => b.record.amountMinor - a.record.amountMinor);

  // 月合計：從最早一筆的月份到今天的月份，沒花錢的月份算 0
  const months = [];
  if (history.length) {
    const totals = new Map();
    let first = null;
    for (const r of history) {
      const d = new Date(r.occurredAt);
      const k = monthKey(d);
      totals.set(k, (totals.get(k) || 0) + r.amountMinor);
      if (!first || d < first) first = d;
    }
    const all = [];
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) all.push({ key: monthKey(d), from: d, total: totals.get(monthKey(d)) || 0 });
    all.forEach((m, i) => {
      const next = new Date(m.from.getFullYear(), m.from.getMonth() + 1, 1);
      // 月份跟範圍有重疊才檢查
      if ((to && m.from >= to) || (from && next <= from)) return;
      const prev = all.slice(Math.max(0, i - 12), i);
      if (prev.length < RULES.monthHistory) return;
      const average = prev.reduce((n, p) => n + p.total, 0) / prev.length;
      if (m.total > 0 && m.total > average * RULES.monthOver) months.push({ ...m, average, ratio: average > 0 ? m.total / average : 0 });
    });
  }
  return { records: flagged, months, enough: history.length >= RULES.outlierMin };
}
