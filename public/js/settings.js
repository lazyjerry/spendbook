// 設定頁：偏好與照片壓縮存在 /api/settings（D1，各裝置共用），欄位一變更就自動寫入；
// 通行金鑰、帳號、密碼直接打各自的 API，變更立即生效。
import { $, CURRENCIES, api, bindLogout, esc, loadSettings, setStatus } from "./common.js";

bindLogout();

const form = $("#settings-form");
const prefsStatus = $("#prefs-status");
const photoStatus = $("#photo-status");
const nickname = $("#nickname");
const quality = $("#quality");

$("#default-currency").innerHTML = CURRENCIES.map(([code, name]) => `<option value="${code}">${code}　${name}</option>`).join("");

function fill(s) {
  $("#nickname").value = s.nickname;
  $("#default-currency").value = s.defaultCurrency;
  const ws = form.querySelector(`input[name="week-start"][value="${s.weekStart}"]`);
  if (ws) ws.checked = true;
  $("#max-edge").value = String(s.maxEdge);
  quality.value = String(s.quality);
  const out = quality.closest(".range")?.querySelector("output");
  if (out) out.value = quality.value;
}

function read() {
  return {
    nickname: $("#nickname").value.trim(),
    defaultCurrency: $("#default-currency").value,
    weekStart: Number(form.querySelector('input[name="week-start"]:checked')?.value ?? 1),
    maxEdge: Number($("#max-edge").value),
    quality: Number(quality.value),
  };
}

// 變更就自動儲存：請求排隊一次送一個，送出前跟上次存好的內容比對，沒變就不送。
// 存好後不把伺服器回傳的值填回欄位，免得蓋掉請求途中又改的內容。
let lastSaved = "";
let queue = Promise.resolve();
function save(statusEl) {
  queue = queue.then(async () => {
    const next = read();
    const key = JSON.stringify(next);
    if (key === lastSaved) return;
    setStatus(statusEl, "儲存中…");
    try {
      // keepalive：點連結離開時 blur 觸發的這次儲存不會被換頁中斷
      await api("/api/settings", { method: "PUT", json: next, keepalive: true });
      lastSaved = key;
      setStatus(statusEl, "已儲存", "ok");
    } catch (err) {
      setStatus(statusEl, err.message, "error");
    }
  });
}

form.addEventListener("submit", (e) => e.preventDefault());

// 稱呼停止輸入一下就存；選單、切換、滑桿在 change 時存
let nicknameTimer;
nickname.addEventListener("input", () => {
  clearTimeout(nicknameTimer);
  nicknameTimer = setTimeout(() => save(prefsStatus), 500);
});
nickname.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  nickname.blur();
});
for (const [card, statusEl] of [[$("#prefs-title").closest(".card"), prefsStatus], [$("#photo-title").closest(".card"), photoStatus]]) {
  card.addEventListener("change", () => {
    clearTimeout(nicknameTimer);
    save(statusEl);
  });
}

// 設定載回來之前先鎖住表單，免得先改的欄位被載入結果蓋掉
form.inert = true;
fill(await loadSettings());
lastSaved = JSON.stringify(read());
form.inert = false;

// ---------- 通行金鑰 ----------
const wa = window.SimpleWebAuthnBrowser;
const addBtn = $("#add-passkey-btn");
const keyName = $("#passkey-name");
const keyStatus = $("#passkey-status");
const keyList = $("#passkey-list");
const pwSwitch = $("#password-login");
const pwStatus = $("#password-login-status");

function when(iso) {
  return iso ? new Date(iso).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "尚未使用";
}

async function loadKeys() {
  const data = await api("/api/passkeys");
  keyList.innerHTML = data.passkeys
    .map(
      (k) => `<li class="app-key">
  <div class="app-key-body"><strong>${esc(k.name)}</strong>
  <span class="app-key-meta">新增於 ${esc(when(k.createdAt))} · 最後登入：${esc(when(k.lastUsedAt))}${k.backedUp ? " · 已同步備份" : ""}</span></div>
  <button class="btn is-sm secondary" type="button" data-del="${esc(k.id)}" data-name="${esc(k.name)}">刪除</button>
</li>`,
    )
    .join("");
  pwSwitch.checked = data.passwordLogin;
  pwSwitch.disabled = data.passwordLogin && data.passkeys.length === 0;
  if (!data.passkeys.length) setStatus(keyStatus, "還沒有通行金鑰，目前只能用密碼登入");
  return data;
}

addBtn.addEventListener("click", async () => {
  if (!wa?.browserSupportsWebAuthn()) {
    setStatus(keyStatus, "這個瀏覽器不支援通行金鑰，請換用新版 Safari、Chrome 或 Edge", "error");
    return;
  }
  const name = keyName.value.trim() || "通行金鑰";
  addBtn.disabled = true;
  setStatus(keyStatus, "請在裝置上完成驗證…");
  try {
    const optionsJSON = await api("/api/passkeys/register/options", { method: "POST", json: {} });
    const response = await wa.startRegistration({ optionsJSON });
    await api("/api/passkeys/register/verify", { method: "POST", json: { response, name } });
    keyName.value = "";
    await loadKeys();
    setStatus(keyStatus, `已新增「${name}」，登入頁可以用通行金鑰登入`, "ok");
  } catch (err) {
    const msg = err.name === "InvalidStateError" ? "這台裝置已經有這個網站的通行金鑰" : err.name === "NotAllowedError" ? "已取消或逾時，請再按一次" : err.message;
    setStatus(keyStatus, msg, "error");
  } finally {
    addBtn.disabled = false;
  }
});

