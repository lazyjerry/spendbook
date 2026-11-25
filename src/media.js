// 照片檔（R2）：key 是 u<帳號編號>/<uuid>.jpg，一筆紀錄可以有多張（src/db.js 的 MAX_PHOTOS），不跨紀錄共用。
// 只收瀏覽器壓縮後的 JPEG；讀取時確認 key 屬於登入的帳號。
import { HttpError } from "./http.js";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const KEY = /^u(\d+)\/[0-9a-f-]{36}\.jpg$/;

export function ownsKey(key, userId) {
  const m = key.match(KEY);
  return Boolean(m) && Number(m[1]) === userId;
}

// 驗證並寫入 R2，回傳 { key, width, height }
export async function storePhoto(request, env, userId, url) {
  if ((request.headers.get("Content-Type") || "") !== "image/jpeg") throw new HttpError(415, "只接受壓縮後的 JPEG 照片");
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) throw new HttpError(400, "照片是空的");
  if (buf.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, "照片超過 3 MB，請調低設定頁的照片長邊或品質");
  const head = new Uint8Array(buf, 0, 3);
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new HttpError(415, "檔案不是 JPEG");
  const key = `u${userId}/${crypto.randomUUID()}.jpg`;
  await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: "image/jpeg" } });
  const dim = (name) => {
    const n = Number(url.searchParams.get(name));
    return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
  };
  return { key, width: dim("w"), height: dim("h") };
}

// 刪 R2 檔（一個 key 或 key 陣列）；失敗只記 log（紀錄已經不引用它，留下的是孤兒檔，不影響使用）
export async function removePhoto(env, key) {
  if (!key || (Array.isArray(key) && !key.length)) return;
  try {
    await env.PHOTOS.delete(key);
  } catch (err) {
    console.error("刪除照片檔失敗", key, err);
  }
}

export async function servePhoto(env, key, userId) {
  if (!ownsKey(key, userId)) throw new HttpError(404, "找不到這張照片");
  const obj = await env.PHOTOS.get(key);
  if (!obj) throw new HttpError(404, "找不到這張照片");
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg", ETag: obj.httpEtag, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
