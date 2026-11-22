// 密碼雜湊：PBKDF2-SHA256、每筆 16 bytes 隨機鹽，
// 存成 "pbkdf2-sha256$<次數>$<鹽>$<雜湊>"（base64url）。D1 不存明文。
// Workers 的 WebCrypto PBKDF2 最多 100,000 次；次數寫在字串裡，日後調整時舊雜湊仍能驗證。
import { HttpError } from "./http.js";

const ALGO = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const MIN_CHARS = 8;
const MAX_CHARS = 128;
const enc = new TextEncoder();

function toB64url(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${ALGO}$${ITERATIONS}$${toB64url(salt)}$${toB64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [algo, iter, salt, hash] = String(stored || "").split("$");
  const iterations = Number(iter);
  if (algo !== ALGO || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !salt || !hash) return false;
  const expected = fromB64url(hash);
  const actual = new Uint8Array(await derive(password, fromB64url(salt), iterations));
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}

// 帳號不存在時也跑一次雜湊，讓回應時間不洩漏帳號是否存在。
let dummy;
export async function burnPasswordCheck(password) {
  dummy ??= await hashPassword("not-a-real-password");
  await verifyPassword(password, dummy);
}

export function validateNewPassword(password) {
  if (typeof password !== "string") throw new HttpError(400, "請輸入新密碼");
  const n = [...password].length;
  if (n < MIN_CHARS) throw new HttpError(422, `新密碼至少要 ${MIN_CHARS} 個字`);
  if (n > MAX_CHARS) throw new HttpError(422, `新密碼最多 ${MAX_CHARS} 個字`);
  if (password.trim() !== password) throw new HttpError(422, "新密碼的開頭與結尾不能是空白");
  return password;
}
