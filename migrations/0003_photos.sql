-- 一筆紀錄可以有多張照片（docs/afk-skill/adr/020）。照片本體仍在 R2，這裡存 key 與尺寸；順序依 id（上傳順序）。
-- 一筆最多 MAX_PHOTOS 張（src/db.js）；查詢一律帶 user_id。
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  record_id INTEGER NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_photos_record ON photos (record_id, id);

-- 舊的單張照片搬進來。records.photo_key／photo_width／photo_height 清空後保留不用：
-- 部署是先套 migration 再換程式，DROP COLUMN 會讓換版前的舊程式寫入失敗。
INSERT INTO photos (user_id, record_id, object_key, width, height, created_at)
  SELECT user_id, id, photo_key, photo_width, photo_height, updated_at FROM records WHERE photo_key IS NOT NULL ORDER BY id;
UPDATE records SET photo_key = NULL, photo_width = NULL, photo_height = NULL WHERE photo_key IS NOT NULL;
