# Usage: python -I build_xxxus30_demo_banner.py <out_dir>
"""XXX US30 'free 30-day demo' promo banners (no results shown - positives only, demo not live)."""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
F = r"C:\Windows\Fonts"
BG1, BG2 = (4, 10, 24), (18, 35, 63)
ICE, BLUE, MUTED, GOLD = (232, 242, 255), (125, 184, 255), (141, 162, 189), (240, 190, 70)


def font(size, bold=True):
    return ImageFont.truetype(os.path.join(F, "segoeuib.ttf" if bold else "segoeui.ttf"), size)


def background(W, H):
    img = Image.new("RGB", (W, H), BG1)
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W + y / H) / 2
            px[x, y] = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W * 0.45, H * -0.1, W * 1.2, H * 0.9), fill=(59, 130, 246, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(W // 8))
    img = Image.alpha_composite(img.convert("RGBA"), glow)
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(grid)
    step = max(24, W // 40)
    for x in range(0, W, step):
        d.line((x, 0, x, H), fill=(255, 255, 255, 9))
    for y in range(0, H, step):
        d.line((0, y, W, y), fill=(255, 255, 255, 9))
    return Image.alpha_composite(img, grid)


def columns_icon(d, cx, cy, s):
    """Temple columns + rising line (the XXX US30 mark)."""
    d.polygon([(cx - 124 * s, cy - 34 * s), (cx, cy - 92 * s), (cx + 124 * s, cy - 34 * s)], fill=BLUE)
    for i in range(6):
        x0 = cx + (-96 + 34 * i) * s
        d.rounded_rectangle((x0, cy - 26 * s, x0 + 16 * s, cy + 66 * s), radius=3 * s, fill=ICE)
    d.rectangle((cx - 118 * s, cy + 70 * s, cx + 118 * s, cy + 82 * s), fill=ICE)
    d.rectangle((cx - 132 * s, cy + 82 * s, cx + 132 * s, cy + 94 * s), fill=BLUE)
    d.rectangle((cx - 146 * s, cy + 94 * s, cx + 146 * s, cy + 106 * s), fill=(43, 111, 224))
    pts = [(-150, 40), (-92, 10), (-50, 26), (10, -30), (70, -6), (150, -86)]
    d.line([(cx + x * s, cy + y * s) for x, y in pts], fill=(255, 255, 255), width=max(3, int(7 * s)), joint="curve")


def pill(d, x, y, text, f, pad=22):
    w = d.textlength(text, font=f) + pad * 2
    h = f.size + 20
    d.rounded_rectangle((x, y, x + w, y + h), radius=h // 2, fill=(10, 26, 58), outline=BLUE, width=2)
    d.text((x + pad, y + 8), text, font=f, fill=ICE)
    return x + w + 14


RISK = "DEMO ACCOUNTS ONLY  -  DEMO RESULTS DO NOT PREDICT LIVE RESULTS  -  TRADING INVOLVES RISK"


def landscape(W, H, name):
    img = background(W, H)
    d = ImageDraw.Draw(img)
    u = W / 1200
    d.rectangle((3, 3, W - 4, H - 4), outline=BLUE, width=3)
    d.text((60 * u, 50 * u), "ALGOTRADERS24", font=font(int(26 * u)), fill=ICE, spacing=0)
    d.rounded_rectangle((60 * u, 110 * u, 400 * u, 160 * u), radius=25 * u, fill=GOLD)
    d.text((82 * u, 117 * u), "FREE  -  30 DAYS", font=font(int(30 * u)), fill=(20, 17, 10))
    d.text((56 * u, 170 * u), "XXX US30", font=font(int(125 * u)), fill=ICE)
    d.text((60 * u, 350 * u), "Try our multi-module US30 breakout EA", font=font(int(30 * u)), fill=(207, 227, 255))
    d.text((60 * u, 396 * u), "on your own MT5 demo account", font=font(int(30 * u)), fill=(207, 227, 255))
    pf = font(int(17 * u))
    x = 60 * u
    for t in ("3 BREAKOUT MODULES", "DAILY LOSS GUARD", "ON-CHART PANEL"):
        x = pill(d, x, 450 * u, t, pf)
    d.rounded_rectangle((60 * u, 520 * u, 620 * u, 590 * u), radius=12 * u, fill=GOLD)
    d.text((86 * u, 534 * u), "Start free: algotraders24.ai/demo", font=font(int(32 * u)), fill=(20, 17, 10))
    columns_icon(d, 985 * u, 250 * u, 0.95 * u)
    d.text((60 * u, H - 48 * u), RISK, font=font(int(13 * u), False), fill=MUTED)
    img.convert("RGB").save(os.path.join(out_dir, name), quality=95)


def square(S, name):
    img = background(S, S)
    d = ImageDraw.Draw(img)
    u = S / 1080
    d.rectangle((4, 4, S - 5, S - 5), outline=BLUE, width=4)
    d.text((S / 2, 70 * u), "ALGOTRADERS24", font=font(int(30 * u)), fill=ICE, anchor="mm")
    columns_icon(d, S / 2, 330 * u, 1.5 * u)
    d.text((S / 2, 560 * u), "XXX US30", font=font(int(170 * u)), fill=ICE, anchor="mm")
    d.rounded_rectangle((S / 2 - 250 * u, 650 * u, S / 2 + 250 * u, 715 * u), radius=33 * u, fill=GOLD)
    d.text((S / 2, 683 * u), "FREE 30-DAY DEMO", font=font(int(38 * u)), fill=(20, 17, 10), anchor="mm")
    d.text((S / 2, 775 * u), "Multi-module US30 breakout EA for MT5", font=font(int(34 * u)), fill=(207, 227, 255), anchor="mm")
    pf = font(int(20 * u))
    items = ("3 BREAKOUT MODULES", "DAILY LOSS GUARD", "ON-CHART PANEL")
    total = sum(d.textlength(t, font=pf) + 44 + 14 for t in items) - 14
    x = (S - total) / 2
    for t in items:
        x = pill(d, x, 820 * u, t, pf)
    d.text((S / 2, 915 * u), "Start free: algotraders24.ai/demo", font=font(int(36 * u)), fill=GOLD, anchor="mm")
    d.text((S / 2, S - 50 * u), "DEMO ACCOUNTS ONLY  -  DEMO RESULTS DO NOT PREDICT LIVE RESULTS", font=font(int(15 * u), False), fill=MUTED, anchor="mm")
    d.text((S / 2, S - 28 * u), "TRADING INVOLVES RISK  -  NOT FINANCIAL ADVICE", font=font(int(15 * u), False), fill=MUTED, anchor="mm")
    img.convert("RGB").save(os.path.join(out_dir, name), quality=95)


landscape(1200, 675, "xxxus30-demo-landscape-1200x675.png")
landscape(1600, 900, "xxxus30-demo-landscape-1600x900.png")
square(1080, "xxxus30-demo-square-1080.png")
print("done")
