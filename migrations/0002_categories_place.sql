-- 類別與地點（docs/afk-skill/adr/013）。都是選填，舊紀錄維持空值。
-- categories：JSON 字串陣列，例如 ["旅行","3C"]；搜尋串進 instr()，類別清單用 json_each 依帳號彙總。
-- place：地點名稱或地址；lat／lng：WGS84 經緯度，沒有座標時兩欄都是 NULL。
ALTER TABLE records ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
ALTER TABLE records ADD COLUMN place TEXT NOT NULL DEFAULT '';
ALTER TABLE records ADD COLUMN lat REAL;
ALTER TABLE records ADD COLUMN lng REAL;
