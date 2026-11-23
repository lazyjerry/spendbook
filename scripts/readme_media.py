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
    # 更早的紀錄：橫跨兩年，統計的走勢、週期與警告頁籤才有東西看。都在 30 天以前，不影響分享圖
    # 每年一次的事（週期正常）
    (381, "年繳保費", "TWD", "30800", "", False),
    (745, "年繳保費", "TWD", "30200", "", False),
    (390, "健檢", "TWD", "11500", "", False),
    (755, "健檢", "TWD", "11000", "", False),
    (400, "沖繩來回機票", "TWD", "15800", "", False),
    (760, "沖繩來回機票", "TWD", "16200", "", False),
    (176, "房屋稅", "TWD", "18600", "", False),
    (541, "房屋稅", "TWD", "18200", "", False),
    (358, "地價稅", "TWD", "9800", "", False),
    (723, "地價稅", "TWD", "9600", "", False),
    (279, "過年紅包", "TWD", "36000", "爸媽、外婆和姪子們。", False),
    (663, "過年紅包", "TWD", "32000", "", False),
    # 週期有狀況：保費一個月內繳了兩次（太密）、汽車保養超過半年沒做（太久沒發生）
    (45, "年繳保費", "TWD", "31250", "車險，和醫療險分開繳。", False),
    (300, "汽車定期保養", "TWD", "8500", "", False),
    (480, "汽車定期保養", "TWD", "7900", "", False),
    (660, "汽車定期保養", "TWD", "8200", "", False),
    # 金額警告：這次機車保養比平常貴、廚房翻修遠高於平常的大筆
    (190, "機車大保養", "TWD", "3200", "", False),
    (372, "機車大保養", "TWD", "2900", "", False),
    (555, "機車大保養", "TWD", "3100", "", False),
    (95, "廚房翻修", "TWD", "268000", "櫥櫃、檯面與抽油煙機一起換。", False),
    # 其他一次性的大花費，讓每個月的走勢有高有低
    (82, "換手機", "TWD", "36900", "舊的用了四年。", False),
    (128, "日本來回機票", "TWD", "21800", "賞楓，五天四夜。", False),
    (150, "電動機車", "TWD", "98000", "補助後的價格。", False),
    (215, "冰箱", "TWD", "45900", "", False),
    (248, "婚禮禮金", "TWD", "12000", "大學同學。", False),
    (330, "雙人床墊", "TWD", "32800", "", False),
    (430, "筆電", "TWD", "52900", "", False),
    (610, "沙發", "TWD", "41500", "", False),
]
# 示範紀錄的類別與地點（依標題套用，同名的每一筆都套）：標題 → (類別, 地點, 緯度, 經度)
DETAILS = {
    "沖繩來回機票": (["旅行", "沖繩"], "桃園國際機場", 25.0797, 121.2342),
    "沖繩住宿四晚": (["旅行", "沖繩"], "沖繩縣那霸市", 26.2124, 127.6809),
    "冷氣汰舊換新": (["家電"], "", None, None),
    "機車大保養": (["交通", "維修保養"], "", None, None),
    "年繳保費": (["保險"], "", None, None),
    "人體工學椅": (["家具"], "", None, None),
    "健檢": (["醫療"], "", None, None),
    "相機鏡頭": (["3C", "旅行"], "大阪市北區梅田", 34.7025, 135.4959),
    "洗衣機": (["家電"], "", None, None),
    "線上課程": (["教育"], "", None, None),
    "牙齒矯正頭期款": (["醫療"], "", None, None),
    "房屋稅": (["稅費", "房屋"], "", None, None),
    "地價稅": (["稅費", "房屋"], "", None, None),
    "過年紅包": (["紅包禮金"], "", None, None),
    "表弟結婚紅包": (["紅包禮金"], "", None, None),
    "婚禮禮金": (["紅包禮金"], "", None, None),
    "汽車定期保養": (["交通", "維修保養"], "", None, None),
    "廚房翻修": (["房屋", "家具"], "", None, None),
    "換手機": (["3C"], "", None, None),
    "日本來回機票": (["旅行"], "", None, None),
    "電動機車": (["交通"], "", None, None),
    "冰箱": (["家電"], "", None, None),
    "雙人床墊": (["家具"], "", None, None),
    "筆電": (["3C"], "", None, None),
    "沙發": (["家具"], "", None, None),
}
# 影片裡現場新增的那一筆（地點只打名稱、不按查座標，錄影不打 OpenStreetMap）
NEW = {"title": "換筆電", "amount": "58900", "description": "舊機電池膨脹，這次選 16 吋，刷卡分三期。", "category": "3C", "place": "光華商場"}
MOBILE = {"width": 390, "height": 844}
# 分享頁預設「本週」，週一拍會是空的；改用網址參數固定成近 30 天
_today = datetime.date.today()
SHARE_RANGE = f"from={_today - datetime.timedelta(days=30)}&to={_today}"


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
        if title in DETAILS:
            cats, place, lat, lng = DETAILS[title]
            body.update(categories=cats, place=place, lat=lat, lng=lng)
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
    page.goto(f"{BASE}/share?{SHARE_RANGE}")
    page.wait_for_selector("#share-image:not([hidden])")
    for style in ("timeline", "list"):
        old = page.get_attribute("#share-image", "src")
        changed = not page.is_checked(f"input[name=style][value={style}]")
        page.check(f"input[name=style][value={style}]", force=True)
        # 換樣式要等預覽換成新的 blob 網址，固定等待時間在紀錄多時會抓到舊圖
        if changed:
            page.wait_for_function("old => document.querySelector('#share-image').src !== old", arg=old)
        page.wait_for_timeout(300)
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
    page.check("input[name=range][value=year]", force=True)
    page.wait_for_selector("#top-list li a")
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / "stats.png"), full_page=True)
    page.click("[data-tab=alert]")
    page.wait_for_selector("#alert-list li")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "stats-alert.png"), full_page=True)
    desktop.close()


def video(browser):
    """一段使用情境：記下一筆大花費 → 在列表、時間軸、月曆看到它 → 看統計的總覽、走勢、週期、警告頁籤 → 做成分享圖。"""
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
    scroll_to("#category-input", 160)
    page.type("#category-input", NEW["category"], delay=150)
    pause(500)
    page.keyboard.press("Enter")
    pause(600)
    scroll_to("#place-title")
    page.type("#place", NEW["place"], delay=150)
    pause(800)
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
    page.wait_for_selector("#top-list li a")
    pause(800)
    page.check("input[name=range][value=year]", force=True)  # 今年：走勢逐月、警告有好幾個月可比
    pause(1000)
    scroll_to("#overview-title")
    pause(1500)
    scroll_to("#top-title")
    pause(1500)
    for tab, title in (("trend", "#trend-title"), ("cycle", "#cycle-title"), ("alert", "#alert-title")):
        scroll_to("[data-tabs] .chips")
        page.click(f"[data-tab={tab}]")
        pause(600)
        scroll_to(title)
        pause(1500)
        page.evaluate("window.scrollBy({ top: 520, behavior: 'smooth' })")  # 清單比一個畫面長，往下帶一段
        pause(1500)
    # 分享
    page.goto(f"{BASE}/share?{SHARE_RANGE}")
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
