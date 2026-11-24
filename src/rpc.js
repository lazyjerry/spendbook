// 給同帳號其他 Worker（MCP 閘道）用的 RPC 入口。只開放花錢紀錄的資料操作，不開放設定、帳密、通行金鑰、照片與刪除。
// RPC 沒有登入 cookie：操作的是 migration 建立的唯一帳號（docs/afk-skill/adr/016）。
import { WorkerEntrypoint } from "cloudflare:workers";
import * as db from "./db.js";
import { callTool, describeService } from "./tools.js";

const OWNER_ID = 1;

// call() 用的資料操作，參數已由 src/tools.js 驗過。
// 不放在 SpendbookRpc 上：類別上的方法都會開放成 RPC，呼叫者就能繞過 tool 的參數驗證與授權範圍。
function ops(env) {
  return {
    list: (params) => db.listRecords(env.DB, OWNER_ID, params),
    get: (id) => db.getRecord(env.DB, OWNER_ID, id),
    categories: () => db.listCategories(env.DB, OWNER_ID),
    create: (record) => db.createRecord(env.DB, OWNER_ID, record),
    update: (id, record) => db.updateRecord(env.DB, OWNER_ID, id, record),
  };
}

export class SpendbookRpc extends WorkerEntrypoint {
  // 服務自述：同意頁的名稱、授權範圍、tool 清單（含 JSON Schema）。內容固定，不依呼叫者或時間變動
  describe() {
    return describeService();
  }

  // 執行 describe() 列出的 tool。可預期的失敗回 { ok: false, message }，不丟例外
  call(tool, args, caller) {
    return callTool(ops(this.env), tool, args, caller);
  }
}
