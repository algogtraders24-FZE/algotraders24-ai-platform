# Usage: python -I build_xxxus30_demo_video.py <out_dir>
"""XXX US30 free 30-day demo promo video (silent, captions only; no results, demo not live). Vertical 1080x1920 + landscape 1920x1080."""
import os
import subprocess
import sys

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 30
FD = r"C:\Windows\Fonts"
BG1, BG2 = (4, 10, 24), (18, 35, 63)
ICE, BLUE, MUTED, GOLD, DARK = (232, 242, 255), (125, 184, 255), (141, 162, 189), (240, 190, 70), (20, 17, 10)
_fc = {}


def font(size, bold=True):
    k = (int(size), bold)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(FD, "segoeuib.ttf" if bold else "segoeui.ttf"), int(size))
    return _fc[k]


def background(W, H):
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x / 64 + y / 64) / 2
            px[x, y] = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3))
    img = small.resize((W, H), Image.BILINEAR).convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((W * 0.2, H * 0.05, W * 1.1, H * 0.75), fill=(59, 130, 246, 60))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(W // 8)))
    grid = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(grid)
    step = max(24, W // 36)
    for x in range(0, W, step):
        d.line((x, 0, x, H), fill=(255, 255, 255, 8))
    for y in range(0, H, step):
        d.line((0, y, W, y), fill=(255, 255, 255, 8))
    img = Image.alpha_composite(img, grid)
    d = ImageDraw.Draw(img)
    d.rectangle((4, 4, W - 5, H - 5), outline=BLUE + (255,), width=4)
    return img


def icon(d, cx, cy, s, line_progress=1.0):
    d.polygon([(cx - 124 * s, cy - 34 * s), (cx, cy - 92 * s), (cx + 124 * s, cy - 34 * s)], fill=BLUE)
    for i in range(6):
        x0 = cx + (-96 + 34 * i) * s
        d.rounded_rectangle((x0, cy - 26 * s, x0 + 16 * s, cy + 66 * s), radius=3 * s, fill=ICE)
    d.rectangle((cx - 118 * s, cy + 70 * s, cx + 118 * s, cy + 82 * s), fill=ICE)
    d.rectangle((cx - 132 * s, cy + 82 * s, cx + 132 * s, cy + 94 * s), fill=BLUE)
    d.rectangle((cx - 146 * s, cy + 94 * s, cx + 146 * s, cy + 106 * s), fill=(43, 111, 224))
    pts = [(-150, 40), (-92, 10), (-50, 26), (10, -30), (70, -6), (150, -86)]
    n = max(2, int(len(pts) * line_progress) + 1)
    d.line([(cx + x * s, cy + y * s) for x, y in pts[:n]], fill=(255, 255, 255), width=max(3, int(7 * s)), joint="curve")


def ease(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def text_c(d, W, y, txt, size, fill, bold=True, alpha=1.0, dy=0):
    f = font(size, bold)
    d.text((W / 2, y + dy), txt, font=f, fill=fill + (int(255 * alpha),), anchor="mm")


def pill_c(d, W, y, txt, size, fill, tcol, alpha=1.0, dy=0, outline=None):
    f = font(size)
    w = d.textlength(txt, font=f) + size * 1.6
    h = size * 1.9
    x0 = W / 2 - w / 2
    d.rounded_rectangle((x0, y + dy - h / 2, x0 + w, y + dy + h / 2), radius=h / 2, fill=fill + (int(255 * alpha),), outline=(outline + (int(255 * alpha),)) if outline else None, width=3)
    d.text((W / 2, y + dy), txt, font=f, fill=tcol + (int(255 * alpha),), anchor="mm")


RISK = ["DEMO ACCOUNTS ONLY  -  DEMO RESULTS DO NOT PREDICT LIVE RESULTS", "TRADING INVOLVES RISK  -  NOT FINANCIAL ADVICE"]

# (start, end) seconds per scene
SCENES = [(0, 4.5), (4.5, 9.5), (9.5, 15.5), (15.5, 20.5), (20.5, 26), (26, 33), (33, 39)]
_dp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "durations.json")
if os.path.exists(_dp):
    import json

    _d = json.load(open(_dp))["promo"]
    _acc, SCENES = 0.0, []
    for _x in _d:
        SCENES.append((_acc, _acc + _x))
        _acc += _x
TOTAL = SCENES[-1][1]


def scene_layer(W, H, idx, t, s):
    """Draw one scene on a transparent layer; t = seconds since scene start."""
    L = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    a = ease(t / 0.6)
    dy = (1 - a) * 40 * s
    cy = H * 0.5
    if idx == 0:
        text_c(d, W, H * 0.14, "ALGOTRADERS24", 38 * s, ICE, alpha=a, dy=dy)
        icon(d, W / 2, H * 0.36, 1.9 * s, ease(t / 2.0))
        text_c(d, W, H * 0.62, "XXX US30", 150 * s, ICE, alpha=ease((t - 0.4) / 0.6), dy=(1 - ease((t - 0.4) / 0.6)) * 40 * s)
        text_c(d, W, H * 0.72, "Multi-module US30 breakout EA for MT5", 38 * s, (207, 227, 255), alpha=ease((t - 1.0) / 0.6))
    elif idx == 1:
        pill_c(d, W, H * 0.36, "FREE  -  30 DAYS", 64 * s, GOLD, DARK, alpha=a, dy=dy)
        text_c(d, W, H * 0.50, "Try it on your own", 70 * s, ICE, alpha=ease((t - 0.4) / 0.6))
        text_c(d, W, H * 0.57, "MT5 demo account", 70 * s, ICE, alpha=ease((t - 0.6) / 0.6))
        text_c(d, W, H * 0.68, "No payment. No card.", 46 * s, BLUE, alpha=ease((t - 1.6) / 0.6))
    elif idx == 2:
        text_c(d, W, H * 0.22, "3 INDEPENDENT", 76 * s, ICE, alpha=a, dy=dy)
        text_c(d, W, H * 0.29, "BREAKOUT MODULES", 76 * s, BLUE, alpha=a, dy=dy)
        for i, name in enumerate(("Module 1", "Module 2", "Module 3")):
            ai = ease((t - 0.7 - 0.5 * i) / 0.6)
            pill_c(d, W, H * (0.44 + 0.11 * i), name, 52 * s, (10, 26, 58), ICE, alpha=ai, dy=(1 - ai) * 40 * s, outline=BLUE)
        text_c(d, W, H * 0.80, "Each one looks for its own setup", 38 * s, (207, 227, 255), alpha=ease((t - 2.5) / 0.6))
    elif idx == 3:
        text_c(d, W, H * 0.30, "DAILY LOSS", 100 * s, ICE, alpha=a, dy=dy)
        text_c(d, W, H * 0.38, "GUARD", 100 * s, GOLD, alpha=a, dy=dy)
        text_c(d, W, H * 0.54, "Set your own daily limit.", 48 * s, (207, 227, 255), alpha=ease((t - 0.8) / 0.6))
        text_c(d, W, H * 0.60, "The EA stops trading when it is hit.", 48 * s, (207, 227, 255), alpha=ease((t - 1.4) / 0.6))
    elif idx == 4:
        text_c(d, W, H * 0.30, "ON-CHART", 100 * s, ICE, alpha=a, dy=dy)
        text_c(d, W, H * 0.38, "PANEL", 100 * s, BLUE, alpha=a, dy=dy)
        text_c(d, W, H * 0.54, "See what the EA is doing,", 48 * s, (207, 227, 255), alpha=ease((t - 0.8) / 0.6))
        text_c(d, W, H * 0.60, "right on your chart.", 48 * s, (207, 227, 255), alpha=ease((t - 1.4) / 0.6))
    elif idx == 5:
        text_c(d, W, H * 0.16, "HOW IT WORKS", 72 * s, ICE, alpha=a, dy=dy)
        steps = ("Start your demo on the website", "Download the EA", "Paste your licence key", "Attach to US30 on a DEMO account")
        for i, st in enumerate(steps):
            ai = ease((t - 0.5 - 0.9 * i) / 0.6)
            y = H * (0.32 + 0.13 * i) + (1 - ai) * 30 * s
            d.ellipse((W * 0.5 - 380 * s - 34 * s if W < H else W * 0.5 - 520 * s, y - 34 * s, (W * 0.5 - 380 * s + 34 * s) if W < H else W * 0.5 - 520 * s + 68 * s, y + 34 * s), fill=GOLD + (int(255 * ai),))
            cx_circle = (W * 0.5 - 380 * s) if W < H else (W * 0.5 - 520 * s + 34 * s)
            d.text((cx_circle, y), str(i + 1), font=font(40 * s), fill=DARK + (int(255 * ai),), anchor="mm")
            d.text((cx_circle + 70 * s, y), st, font=font(40 * s), fill=ICE + (int(255 * ai),), anchor="lm")
    elif idx == 6:
        text_c(d, W, H * 0.22, "FREE 30-DAY DEMO", 88 * s, GOLD, alpha=a, dy=dy)
        text_c(d, W, H * 0.34, "XXX US30", 150 * s, ICE, alpha=ease((t - 0.4) / 0.6))
        pill_c(d, W, H * 0.52, "algotraders24.ai/demo", 56 * s, GOLD, DARK, alpha=ease((t - 1.0) / 0.6))
        text_c(d, W, H * 0.64, "Demo accounts only", 40 * s, BLUE, alpha=ease((t - 1.6) / 0.6))
    # risk line on every scene
    for i, line in enumerate(RISK):
        text_c(d, W, H - (70 - 30 * i) * s, line, 20 * s, MUTED, bold=False)
    return L


def render(W, H, name):
    s = W / 1080 if W < H else H / 1080
    bg = background(W, H)
    path = os.path.join(out_dir, name)
    cmd = [FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-t", str(TOTAL), path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    total_frames = int(TOTAL * FPS)
    for fi in range(total_frames):
        sec = fi / FPS
        idx = next(i for i, (a, b) in enumerate(SCENES) if a <= sec < b) if sec < TOTAL else len(SCENES) - 1
        a0, b0 = SCENES[idx]
        layer = scene_layer(W, H, idx, sec - a0, s)
        # fade out at the end of a scene (not the last one)
        left = b0 - sec
        if idx < len(SCENES) - 1 and left < 0.35:
            layer.putalpha(layer.getchannel("A").point(lambda v, k=left / 0.35: int(v * k)))
        frame = Image.alpha_composite(bg, layer).convert("RGB")
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    p.wait()
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


render(1080, 1920, "xxxus30-demo-promo-vertical-1080x1920.mp4")
render(1920, 1080, "xxxus30-demo-promo-landscape-1920x1080.mp4")
