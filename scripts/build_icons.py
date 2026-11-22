#!/usr/bin/env python3
"""產生 PWA icon 與 favicon：珊瑚色方塊、白色「錢」，跟頁首的 .brand-mark 一致。

輸出（public/）：
  icons/icon-192.png、icons/icon-512.png   一般 icon：墨色外框，對應 .brand-mark 的 --line
  icons/icon-maskable-512.png              Android 遮罩用：滿版底色、字收在安全區內，不畫外框
  icons/apple-touch-icon.png（180）         iOS 會自己裁圓角，同遮罩版不畫外框
  favicon.ico（16、32、48）

字型用 macOS 內建的冬青黑體（Hiragino Sans GB W6）；產出的 PNG 進版控，只有改設計時才需要重跑。
用法：python3 scripts/build_icons.py
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"

# 對應 public/jerry-ui.css 的 token
CORAL = "#ed735f"  # --coral（--accent）
INK = "#171e34"    # --ink
WHITE = "#ffffff"  # --white

FONTS = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 2),  # W6
    ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
]
GLYPH = "錢"
SCALE = 4  # 先放大畫再縮小，邊緣比較平滑


def load_font(px):
    for path, index in FONTS:
        if Path(path).exists():
            return ImageFont.truetype(path, px, index=index)
    sys.exit("找不到中文字型（Hiragino Sans GB 或 STHeiti），這支腳本要在 macOS 上執行")


def draw_icon(size, *, border, glyph_ratio):
    """border：是否畫墨色外框；glyph_ratio：字的視覺高度佔邊長的比例。"""
    s = size * SCALE
    im = Image.new("RGB", (s, s), CORAL)
    d = ImageDraw.Draw(im)
    if border:
        w = max(SCALE, round(s * 0.05))  # 40px 的 .brand-mark 外框 2px = 5%
        d.rectangle([0, 0, s - 1, s - 1], outline=INK, width=w)
    font = load_font(round(s * glyph_ratio))
    # 依字的實際外框置中（不用字型的 ascent，避免上下偏移）
    left, top, right, bottom = d.textbbox((0, 0), GLYPH, font=font)
    x = (s - (right - left)) / 2 - left
    y = (s - (bottom - top)) / 2 - top
    d.text((x, y), GLYPH, font=font, fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def save(im, rel):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    print(f"已產生：public/{rel}")


if __name__ == "__main__":
    save(draw_icon(192, border=True, glyph_ratio=0.56), "icons/icon-192.png")
    save(draw_icon(512, border=True, glyph_ratio=0.56), "icons/icon-512.png")
    # 遮罩安全區是中心 80% 直徑的圓，字控制在約 46%
    save(draw_icon(512, border=False, glyph_ratio=0.46), "icons/icon-maskable-512.png")
    save(draw_icon(180, border=False, glyph_ratio=0.52), "icons/apple-touch-icon.png")
    fav = draw_icon(48, border=True, glyph_ratio=0.62)
    fav.save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("已產生：public/favicon.ico")
