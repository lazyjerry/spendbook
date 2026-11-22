// public/js/insights.js 的單元測試：週期與金額警告的判斷。scripts/check.sh 會跑：node scripts/test-insights.mjs
import assert from "node:assert/strict";
import { alerts, cycleOf, cycles, groupKey, median } from "../public/js/insights.js";

let id = 0;
const rec = (title, ymd, amount) => ({ id: ++id, title, currency: "TWD", amountMinor: amount * 100, occurredAt: new Date(`${ymd}T12:00:00`).toISOString() });
const day = (ymd) => new Date(`${ymd}T09:00:00`);

assert.equal(median([]), 0);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 2, 3]), 2.5);

// 同一件事：數字、空白、標點、大小寫不影響
assert.equal(groupKey("iPhone 15"), groupKey("iphone16"));
assert.equal(groupKey("汽車保養（4 萬公里）"), groupKey("汽車保養 5萬公里"));
assert.notEqual(groupKey("日本機票"), groupKey("韓國機票"));
assert.equal(groupKey("2026"), "2026");

// 週期：每 90 天一次，正常
const car = ["2026-01-01", "2026-04-01", "2026-06-30"].map((d) => rec("汽車保養", d, 3000));
let c = cycleOf(car, day("2026-08-01"));
assert.equal(c.state, "ok");
assert.equal(c.usual, 90);
assert.equal(c.since, 32);

// 距上次超過 1.5 倍 → 太久沒發生
c = cycleOf(car, day("2026-12-01"));
assert.equal(c.state, "overdue");

// 最近一次間隔不到之前的一半 → 太密
const tooSoon = [...car, rec("汽車保養", "2026-07-20", 3000)];
assert.equal(cycleOf(tooSoon, day("2026-07-21")).state, "soon");

// 同一天的多筆算一次；只有一天算不出週期
assert.equal(cycleOf([rec("機票", "2026-03-01", 9000), rec("機票", "2026-03-01", 9000)]).state, "few");

// cycles 只列重複的事，有狀況的排前面
const list = cycles([...tooSoon, rec("筆電", "2026-05-01", 50000), rec("保險", "2025-07-25", 20000), rec("保險", "2026-07-25", 20000)], day("2026-07-21"));
assert.deepEqual(list.map((g) => g.name), ["汽車保養", "保險"]);

// 金額警告：比同一件事平常貴、遠高於平常的大筆、月份花太多
const history = [
  rec("汽車保養", "2026-01-10", 3000),
  rec("汽車保養", "2026-04-10", 3200),
  rec("汽車保養", "2026-07-10", 3100),
  rec("汽車保養", "2026-10-10", 9000), // 平常約 3100 的三倍
  rec("機票", "2026-02-01", 12000),
  rec("機票", "2026-05-01", 11000),
  rec("家電", "2026-03-01", 15000),
  rec("裝潢", "2026-10-20", 300000), // 遠高於平常的大筆
];
const a = alerts(history, { from: day("2026-10-01"), to: day("2026-11-01"), today: day("2026-11-05") });
const titles = a.records.map((x) => `${x.record.title}:${x.reasons.map((r) => r.kind).join("+")}`);
assert.deepEqual(titles, ["裝潢:outlier", "汽車保養:pricier"]);
assert.deepEqual(a.months.map((m) => m.key), ["2026-10"]);

// 範圍外的紀錄不列
assert.equal(alerts(history, { from: day("2026-01-01"), to: day("2026-02-01"), today: day("2026-11-05") }).records.length, 0);

// 歷史太少：不算 Tukey、也不比月份
const few = alerts(history.slice(0, 3), { today: day("2026-11-05") });
assert.equal(few.enough, false);
assert.equal(few.records.length, 0);

console.log("insights 單元測試通過");
