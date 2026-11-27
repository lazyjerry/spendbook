// public/js/draft.js 的單元測試：草稿 key 與「紀錄在別處改過」的判斷。scripts/check.sh 會跑：node scripts/test-draft.mjs
// IndexedDB 的讀寫只在瀏覽器裡有，這裡不測。
import assert from "node:assert/strict";
import { draftKey, isStale } from "../public/js/draft.js";

// 新增與修改分開存，不同帳號、不同紀錄互不相干
assert.equal(draftKey(1, 0), "u1:new");
assert.equal(draftKey(1, 42), "u1:r42");
assert.notEqual(draftKey(1, 42), draftKey(2, 42));
assert.notEqual(draftKey(1, 0), draftKey(2, 0));

// 新增的草稿沒有伺服器上的版本可比
assert.equal(isStale({ baseUpdatedAt: null }, null), false);
// 修改的草稿：開始編輯後紀錄沒再變過 → 不算過時
assert.equal(isStale({ baseUpdatedAt: "2026-11-20T04:00:00.000Z" }, { updatedAt: "2026-11-20T04:00:00.000Z" }), false);
// 紀錄在別的裝置或 MCP 改過 → 過時
assert.equal(isStale({ baseUpdatedAt: "2026-11-20T04:00:00.000Z" }, { updatedAt: "2026-11-21T09:30:00.000Z" }), true);

console.log("draft 測試通過");
