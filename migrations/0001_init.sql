-- 帳號。密碼以 PBKDF2-SHA256 加鹽雜湊保存（src/password.js），不存明文。
-- password_hash 為 NULL：尚未設定密碼，登入時改比對 Worker secret APP_PASSWORD，成功後立即寫入雜湊。
--   用途是首次登入與救援（把雜湊清成 NULL 即可用 APP_PASSWORD 登入）。
-- session_version：改帳號或密碼時遞增，簽進 session cookie，其他裝置的登入隨之失效。
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  password_changed_at TEXT
);
INSERT INTO users (id, username, created_at) VALUES (1, 'admin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 通行金鑰（WebAuthn），每把歸屬一個帳號。
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,               -- credential ID（base64url）
  public_key TEXT NOT NULL,          -- COSE 公鑰（base64url）
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX idx_passkeys_user ON passkeys (user_id);

-- 登入方式（全站）：password_login = 0 時登入頁只剩通行金鑰。
CREATE TABLE auth_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_login INTEGER NOT NULL DEFAULT 1
);
INSERT INTO auth_config (id, password_login) VALUES (1, 1);

-- 密碼登入的嘗試次數：以來源 IP 為單位，時間窗內超過上限就拒絕（src/auth.js）。
CREATE TABLE login_attempts (
  source TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL      -- 毫秒時間戳
);

-- 花錢紀錄。金額存最小單位的整數（amount_minor），避免浮點誤差；小數位數由幣別決定（src/db.js 的 CURRENCIES）。
-- occurred_at 是 UTC 的 ISO 8601 字串，畫面依裝置時區顯示。
-- 照片本體在 R2（只存壓縮後的 JPEG），一筆最多一張；photo_key 為 NULL 表示沒有照片。
CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  photo_key TEXT,
  photo_width INTEGER,
  photo_height INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_records_user_time ON records (user_id, occurred_at DESC, id DESC);

-- 每個帳號一份設定（JSON）。
CREATE TABLE settings (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
