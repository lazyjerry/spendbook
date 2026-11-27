// 編輯頁還沒儲存的內容（草稿）：邊打邊存在這台裝置的 IndexedDB，重新開啟頁面時還原。
// 草稿只在這台裝置、不會送到伺服器；照片是壓縮後的 JPEG Blob，所以用 IndexedDB 而不是 localStorage。
// key 帶帳號編號，換帳號登入看不到別人的草稿；按登出時整批清掉（見 common.js 的 bindLogout）。
// IndexedDB 不能用（無痕模式、被封鎖）時讀寫都靜默失敗，編輯頁照常可用，只是不保留草稿。

const DB_NAME = "spendbook-drafts";
const STORE = "drafts";

// 新增是 u<帳號>:new，修改是 u<帳號>:r<紀錄編號>
export const draftKey = (userId, recordId) => `u${userId}:${recordId ? `r${recordId}` : "new"}`;

// 修改的草稿記著開始編輯時紀錄的 updatedAt；跟伺服器現在的不同，代表紀錄在別處改過
export const isStale = (draft, record) => Boolean(record) && draft.baseUpdatedAt !== record.updatedAt;

let dbPromise = null;
function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function readDraft(key) {
  try {
    return (await run("readonly", (s) => s.get(key))) || null;
  } catch {
    return null;
  }
}

export async function writeDraft(key, draft) {
  try {
    await run("readwrite", (s) => s.put({ ...draft, savedAt: new Date().toISOString() }, key));
    return true;
  } catch {
    return false;
  }
}

export async function removeDraft(key) {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {}
}

export async function clearDrafts() {
  try {
    await run("readwrite", (s) => s.clear());
  } catch {}
}
