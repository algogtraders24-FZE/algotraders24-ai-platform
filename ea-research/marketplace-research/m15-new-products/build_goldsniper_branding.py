"""Builds the Gold Sniper listing icon (200x200) and banner (1600x500) from the owner's supplied badge logo.
Usage: python -I build_goldsniper_branding.py "<badge.png>" <out_dir>"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

badge_path, out_dir = sys.argv[1:3]
os.makedirs(out_dir, exist_ok=True)
GOLD = (246, 199, 68)
CREAM = (233, 223, 196)
MUTED = (154, 143, 115)

badge = Image.open(badge_path).convert("RGB")
W, H = badge.size


def font(name, size):
    return ImageFont.truetype(os.path.join(r"C:\Windows\Fonts", name), size)


# ---------- icon 200x200 (badge, rounded corners) ----------
def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.size[0] - 1, img.size[1] - 1), radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


icon = badge.resize((200, 200), Image.LANCZOS)
rounded(icon, 38).save(os.path.join(out_dir, "icon.png"))
badge.resize((512, 512), Image.LANCZOS).save(os.path.join(out_dir, "icon-512.png"))

# ---------- banner 1600x500 ----------
BW, BH = 1600, 500
bg = Image.new("RGB", (BW, BH), (7, 7, 10))
d = ImageDraw.Draw(bg)
# diagonal warm gradient
for x in range(BW):
    t = x / BW
    r = int(7 + (36 - 7) * t * t)
    g = int(7 + (26 - 7) * t * t)
    b = int(10 + (8 - 10) * t)
    d.line((x, 0, x, BH), fill=(r, g, b))
# faint grid
grid = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
gd = ImageDraw.Draw(grid)
for x in range(0, BW, 32):
    gd.line((x, 0, x, BH), fill=(255, 255, 255, 10))
for y in range(0, BH, 32):
    gd.line((0, y, BW, y), fill=(255, 255, 255, 10))
bg = Image.alpha_composite(bg.convert("RGBA"), grid)

# halo behind the badge
halo = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
ImageDraw.Draw(halo).ellipse((-90, -60, 650, 560), fill=(246, 199, 68, 70))
halo = halo.filter(ImageFilter.GaussianBlur(70))
bg = Image.alpha_composite(bg, halo)

# badge as circle (the logo is a round badge on black)
S = 440
b2 = badge.resize((S, S), Image.LANCZOS)
cm = Image.new("L", (S, S), 0)
ImageDraw.Draw(cm).ellipse((0, 0, S - 1, S - 1), fill=255)
bg.paste(b2.convert("RGBA"), (40, 30), cm)

d = ImageDraw.Draw(bg)
# title
ft = font("segoeuib.ttf", 112)
fs = font("segoeui.ttf", 33)
fc = font("seguisb.ttf", 25)
ff = font("segoeui.ttf", 19)
# title glow
glow = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
ImageDraw.Draw(glow).text((560, 70), "GOLD SNIPER", font=ft, fill=(246, 199, 68, 150))
glow = glow.filter(ImageFilter.GaussianBlur(10))
bg = Image.alpha_composite(bg, glow)
d = ImageDraw.Draw(bg)
d.text((560, 70), "GOLD SNIPER", font=ft, fill=GOLD)
d.text((564, 215), "XAUUSD on M1  |  one precise pending order at a time", font=fs, fill=CREAM)
d.rounded_rectangle((564, 272, 754, 276), 2, fill=GOLD)

chips = [
    ("M5 trend + fair value gap", 564, 305, 330), ("Break-even + trailing exit", 912, 305, 336), ("London / New York", 1266, 305, 300),
    ("Spread + session filters", 564, 373, 330), ("Fixed or risk-based lot", 912, 373, 336), ("AT24 licence key", 1266, 373, 300),
]
ov = Image.new("RGBA", (BW, BH), (0, 0, 0, 0))
od = ImageDraw.Draw(ov)
for text, x, y, w in chips:
    od.rounded_rectangle((x, y, x + w, y + 52), 26, fill=(246, 199, 68, 30), outline=(246, 199, 68, 140), width=2)
bg = Image.alpha_composite(bg, ov)
d = ImageDraw.Draw(bg)
for text, x, y, w in chips:
    d.text((x + 26, y + 11), text, font=fc, fill=(246, 231, 181))
d.text((564, 456), "Algotraders24 AI  |  MetaTrader 5  |  Past results do not predict future results", font=ff, fill=MUTED)

bg.convert("RGB").save(os.path.join(out_dir, "banner.png"))
print("saved icon.png (200x200), icon-512.png, banner.png (1600x500) in", out_dir)
