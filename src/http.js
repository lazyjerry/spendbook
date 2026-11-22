// 回應與輸入的小工具。錯誤訊息一律用繁體中文，說明哪裡錯、怎麼改。

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(err) {
  if (err instanceof HttpError) return json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) }, err.status);
  console.error(err);
  return json({ error: "伺服器發生錯誤，請稍後再試" }, 500);
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "請以 JSON 格式送出");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "送出的資料太大");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON 格式錯誤");
  }
}

export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "編號格式錯誤");
  return id;
}
