// src/tools.js 的單元測試：MCP 閘道用的 describe() 形狀與 call() 的成功、失敗路徑。scripts/check.sh 會跑：node scripts/test-tools.mjs
// 資料操作用記憶體裡的假實作，行為比照 src/db.js（找不到丟 HttpError 404）。
import assert from "node:assert/strict";
import { HttpError } from "../src/http.js";
import { callTool, describeService, formatAmount } from "../src/tools.js";

const log = console.log;
console.log = () => {}; // 寫入類的呼叫紀錄不印在測試輸出

function fakeOps() {
  const rows = [];
  const find = (id) => {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new HttpError(404, "找不到這筆紀錄，可能已被刪除");
    return r;
  };
  return {
    rows,
    list: async ({ q, limit }) => {
      const hit = rows.filter((r) => !q || r.title.includes(q)).slice(0, limit);
      return { records: hit, nextCursor: null };
    },
    get: async (id) => ({ ...find(id) }),
    categories: async () => [{ name: "旅行", count: 1 }],
    create: async (r) => {
      const row = { id: rows.length + 1, ...r, photos: [] };
      rows.push(row);
      return { ...row };
    },
    update: async (id, r) => Object.assign(find(id), r) && { ...find(id) },
  };
}

// ---------- describe() ----------
const d = describeService();
assert.equal(typeof d.label, "string");
const scopes = d.scopes.map((s) => s.scope);
for (const s of d.scopes) {
  assert.match(s.scope, /^spendbook:[a-z0-9_-]+$/);
  assert.equal(typeof s.defaultChecked, "boolean");
}
for (const t of d.tools) {
  assert.match(t.name, /^spendbook_[a-z0-9_]+$/);
  assert.equal(t.inputSchema.type, "object");
  assert.equal(t.inputSchema.additionalProperties, false);
  assert.ok(t.scopes.length > 0);
  for (const s of t.scopes) assert.ok(scopes.includes(s), `${t.name} 用了沒宣告的範圍 ${s}`);
  assert.equal(t.annotations.readOnlyHint, t.scopes.includes("spendbook:read"));
}
assert.deepEqual(describeService(), d, "describe() 的內容要固定");

// ---------- call() ----------
const ops = fakeOps();
const caller = { client: "test-client" };
const call = (tool, args) => callTool(ops, tool, args, caller);

let r = await call("spendbook_add", { title: "  東京來回機票 ", amount: "35000", currency: "TWD", occurredAt: "2026-11-20T09:00:00+08:00", categories: ["#旅行"] });
assert.equal(r.ok, true);
assert.equal(r.data.record.title, "東京來回機票");
assert.equal(r.data.record.amountMinor, 3500000);
assert.equal(r.data.record.amount, "35000.00");
assert.equal(r.data.record.occurredAt, "2026-11-20T01:00:00.000Z");
assert.deepEqual(r.data.record.categories, ["旅行"]);

// JSON Schema 擋不到、要靠 validateRecord 的規則
r = await call("spendbook_add", { title: "   ", amount: "1.5", currency: "JPY", occurredAt: "2026-11-20T09:00:00Z" });
assert.equal(r.ok, false);
assert.match(r.message, /請輸入標題/);
assert.match(r.message, /沒有小數/);
r = await call("spendbook_add", { title: "筆電", amount: "abc", currency: "TWD", occurredAt: "不是時間" });
assert.equal(r.ok, false);
assert.match(r.message, /金額/);
assert.match(r.message, /時間/);

// 參數型別、缺欄位、多帶欄位、列舉
assert.deepEqual(await call("spendbook_add", { title: "筆電", amount: 1000, currency: "TWD", occurredAt: "2026-11-20T09:00:00Z" }), { ok: false, message: "amount 的型別不對" });
assert.deepEqual(await call("spendbook_add", { title: "筆電", amount: "1000", currency: "TWD" }), { ok: false, message: "缺少參數：occurredAt" });
assert.deepEqual(await call("spendbook_get", { id: 1, extra: true }), { ok: false, message: "不認得的參數：extra" });
assert.equal((await call("spendbook_add", { title: "筆電", amount: "1000", currency: "XXX", occurredAt: "2026-11-20T09:00:00Z" })).ok, false);
assert.deepEqual(await call("spendbook_get", { id: "1" }), { ok: false, message: "id 的型別不對" });
assert.deepEqual(await call("spendbook_get", "nope"), { ok: false, message: "參數要是物件" });
assert.equal((await call("spendbook_add", { title: "筆電", amount: "1000", currency: "TWD", occurredAt: "2026-11-20T09:00:00Z", categories: ["a b"] })).message, "類別「a b」不能含空白");

// 讀取
r = await call("spendbook_get", { id: 1 });
assert.equal(r.ok, true);
assert.ok(r.data.notice);
assert.equal(r.data.record.title, "東京來回機票");
assert.deepEqual(await call("spendbook_get", { id: 99 }), { ok: false, message: "找不到這筆紀錄，可能已被刪除" });

r = await call("spendbook_search", { q: "東京" });
assert.equal(r.ok, true);
assert.ok(r.data.notice);
assert.equal(r.data.records.length, 1);
assert.equal(r.data.nextCursor, null);
assert.deepEqual(await call("spendbook_search", { cursor: "壞掉" }), { ok: false, message: "分頁游標格式錯誤" });
assert.equal((await call("spendbook_search")).ok, true, "沒帶參數也能查");

r = await call("spendbook_categories", {});
assert.deepEqual(r, { ok: true, data: { categories: [{ name: "旅行", count: 1 }] } });

// 部分更新：只改有給的欄位
r = await call("spendbook_update", { id: 1, amount: "36000.5", place: "桃園機場", lat: 25.0797, lng: 121.2342 });
assert.equal(r.ok, true);
assert.equal(r.data.record.amountMinor, 3600050);
assert.equal(r.data.record.title, "東京來回機票");
assert.deepEqual(r.data.record.categories, ["旅行"]);
assert.equal(r.data.record.place, "桃園機場");
r = await call("spendbook_update", { id: 1, lat: null, lng: null });
assert.equal(r.data.record.lat, null);
assert.equal(r.data.record.place, "桃園機場");
r = await call("spendbook_update", { id: 1, lat: 25 });
assert.equal(r.ok, false);
assert.match(r.message, /經緯度要一起填/);
r = await call("spendbook_update", { id: 1, currency: "JPY" });
assert.equal(r.ok, false, "改成沒有小數的幣別卻沒給金額，要回說明");
r = await call("spendbook_update", { id: 1, currency: "JPY", amount: "560000" });
assert.equal(r.data.record.amount, "560000");
assert.deepEqual(await call("spendbook_update", { id: 99, title: "x" }), { ok: false, message: "找不到這筆紀錄，可能已被刪除" });

// 不認得、沒開放的 tool
assert.deepEqual(await call("spendbook_delete", { id: 1 }), { ok: false, message: "沒有 spendbook_delete 這個 tool" });
assert.deepEqual(await call("describe", {}), { ok: false, message: "沒有 describe 這個 tool" });

// 非預期的例外照丟，由閘道轉成固定說明
await assert.rejects(() => callTool({ ...ops, get: async () => { throw new Error("boom"); } }, "spendbook_get", { id: 1 }, caller), /boom/);

assert.equal(formatAmount(5, "TWD"), "0.05");
assert.equal(formatAmount(123450, "TWD"), "1234.50");
assert.equal(formatAmount(800, "JPY"), "800");

console.log = log;
console.log("MCP tool 測試通過");