// 名稱欄在 settings-form 裡，按 Enter 改成新增金鑰，不送出偏好設定
keyName.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  e.preventDefault();
  addBtn.click();
});

keyList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-del]");
  if (!btn) return;
  if (!confirm(`刪除「${btn.dataset.name}」？刪除後這把金鑰不能再登入，裝置上的金鑰請到系統設定另外移除。`)) return;
  btn.disabled = true;
  try {
    await api(`/api/passkeys/${encodeURIComponent(btn.dataset.del)}`, { method: "DELETE" });
    await loadKeys();
    setStatus(keyStatus, `已刪除「${btn.dataset.name}」`, "ok");
  } catch (err) {
    btn.disabled = false;
    setStatus(keyStatus, err.message, "error");
  }
});

pwSwitch.addEventListener("change", async () => {
  const enabled = pwSwitch.checked;
  if (!enabled && !confirm("關閉後登入頁只剩通行金鑰。確定要停用密碼登入？")) {
    pwSwitch.checked = true;
    return;
  }
  pwSwitch.disabled = true;
  try {
    await api("/api/auth/password-login", { method: "PUT", json: { enabled } });
    setStatus(pwStatus, enabled ? "已允許密碼登入" : "已停用密碼登入，之後請用通行金鑰登入", "ok");
  } catch (err) {
    pwSwitch.checked = !enabled;
    setStatus(pwStatus, err.message, "error");
  } finally {
    pwSwitch.disabled = false;
  }
});

try {
  await loadKeys();
} catch (err) {
  setStatus(keyStatus, err.message, "error");
}

// ---------- 帳號與密碼 ----------
// 改完後這台換發新 cookie，其他裝置要重新登入。兩者都要先輸入目前的密碼。
const curPw = $("#current-password");
const newPw = $("#new-password");
const confirmPw = $("#confirm-password");
const usernameInput = $("#account-username");
const changeUserBtn = $("#change-username-btn");
const changePwBtn = $("#change-pw-btn");
const accountStatus = $("#account-status");
let currentUsername = "";

function needCurrentPassword() {
  if (curPw.value) return true;
  setStatus(accountStatus, "請輸入目前的密碼", "error");
  curPw.focus();
  return false;
}

changeUserBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    setStatus(accountStatus, "帳號要 3–32 個字，只能用英文字母、數字、點、底線與連字號", "error");
    usernameInput.focus();
    return;
  }
  if (username === currentUsername) {
    setStatus(accountStatus, "新帳號和目前的帳號相同", "error");
    usernameInput.focus();
    return;
  }
  if (!needCurrentPassword()) return;
  changeUserBtn.disabled = true;
  setStatus(accountStatus, "修改中…");
  try {
    const data = await api("/api/account/username", { method: "PUT", json: { currentPassword: curPw.value, username } });
    currentUsername = data.username;
    usernameInput.value = data.username;
    curPw.value = "";
    setStatus(accountStatus, `帳號已改成「${data.username}」，其他裝置要重新登入`, "ok");
  } catch (err) {
    setStatus(accountStatus, err.message, "error");
  } finally {
    changeUserBtn.disabled = false;
  }
});

changePwBtn.addEventListener("click", async () => {
  if (!needCurrentPassword()) return;
  if ([...newPw.value].length < 8) {
    setStatus(accountStatus, "新密碼至少要 8 個字", "error");
    newPw.focus();
    return;
  }
  if (newPw.value !== confirmPw.value) {
    setStatus(accountStatus, "兩次輸入的新密碼不一樣", "error");
    confirmPw.select();
    return;
  }
  changePwBtn.disabled = true;
  setStatus(accountStatus, "修改中…");
  try {
    await api("/api/account/password", { method: "PUT", json: { currentPassword: curPw.value, newPassword: newPw.value } });
    for (const f of [curPw, newPw, confirmPw]) f.value = "";
    document.querySelector(".app-setup-note")?.remove(); // 初始密碼提示：改過密碼就收掉
    setStatus(accountStatus, "已修改密碼，其他裝置要用新密碼重新登入", "ok");
  } catch (err) {
    setStatus(accountStatus, err.message, "error");
  } finally {
    changePwBtn.disabled = false;
  }
});

// 這幾個欄位在 settings-form 裡，按 Enter 改成對應的動作，不送出偏好設定
function onEnter(input, button) {
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    button.click();
  });
}
onEnter(usernameInput, changeUserBtn);
for (const f of [newPw, confirmPw]) onEnter(f, changePwBtn);
onEnter(curPw, changePwBtn);

try {
  const me = await api("/api/account");
  currentUsername = me.username;
  usernameInput.value = me.username;
  // 從登入頁被帶過來改初始密碼：捲到這張卡片並說明要做什麼
  if (me.initialPassword && new URLSearchParams(location.search).has("setup")) {
    $("#account-title").scrollIntoView({ block: "start" });
    setStatus(accountStatus, "先輸入目前的密碼（初始密碼），再改帳號與新密碼");
  }
} catch (err) {
  setStatus(accountStatus, err.message, "error");
}
