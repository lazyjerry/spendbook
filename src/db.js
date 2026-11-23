// D1 存取：花錢紀錄與設定。所有查詢都以登入帳號（user_id）過濾，帳號之間的資料互不可見。
import { HttpError } from "./http.js";

// 幣別 → 小數位數。要和 public/js/common.js 的 CURRENCIES 一致。
export const CURRENCIES = { TWD: 2, JPY: 0, USD: 2, EUR: 2, CNY: 2, HKD: 2, KRW: 0, GBP: 2, SGD: 2, THB: 2, AUD: 2, CAD: 2, MYR: 2, VND: 0 };
const MAX_AMOUNT_MINOR = 99_999_999_999; // 2 位小數時約 10 億
const TITLE_MAX = 100;
const DESC_MAX = 1024;
const PLACE_MAX = 256;
const MAX_CATEGORIES = 10;
const CATEGORY_MAX = 20;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const now = () => new Date().toISOString();
const chars = (s) => [...s].length;

function fieldError(fields) {
  const err = new HttpError(422, Object.values(fields)[0]);
  err.fields = fields;
  return err;
}

// 任何可解析的時間字串 → UTC ISO（毫秒）；不合法回 null
function toIso(value) {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// "123.45" → 12345（依幣別小數位數）；不用浮點運算
function parseAmount(value, decimals) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  const m = text.match(/^(\d{1,12})(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = m[2] || "";
  if (frac.length > decimals) return null;
  return Number(m[1]) * 10 ** decimals + Number(frac.padEnd(decimals, "0") || 0);
}

// 類別：字串陣列，去掉開頭的 #、去重；每個不含空白、最多 CATEGORY_MAX 字，最多 MAX_CATEGORIES 個
function normalizeCategories(input) {
  if (input === undefined || input === null) return { list: [] };
  if (!Array.isArray(input)) return { list: [], error: "類別格式錯誤" };
  const list = [];
  for (const raw of input) {
    const c = typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/^#+/, "").trim() : "";
    if (!c) continue;
    if (/\s/.test(c)) return { list, error: `類別「${c}」不能含空白` };
    if (chars(c) > CATEGORY_MAX) return { list, error: `類別「${c}」超過 ${CATEGORY_MAX} 字` };
    if (!list.includes(c)) list.push(c);
  }
  if (list.length > MAX_CATEGORIES) return { list, error: `類別最多 ${MAX_CATEGORIES} 個` };
  return { list };
}

function parseCategories(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// 座標：空值（null、undefined、""）代表沒有；有值就要是合法數字
const coord = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function validateRecord(body) {
  const fields = {};
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) fields.title = "請輸入標題";
  else if (chars(title) > TITLE_MAX) fields.title = `標題最多 ${TITLE_MAX} 個字`;

  const currency = typeof body?.currency === "string" ? body.currency.toUpperCase() : "";
  let amountMinor = null;
  if (!(currency in CURRENCIES)) fields.currency = "請選擇清單內的幣別";
  else {
    amountMinor = parseAmount(body?.amount, CURRENCIES[currency]);
    if (amountMinor === null) fields.amount = CURRENCIES[currency] ? `請輸入金額，最多 ${CURRENCIES[currency]} 位小數` : "請輸入金額，這個幣別沒有小數";
    else if (amountMinor > MAX_AMOUNT_MINOR) fields.amount = "金額太大";
  }

  const description = typeof body?.description === "string" ? body.description.replace(/\r\n/g, "\n").trim() : "";
  if (chars(description) > DESC_MAX) fields.description = `描述最多 ${DESC_MAX} 個字`;

  const occurredAt = toIso(body?.occurredAt);
  if (!occurredAt) fields.occurredAt = "請選擇時間";

  const categories = normalizeCategories(body?.categories);
  if (categories.error) fields.categories = categories.error;

  const place = typeof body?.place === "string" ? body.place.trim() : "";
  if (chars(place) > PLACE_MAX) fields.place = `地點最多 ${PLACE_MAX} 個字`;
  const lat = coord(body?.lat);
  const lng = coord(body?.lng);
  if ((lat === null) !== (lng === null)) fields.lat = "經緯度要一起填，或一起清空";
  else if (lat !== null && !(Number.isFinite(lat) && lat >= -90 && lat <= 90)) fields.lat = "緯度要在 -90 到 90 之間";
  else if (lng !== null && !(Number.isFinite(lng) && lng >= -180 && lng <= 180)) fields.lng = "經度要在 -180 到 180 之間";

  if (Object.keys(fields).length) throw fieldError(fields);
  const round6 = (v) => (v === null ? null : Math.round(v * 1e6) / 1e6); // 小數 6 位約 0.1 公尺
  return { title, currency, amountMinor, description, occurredAt, categories: categories.list, place, lat: round6(lat), lng: round6(lng) };
}

function toRecord(row) {
  return {
    id: row.id,
    title: row.title,
    currency: row.currency,
    amountMinor: row.amount_minor,
    description: row.description,
    occurredAt: row.occurred_at,
    categories: parseCategories(row.categories),
    place: row.place || "",
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    photoKey: row.photo_key,
    photoWidth: row.photo_width,
    photoHeight: row.photo_height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 分頁游標："<occurred_at>~<id>"（keyset，依時間新到舊）
export function parseCursor(text) {
  if (!text) return null;
  const [at, id] = String(text).split("~");
  if (!ISO_UTC.test(at) || !/^\d+$/.test(id)) throw new HttpError(400, "分頁游標格式錯誤");
  return { at, id: Number(id) };
}

// 列表與搜尋。q 以空白分隔多個關鍵字，全部符合才列出；用 instr() 比對標題、描述、地點與類別（避開 D1 LIKE pattern 的 50 byte 上限）。
// from／to 是 UTC ISO 時間（含 from、不含 to），由前端依裝置時區換算。
export async function listRecords(db, userId, { q = "", from = "", to = "", limit = 50, cursor = null }) {
  const where = ["user_id = ?"];
  const binds = [userId];
  for (const word of q.trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push("instr(lower(title || char(10) || description || char(10) || place || char(10) || categories), lower(?)) > 0");
    binds.push(word.slice(0, 100));
  }
  if (from) {
    const iso = toIso(from);
    if (!iso) throw new HttpError(400, "開始時間格式錯誤");
    where.push("occurred_at >= ?");
    binds.push(iso);
  }
  if (to) {
    const iso = toIso(to);
    if (!iso) throw new HttpError(400, "結束時間格式錯誤");
    where.push("occurred_at < ?");
    binds.push(iso);
  }
  if (cursor) {
    where.push("(occurred_at < ? OR (occurred_at = ? AND id < ?))");
    binds.push(cursor.at, cursor.at, cursor.id);
  }
  const { results } = await db
    .prepare(`SELECT * FROM records WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .bind(...binds, limit + 1)
    .all();
  const page = results.slice(0, limit);
  const last = page[page.length - 1];
  return { records: page.map(toRecord), nextCursor: results.length > limit ? `${last.occurred_at}~${last.id}` : null };
}

async function rowById(db, userId, id) {
  const row = await db.prepare("SELECT * FROM records WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!row) throw new HttpError(404, "找不到這筆紀錄，可能已被刪除");
  return row;
}

export async function getRecord(db, userId, id) {
  return toRecord(await rowById(db, userId, id));
}

export async function createRecord(db, userId, r) {
  const t = now();
  const row = await db
    .prepare("INSERT INTO records (user_id, title, currency, amount_minor, description, occurred_at, categories, place, lat, lng, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
    .bind(userId, r.title, r.currency, r.amountMinor, r.description, r.occurredAt, JSON.stringify(r.categories), r.place, r.lat, r.lng, t, t)
    .first();
  return toRecord(row);
}

export async function updateRecord(db, userId, id, r) {
  const row = await db
    .prepare("UPDATE records SET title = ?, currency = ?, amount_minor = ?, description = ?, occurred_at = ?, categories = ?, place = ?, lat = ?, lng = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *")
    .bind(r.title, r.currency, r.amountMinor, r.description, r.occurredAt, JSON.stringify(r.categories), r.place, r.lat, r.lng, now(), id, userId)
    .first();
  if (!row) throw new HttpError(404, "找不到這筆紀錄，可能已被刪除");
  return toRecord(row);
}

// 刪除紀錄，回傳它的照片 key（沒有照片回 null），由呼叫端刪 R2 檔
export async function deleteRecord(db, userId, id) {
  const row = await db.prepare("DELETE FROM records WHERE id = ? AND user_id = ? RETURNING photo_key").bind(id, userId).first();
  if (!row) throw new HttpError(404, "找不到這筆紀錄，可能已被刪除");
  return row.photo_key;
}

// 換上（或清掉）照片，回傳 { record, oldKey }；oldKey 由呼叫端刪 R2 檔
export async function setPhoto(db, userId, id, photo) {
  const old = await rowById(db, userId, id);
  const row = await db
    .prepare("UPDATE records SET photo_key = ?, photo_width = ?, photo_height = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING *")
    .bind(photo?.key ?? null, photo?.width ?? null, photo?.height ?? null, now(), id, userId)
    .first();
  if (!row) throw new HttpError(404, "找不到這筆紀錄，可能已被刪除");
  return { record: toRecord(row), oldKey: old.photo_key };
}

// 這個帳號用過的類別與筆數（多的排前面），給編輯頁的建議清單
export async function listCategories(db, userId) {
  const { results } = await db
    .prepare("SELECT j.value AS name, COUNT(*) AS count FROM records r, json_each(r.categories) j WHERE r.user_id = ? GROUP BY j.value ORDER BY count DESC, j.value")
    .bind(userId)
    .all();
  return results.map((r) => ({ name: r.name, count: r.count }));
}

// ---------- 設定 ----------
// 要和 public/js/common.js 的 DEFAULT_SETTINGS 一致。
const DEFAULT_SETTINGS = { nickname: "", defaultCurrency: "TWD", weekStart: 1, maxEdge: 1600, quality: 80 };

function cleanSettings(input) {
  const s = { ...DEFAULT_SETTINGS };
  if (typeof input?.nickname === "string") s.nickname = [...input.nickname.trim()].slice(0, 30).join("");
  if (typeof input?.defaultCurrency === "string" && input.defaultCurrency in CURRENCIES) s.defaultCurrency = input.defaultCurrency;
  if (input?.weekStart === 0 || input?.weekStart === 1) s.weekStart = input.weekStart;
  if ([1280, 1600, 2048].includes(input?.maxEdge)) s.maxEdge = input.maxEdge;
  if (Number.isInteger(input?.quality) && input.quality >= 60 && input.quality <= 95) s.quality = input.quality;
  return s;
}

export async function getSettings(db, userId) {
  const row = await db.prepare("SELECT data FROM settings WHERE user_id = ?").bind(userId).first();
  let data = null;
  try {
    data = row ? JSON.parse(row.data) : null;
  } catch {
    // 壞掉的設定當成沒有
  }
  return cleanSettings(data);
}

export async function saveSettings(db, userId, input) {
  const s = cleanSettings(input);
  await db
    .prepare("INSERT INTO settings (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(userId, JSON.stringify(s), now())
    .run();
  return s;
}
