// 通行金鑰（WebAuthn）：註冊、登入、列表、刪除，以及密碼登入開關。
// 每把金鑰歸屬一個帳號（passkeys.user_id）；登入用 discoverable credential，不需輸入帳號，由金鑰找出帳號。
// RP ID 取請求的主機名稱，所以金鑰綁在註冊時的網域；本機請用 localhost（IP 不能當 RP ID）。
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { challengeCookie, clearChallengeCookie, passwordLoginEnabled, sessionCookie, takeChallenge } from "./auth.js";
import { HttpError, json, readJson } from "./http.js";

const RP_NAME = "花錢事件簿";
function webauthnUserId(user) {
  return new TextEncoder().encode(`spendbook-user-${user.id}`);
}
const MAX_PASSKEYS = 20;

function rp(url) {
  return { rpID: url.hostname, origin: url.origin };
}

function now() {
  return new Date().toISOString();
}

function withCookies(res, ...cookies) {
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

function publicRow(row) {
  return { id: row.id, name: row.name, deviceType: row.device_type, backedUp: row.backed_up === 1, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}

async function allPasskeys(db, user) {
  const { results } = await db.prepare("SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at").bind(user.id).all();
  return results;
}

export async function authStatus(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys").first();
  return json({ passwordLogin: await passwordLoginEnabled(env.DB), hasPasskeys: row.n > 0 });
}

export async function listPasskeys(env, user) {
  const rows = await allPasskeys(env.DB, user);
  return json({ passkeys: rows.map(publicRow), passwordLogin: await passwordLoginEnabled(env.DB) });
}

export async function registerOptions(env, url, user) {
  const rows = await allPasskeys(env.DB, user);
  if (rows.length >= MAX_PASSKEYS) throw new HttpError(409, `最多只能有 ${MAX_PASSKEYS} 把通行金鑰，請先刪除不用的`);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp(url).rpID,
    userID: webauthnUserId(user),
    userName: user.username,
    userDisplayName: RP_NAME,
    attestationType: "none",
    excludeCredentials: rows.map((r) => ({ id: r.id, transports: JSON.parse(r.transports) })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  return withCookies(json(options), await challengeCookie(env, "register", options.challenge));
}

export async function registerVerify(request, env, url, user) {
  const body = await readJson(request);
  const name = [...String(body?.name ?? "").trim()].slice(0, 40).join("") || "通行金鑰";
  const expectedChallenge = await takeChallenge(request, env, "register");
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body?.response,
      expectedChallenge,
      expectedOrigin: rp(url).origin,
      expectedRPID: rp(url).rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    throw new HttpError(400, `通行金鑰驗證失敗：${err.message}`);
  }
  if (!verification.verified) throw new HttpError(400, "通行金鑰驗證失敗，請再試一次");
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  try {
    await env.DB.prepare("INSERT INTO passkeys (id, public_key, counter, transports, name, device_type, backed_up, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(credential.id, isoBase64URL.fromBuffer(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), name, credentialDeviceType, credentialBackedUp ? 1 : 0, now(), user.id)
      .run();
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(String(err.message))) throw new HttpError(409, "這把通行金鑰已經註冊過了");
    throw err;
  }
  const row = await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(credential.id).first();
  return withCookies(json({ passkey: publicRow(row) }, 201), clearChallengeCookie);
}

export async function loginOptions(env, url) {
  const options = await generateAuthenticationOptions({ rpID: rp(url).rpID, userVerification: "preferred" });
  return withCookies(json(options), await challengeCookie(env, "login", options.challenge));
}

async function loginFail(message) {
  await new Promise((r) => setTimeout(r, 800)); // 放慢暴力嘗試
  throw new HttpError(401, message);
}

export async function loginVerify(request, env, url) {
  const body = await readJson(request);
  const response = body?.response;
  const id = typeof response?.id === "string" ? response.id : "";
  const expectedChallenge = await takeChallenge(request, env, "login");
  const row = id && (await env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(id).first());
  if (!row) return loginFail("找不到這把通行金鑰，可能已從設定頁刪除；請改用其他金鑰或密碼登入");
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp(url).origin,
      expectedRPID: rp(url).rpID,
      credential: { id: row.id, publicKey: isoBase64URL.toBuffer(row.public_key), counter: row.counter, transports: JSON.parse(row.transports) },
      requireUserVerification: false,
    });
  } catch (err) {
    return loginFail(`通行金鑰驗證失敗：${err.message}`);
  }
  if (!verification.verified) return loginFail("通行金鑰驗證失敗，請再試一次");
  const user = await env.DB.prepare("SELECT id, session_version FROM users WHERE id = ?").bind(row.user_id).first();
  if (!user) return loginFail("這把通行金鑰的帳號已不存在，請改用其他方式登入");
  await env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").bind(verification.authenticationInfo.newCounter, now(), row.id).run();
  return withCookies(json({ ok: true }), await sessionCookie(env, user), clearChallengeCookie);
}

export async function deletePasskey(env, id, user) {
  // 密碼登入停用時，不能刪掉最後一把；條件寫在同一句 SQL，避免同時刪兩把的競態。
  // 密碼登入開關是全站設定，所以「最後一把」目前算全站；有第二個帳號時要改成逐帳號判斷。
  const res = await env.DB.prepare(
    "DELETE FROM passkeys WHERE id = ? AND user_id = ? AND (COALESCE((SELECT password_login FROM auth_config WHERE id = 1), 1) = 1 OR (SELECT COUNT(*) FROM passkeys) > 1)",
  )
    .bind(id, user.id)
    .run();
  if (res.meta.changes === 0) {
    const exists = await env.DB.prepare("SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?").bind(id, user.id).first();
    if (!exists) throw new HttpError(404, "找不到這把通行金鑰");
    throw new HttpError(409, "密碼登入已停用，不能刪除最後一把通行金鑰；請先在下方開啟密碼登入");
  }
  return json({ ok: true });
}

export async function setPasswordLogin(request, env) {
  const body = await readJson(request);
  if (typeof body?.enabled !== "boolean") throw new HttpError(400, "請以 enabled: true 或 false 指定是否允許密碼登入");
  if (body.enabled) {
    await env.DB.prepare("INSERT INTO auth_config (id, password_login) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET password_login = 1").run();
  } else {
    // 至少要有一把通行金鑰才能停用密碼，否則會把自己鎖在外面。
    const res = await env.DB.prepare(
      "INSERT INTO auth_config (id, password_login) SELECT 1, 0 WHERE EXISTS (SELECT 1 FROM passkeys) ON CONFLICT (id) DO UPDATE SET password_login = 0",
    ).run();
    if (res.meta.changes === 0) throw new HttpError(409, "請先新增至少一把通行金鑰，才能停用密碼登入");
  }
  return json({ passwordLogin: body.enabled });
}
