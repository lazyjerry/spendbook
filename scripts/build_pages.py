#!/usr/bin/env python3
"""把 scripts/pages/<頁面>.html 的內文套進共用頁面殼（頁首、導覽、頁尾、PWA 標籤），輸出 public/<頁面>.html。

public/*.html 是產出物，不手改；改內文編輯 scripts/pages/，改殼編輯這支，然後跑 python3 scripts/build_pages.py。
樣式沿用 Jerry UI（public/jerry-ui.css），專案專屬樣式在 public/app.css（只用 .app- 開頭的 class）。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "pages"
OUT = ROOT / "public"

BRAND = "花錢事件簿"
GLYPH = "錢"
TAGLINE = "錢花去哪，翻一下就知道"

NAV = [("/", "紀錄"), ("/edit", "新增"), ("/stats", "統計"), ("/share", "分享"), ("/settings", "設定")]

# slug: 標題、eyebrow、h1 前半、h1 後半、導言、導覽目前頁、頁面腳本、是否為免登入頁、是否載入通行金鑰函式庫
PAGES = {
    "index": dict(title="紀錄", eyebrow="SPENDING LOG", h1=("花錢事件簿", "紀錄"), lede="錢花去哪了，翻一下就知道。", nav="/", script="list"),
    "edit": dict(title="記一筆", eyebrow="NEW RECORD", h1=("花了什麼", "記一筆"), lede="剛付完錢，趁還記得記下來。", nav="/edit", script="edit"),
    "stats": dict(title="統計", eyebrow="STATISTICS", h1=("花費", "統計"), lede="選一段時間，看錢都花在哪幾天。", nav="/stats", script="stats"),
    "share": dict(title="分享", eyebrow="SHARE", h1=("這段時間", "分享"), lede="挑一段日期，做成圖片或文字傳給別人。", nav="/share", script="share"),
    "settings": dict(title="設定", eyebrow="SETTINGS", h1=("偏好與登入", "設定"), lede="預設幣別、照片大小與登入方式。", nav="/settings", script="settings", webauthn=True),
    "login": dict(title="登入", eyebrow="SPENDING LOG", h1=("花錢事件簿", "登入"), lede="打開只屬於你的花錢紀錄。", script="login", public=True, pill="PRIVATE · PASSKEY", webauthn=True),
    "offline": dict(title="離線中", eyebrow="SPENDING LOG", h1=("花錢事件簿", "離線"), lede="網路恢復後，從上次停下的地方繼續記。", public=True, pill="OFFLINE"),
}


def nav_html(current):
    items = "\n".join(f'  <a class="chip" href="{href}"{" aria-current=\"page\"" if href == current else ""}>{label}</a>' for href, label in NAV)
    return f'<nav class="chips" aria-label="頁面">\n{items}\n</nav>'


def render(slug, page):
    body = (SRC / f"{slug}.html").read_text(encoding="utf-8").strip()
    public = page.get("public", False)
    top_end = (
        f'<p class="pill">{page["pill"]}</p>'
        if public
        else '<button class="btn is-sm secondary" type="button" id="refresh-btn">重新整理</button><button class="btn is-sm secondary" type="button" id="logout-btn">登出</button>'
    )
    scripts = ['<script src="jerry-ui.js" defer></script>']
    if page.get("webauthn"):
        scripts.append('<script src="vendor/simplewebauthn/browser.umd.min.js" defer></script>')
    if page.get("script"):
        scripts.append(f'<script type="module" src="js/{page["script"]}.js"></script>')
    main = body if public else f'<div class="stack">{nav_html(page["nav"])}\n{body}</div>'
    return f"""<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{page["title"]}｜{BRAND}</title>
<meta name="description" content="{BRAND}：{TAGLINE}">
<meta name="robots" content="noindex">
<script>if (typeof HTMLDialogElement === "function") document.documentElement.classList.add("has-dialog");</script>
<link rel="stylesheet" href="jerry-ui.css">
<link rel="stylesheet" href="app.css">
{chr(10).join(scripts)}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#f5f3ed">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="{BRAND}">
<script type="module" src="js/pwa.js"></script>
</head>
<body>
<a class="skip-link" href="#main">跳到主要內容</a>
<div class="wrap is-wide">
<header class="top">
  <a class="brand" href="./"><span class="brand-mark" aria-hidden="true">{GLYPH}</span>{BRAND}</a>
  <div class="top-end">{top_end}</div>
</header>
<header class="masthead">
  <p class="eyebrow">{page["eyebrow"]}</p>
  <div class="masthead-grid">
    <h1><span>{page["h1"][0]}</span><em>{page["h1"][1]}</em></h1>
    <p class="lede">{page["lede"]}</p>
  </div>
</header>
<main id="main">
{main}
</main>
<footer class="site-foot is-mono">{BRAND} · {TAGLINE} · © 2026 lazyjerry</footer>
</div>
<img class="jerry-mark" src="jerry.png" width="1" height="1" alt="" aria-hidden="true">
</body>
</html>
"""


if __name__ == "__main__":
    for slug, page in PAGES.items():
        (OUT / f"{slug}.html").write_text(render(slug, page), encoding="utf-8")
        print(f"已產生：public/{slug}.html")
