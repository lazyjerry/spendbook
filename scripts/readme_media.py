#!/usr/bin/env python3
"""重拍 README 的截圖與操作影片（由 scripts/readme-media.sh 呼叫，不單獨執行）。

對一個跑起來、資料庫是空的本機站台：登入、寫入虛構的大筆花費示範紀錄，
拍 docs/readme-media/*.png，再錄一段手機尺寸的操作影片（webm，交給外層腳本轉 mp4 與 gif）。
用法：readme_media.py <網址> <密碼> --out <輸出目錄> --video-dir <影片暫存目錄>
"""
import argparse
import base64
import datetime
import io
import random
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("base")
parser.add_argument("password")
parser.add_argument("--out", required=True)
parser.add_argument("--video-dir", required=True)
args = parser.parse_args()
BASE = args.base.rstrip("/")
OUT = Path(args.out)

# 虛構的示範紀錄：(幾天前, 標題, 幣別, 金額, 描述, 是否附照片)
RECORDS = [
    (2, "沖繩來回機票", "TWD", "17600", "兩人，九月出發。", False),
    (3, "沖繩住宿四晚", "JPY", "96000", "那霸兩晚、恩納兩晚。", True),
    (5, "冷氣汰舊換新", "TWD", "42800", "客廳那台，含安裝與舊機回收。", False),
    (9, "機車大保養", "TWD", "6800", "", True),
    (12, "表弟結婚紅包", "TWD", "6600", "", False),
    (16, "年繳保費", "TWD", "31250", "醫療險加意外險。", False),
    (20, "人體工學椅", "TWD", "23900", "試坐三家才決定。", True),
    (24, "健檢", "TWD", "12000", "", False),
    (31, "相機鏡頭", "JPY", "128000", "在大阪買的，退稅後的價格。", True),
    (38, "洗衣機", "TWD", "27900", "", False),
    (47, "線上課程", "TWD", "8800", "資料工程，一年內看完。", False),
    (58, "牙齒矯正頭期款", "TWD", "50000", "", False),
    (70, "搬家費", "TWD", "14500", "兩車加拆裝。", False),
]
# 影片裡現場新增的那一筆
NEW = {"title": "換筆電", "amount": "58900", "description": "舊機電池膨脹，這次選 16 吋，刷卡分三期。"}
MOBILE = {"width": 390, "height": 844}


def must(resp, what):
    if not resp.ok:
        raise SystemExit(f"{what} 失敗：{resp.status} {resp.text()[:200]}")
    return resp


def login_and_seed(ctx):
    """用這個 context 登入（cookie 留在 context 裡），資料庫是空的才寫入示範紀錄。"""
    must(ctx.request.post(f"{BASE}/api/login", data={"username": "admin", "password": args.password}), "登入")
    if must(ctx.request.get(f"{BASE}/api/records?limit=1"), "讀紀錄").json()["records"]:
        return
    rng = random.Random(7)
    now = datetime.datetime.now(datetime.timezone.utc)
    for days, title, currency, amount, description, photo in RECORDS:
        at = now - datetime.timedelta(days=days, hours=rng.randint(1, 9), minutes=rng.randint(0, 59))
        body = {"title": title, "currency": currency, "amount": amount, "description": description, "occurredAt": at.isoformat().replace("+00:00", "Z")}
        rid = must(ctx.request.post(f"{BASE}/api/records", data=body), f"新增「{title}」").json()["record"]["id"]
        if photo:
            buf = io.BytesIO()
            Image.new("RGB", (640, 480), tuple(rng.randint(90, 230) for _ in range(3))).save(buf, "JPEG")
            must(ctx.request.put(f"{BASE}/api/records/{rid}/photo?w=640&h=480", data=buf.getvalue(), headers={"Content-Type": "image/jpeg"}), "上傳照片")


def screenshots(browser):
    mobile = browser.new_context(viewport=MOBILE, device_scale_factor=2, locale="zh-TW")
    login_and_seed(mobile)
    page = mobile.new_page()
    page.goto(f"{BASE}/?view=month")
    page.wait_for_selector(".app-cal")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "month-mobile.png"), full_page=True)
    # 分享圖：從預覽的 <img> 畫回 canvas 取出原尺寸 PNG（直接抓 blob 網址會遇到重畫後被回收）
    page.goto(f"{BASE}/share")
    page.wait_for_selector("#share-image:not([hidden])")
    for style in ("timeline", "list"):
        page.check(f"input[name=style][value={style}]", force=True)
        page.wait_for_timeout(900)
        url = page.evaluate(
            "async () => { const img = document.querySelector('#share-image'); await img.decode(); const c = document.createElement('canvas');"
            " c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png') }"
        )
        (OUT / f"share-{style}.png").write_bytes(base64.b64decode(url.split(",", 1)[1]))
    mobile.close()

    desktop = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2, locale="zh-TW")
    login_and_seed(desktop)
    page = desktop.new_page()
    page.goto(f"{BASE}/stats")
    page.check("input[name=range][value='90']", force=True)
    page.wait_for_selector("#trend-chart svg")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "stats.png"), full_page=True)
    desktop.close()


def video(browser):
    """一段使用情境：記下一筆大花費 → 在列表、時間軸、月曆看到它 → 看統計 → 做成分享圖。"""
    ctx = browser.new_context(viewport=MOBILE, record_video_dir=args.video_dir, record_video_size=MOBILE, locale="zh-TW")
    login_and_seed(ctx)
    page = ctx.new_page()

    def pause(ms=900):
        page.wait_for_timeout(ms)

    def scroll_to(selector, offset=16):
        page.evaluate("([s, o]) => window.scrollTo({ top: document.querySelector(s).getBoundingClientRect().top + scrollY - o, behavior: 'smooth' })", [selector, offset])
        pause(700)

    page.goto(f"{BASE}/")
    page.wait_for_selector(".app-record")
    pause(1200)
    # 記一筆
    page.click("text=新增紀錄")
    page.wait_for_selector("#title")
    scroll_to("#basic-title")
    page.type("#title", NEW["title"], delay=120)
    page.type("#amount", NEW["amount"], delay=90)
    scroll_to("#description", 120)
    page.type("#description", NEW["description"], delay=45)
    pause(500)
    scroll_to("#save-btn", 300)
    page.click("#save-btn")
    page.wait_for_selector(".app-record")
    # 列表 → 時間軸 → 月曆
    scroll_to("#list-title")
    pause(1300)
    page.check("input[name=view][value=timeline]", force=True)
    page.wait_for_selector(".app-timeline")
    pause(1500)
    page.check("input[name=view][value=month]", force=True)
    page.wait_for_selector(".app-cal")
    scroll_to("#period-bar")
    pause(1500)
    # 統計
    page.goto(f"{BASE}/stats")
    page.wait_for_selector("#trend-chart svg")
    scroll_to("#overview-title")
    pause(1500)
    scroll_to("#trend-title")
    pause(1500)
    # 分享
    page.goto(f"{BASE}/share")
    page.wait_for_selector("#share-image:not([hidden])")
    scroll_to("#preview-title")
    pause(2200)
    ctx.close()  # 關掉 context 影片才會寫完


with sync_playwright() as p:
    browser = p.chromium.launch()
    OUT.mkdir(parents=True, exist_ok=True)
    screenshots(browser)
    print("截圖完成")
    video(browser)
    print("影片錄製完成")
    browser.close()
