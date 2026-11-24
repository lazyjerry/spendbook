// 花錢事件簿 Worker：靜態頁面（public/）＋ /api/* ＋ /media/*（R2 照片）。
// 所有請求先經過這裡（assets.run_worker_first），未登入只放行登入頁需要的檔案。
import { account, changePassword, changeUsername, currentUser, login, logout } from "./auth.js";
import { HttpError, errorResponse, json, parseId, readJson } from "./http.js";
import * as db from "./db.js";
import { geoReverse, geoSearch } from "./geo.js";
import * as media from "./media.js";
import * as passkey from "./passkey.js";

export { SpendbookRpc } from "./rpc.js";

const PUBLIC_PATHS = new Set(["/login", "/login.html", "/jerry-ui.css", "/jerry-ui.js", "/app.css", "/jerry.png", "/js/login.js", "/js/common.js", "/favicon.ico", "/vendor/simplewebauthn/browser.umd.min.js",
  // PWA：manifest 預設不帶 cookie 抓取；sw.js、離線頁與 icon 在登入頁就要拿得到
  "/manifest.webmanifest", "/sw.js", "/js/pwa.js", "/offline", "/offline.html",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"]);

function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "same-origin");
  out.headers.set("X-Frame-Options", "DENY");
  return out;
}

async function api(request, env, url, ctx) {
  const { pathname } = url;
  const method = request.method;
  let m;

  if (pathname === "/api/login" && method === "POST") return login(request, env, await readJson(request));
  if (pathname === "/api/logout" && method === "POST") return logout();
  if (pathname === "/api/auth/status" && method === "GET") return passkey.authStatus(env);
  if (pathname === "/api/passkeys/login/options" && method === "POST") return passkey.loginOptions(env, url);
  if (pathname === "/api/passkeys/login/verify" && method === "POST") return passkey.loginVerify(request, env, url);

  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "請先登入");

  if (pathname === "/api/account" && method === "GET") return account(user);
  if (pathname === "/api/account/password" && method === "PUT") return changePassword(request, env, user);
  if (pathname === "/api/account/username" && method === "PUT") return changeUsername(request, env, user);
  if (pathname === "/api/passkeys" && method === "GET") return passkey.listPasskeys(env, user);
  if (pathname === "/api/passkeys/register/options" && method === "POST") return passkey.registerOptions(env, url, user);
  if (pathname === "/api/passkeys/register/verify" && method === "POST") return passkey.registerVerify(request, env, url, user);
  if ((m = pathname.match(/^\/api\/passkeys\/([A-Za-z0-9_-]{1,1024})$/)) && method === "DELETE") return passkey.deletePasskey(env, m[1], user);
  if (pathname === "/api/auth/password-login" && method === "PUT") return passkey.setPasswordLogin(request, env);

  if (pathname === "/api/records") {
    if (method === "GET") {
      const p = url.searchParams;
      const limit = Math.min(Math.max(Number(p.get("limit")) || 50, 1), 200);
      return json(await db.listRecords(env.DB, user.id, { q: p.get("q") || "", from: p.get("from") || "", to: p.get("to") || "", limit, cursor: db.parseCursor(p.get("cursor")) }));
    }
    if (method === "POST") return json({ record: await db.createRecord(env.DB, user.id, db.validateRecord(await readJson(request))) }, 201);
  }
  if ((m = pathname.match(/^\/api\/records\/(\d+)$/))) {
    const id = parseId(m[1]);
    if (method === "GET") return json({ record: await db.getRecord(env.DB, user.id, id) });
    if (method === "PUT") return json({ record: await db.updateRecord(env.DB, user.id, id, db.validateRecord(await readJson(request))) });
    if (method === "DELETE") {
      await media.removePhoto(env, await db.deleteRecord(env.DB, user.id, id));
      return json({ ok: true });
    }
  }
  if ((m = pathname.match(/^\/api\/records\/(\d+)\/photo$/))) {
    const id = parseId(m[1]);
    if (method === "PUT") {
      await db.getRecord(env.DB, user.id, id); // 先確認紀錄存在，再寫 R2
      const photo = await media.storePhoto(request, env, user.id, url);
      let result;
      try {
        result = await db.setPhoto(env.DB, user.id, id, photo);
      } catch (err) {
        await media.removePhoto(env, photo.key); // 紀錄寫不進去：收掉剛寫的檔
        throw err;
      }
      await media.removePhoto(env, result.oldKey);
      return json({ record: result.record });
    }
    if (method === "DELETE") {
      const result = await db.setPhoto(env.DB, user.id, id, null);
      await media.removePhoto(env, result.oldKey);
      return json({ record: result.record });
    }
  }
  if (pathname === "/api/categories" && method === "GET") return json({ categories: await db.listCategories(env.DB, user.id) });
  if (pathname === "/api/geo/search" && method === "GET") return geoSearch(url, ctx);
  if (pathname === "/api/geo/reverse" && method === "GET") return geoReverse(url, ctx);
  if (pathname === "/api/settings") {
    if (method === "GET") return json({ settings: await db.getSettings(env.DB, user.id) });
    if (method === "PUT") return json({ settings: await db.saveSettings(env.DB, user.id, await readJson(request)) });
  }

  throw new HttpError(404, "找不到這個 API");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) return withSecurityHeaders(await api(request, env, url, ctx));

      const user = PUBLIC_PATHS.has(url.pathname) ? null : await currentUser(request, env);
      if (!PUBLIC_PATHS.has(url.pathname) && !user) {
        const accept = request.headers.get("Accept") || "";
        if (request.method === "GET" && (accept.includes("text/html") || !/\.[a-z0-9]+$/i.test(url.pathname))) {
          const next = url.pathname + url.search;
          return Response.redirect(`${url.origin}/login?next=${encodeURIComponent(next)}`, 302);
        }
        return new Response("請先登入", { status: 401 });
      }

      if (url.pathname.startsWith("/media/") && request.method === "GET") {
        const key = decodeURIComponent(url.pathname.slice("/media/".length));
        return withSecurityHeaders(await media.servePhoto(env, key, user.id));
      }
      const out = withSecurityHeaders(await env.ASSETS.fetch(request));
      if ((out.headers.get("Content-Type") || "").includes("text/html")) out.headers.set("Cache-Control", "no-store");
      return out;
    } catch (err) {
      return withSecurityHeaders(errorResponse(err));
    }
  },
};
