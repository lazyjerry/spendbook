// 登入頁：送出帳號密碼，成功後回到原本要去的頁面。
import { $, api, setStatus } from "./common.js";

const form = $("#login-form");
const user = $("#username");
const pw = $("#password");
const status = $("#login-status");
const toggle = $("#toggle-pw");

function nextUrl() {
  const next = new URLSearchParams(location.search).get("next") || "/";
  // 以瀏覽器實際解析的結果判斷是否同源，擋掉 "/\evil.com"、"/\t/evil.com" 這類被正規化成 "//evil.com" 的寫法
  try {
    const url = new URL(next, location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}

toggle.addEventListener("click", () => {
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  toggle.textContent = show ? "隱藏" : "顯示";
  toggle.setAttribute("aria-label", show ? "隱藏密碼" : "顯示密碼");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!user.value.trim()) {
    setStatus(status, "請輸入帳號", "error");
    user.focus();
    return;
  }
  if (!pw.value) {
    setStatus(status, "請輸入密碼", "error");
    pw.focus();
    return;
  }
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  setStatus(status, "登入中…");
  try {
    await api("/api/login", { method: "POST", json: { username: user.value.trim(), password: pw.value } });
    location.href = nextUrl();
  } catch (err) {
    setStatus(status, err.message, "error");
    pw.select();
  } finally {
    btn.disabled = false;
  }
});

// 通行金鑰登入（discoverable credential，不用輸入帳號）。SimpleWebAuthnBrowser 由 vendor 的 UMD 提供。
const wa = window.SimpleWebAuthnBrowser;
const passkeyBtn = $("#passkey-btn");
const passkeyStatus = $("#passkey-status");
const supported = Boolean(wa?.browserSupportsWebAuthn());

passkeyBtn.addEventListener("click", async () => {
  passkeyBtn.disabled = true;
  setStatus(passkeyStatus, "請在裝置上完成驗證…");
  try {
    const optionsJSON = await api("/api/passkeys/login/options", { method: "POST", json: {} });
    const response = await wa.startAuthentication({ optionsJSON });
    setStatus(passkeyStatus, "登入中…");
    await api("/api/passkeys/login/verify", { method: "POST", json: { response } });
    location.href = nextUrl();
  } catch (err) {
    setStatus(passkeyStatus, err.name === "NotAllowedError" ? "已取消或逾時，請再按一次" : err.message, "error");
  } finally {
    passkeyBtn.disabled = false;
  }
});

// 依目前的登入方式顯示：有金鑰才出現通行金鑰按鈕；密碼登入停用時收起密碼表單。
let auth = { passwordLogin: true, hasPasskeys: false };
try {
  auth = await api("/api/auth/status");
} catch {
  // 讀不到狀態時退回只顯示密碼表單
}
form.hidden = !auth.passwordLogin;
passkeyBtn.hidden = !auth.hasPasskeys;
if (auth.hasPasskeys && !supported) {
  passkeyBtn.disabled = true;
  setStatus(passkeyStatus, auth.passwordLogin ? "這個瀏覽器不支援通行金鑰，請改用密碼登入" : "這個瀏覽器不支援通行金鑰，請換用新版 Safari、Chrome 或 Edge", "error");
}
