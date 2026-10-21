# Usage: python -I build_xxxus30_howto_video.py <out_dir>
"""XXX US30 'how to start the free demo' video built from REAL screenshots of the live website (video_src/*.jpg), zoom + click marker + captions. Silent."""
import math
import os
import subprocess
import sys

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

SP = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H, FPS = 1920, 1080, 30
FD = r"C:\Windows\Fonts"
BG1, BG2 = (4, 10, 24), (18, 35, 63)
ICE, BLUE, MUTED, GOLD, DARK = (232, 242, 255), (125, 184, 255), (141, 162, 189), (240, 190, 70), (20, 17, 10)
_fc = {}


def font(size, bold=True):
    k = (int(size), bold)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(os.path.join(FD, "segoeuib.ttf" if bold else "segoeui.ttf"), int(size))
    return _fc[k]


def make_bg():
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x / 64 + y / 64) / 2
            px[x, y] = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3))
    img = small.resize((W, H), Image.BILINEAR)
    ImageDraw.Draw(img).rectangle((4, 4, W - 5, H - 5), outline=BLUE, width=4)
    return img


BG = make_bg()
SRC = {n: Image.open(os.path.join(SP, "video_src", n + ".jpg")).convert("RGB") for n in ("demo", "purchases")}
SW, SH = SRC["demo"].size
FX, FY, FW, FH = 72, 48, 1776, 833  # frame area (same aspect as the screenshot)


def ease(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


RISK = "DEMO ACCOUNTS ONLY  -  DEMO RESULTS DO NOT PREDICT LIVE RESULTS  -  TRADING INVOLVES RISK  -  NOT FINANCIAL ADVICE"


def caption(d, txt, num=None):
    f = font(46)
    if num:
        d.ellipse((W / 2 - d.textlength(txt, font=f) / 2 - 90, 925, W / 2 - d.textlength(txt, font=f) / 2 - 20, 995), fill=GOLD)
        d.text((W / 2 - d.textlength(txt, font=f) / 2 - 55, 960), str(num), font=font(44), fill=DARK, anchor="mm")
    d.text((W / 2, 960), txt, font=f, fill=ICE, anchor="mm")
    d.text((W / 2, 1050), RISK, font=font(17, False), fill=MUTED, anchor="mm")


def shot_scene(name, rect, txt, num, t, dur):
    img = BG.copy()
    d = ImageDraw.Draw(img)
    p = t / dur
    z = ease((p - 0.18) / 0.3)
    cx, cy = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
    ww = 760
    wh = ww * SH / SW
    fx0 = min(max(cx - ww / 2, 0), SW - ww)
    fy0 = min(max(cy - wh / 2, 0), SH - wh)
    bx0, by0 = lerp(0, fx0, z), lerp(0, fy0, z)
    bw, bh = lerp(SW, ww, z), lerp(SH, wh, z)
    crop = SRC[name].crop((int(bx0), int(by0), int(bx0 + bw), int(by0 + bh))).resize((FW, FH), Image.BICUBIC)
    img.paste(crop, (FX, FY))
    d.rounded_rectangle((FX - 2, FY - 2, FX + FW + 2, FY + FH + 2), radius=6, outline=BLUE, width=3)

    def mp(x, y):
        return FX + (x - bx0) / bw * FW, FY + (y - by0) / bh * FH

    # pulsing highlight once zoomed
    if p > 0.3:
        pulse = 0.5 + 0.5 * math.sin((t - 0.3 * dur) * 6)
        x0, y0 = mp(rect[0], rect[1])
        x1, y1 = mp(rect[2], rect[3])
        g = 6 + int(5 * pulse)
        d.rounded_rectangle((x0 - g, y0 - g, x1 + g, y1 + g), radius=12, outline=GOLD, width=5)
    # click marker
    if 0.62 < p < 0.85:
        k = (p - 0.62) / 0.23
        x, y = mp(cx, cy)
        r = 20 + 70 * k
        d.ellipse((x - r, y - r, x + r, y + r), outline=(255, 255, 255), width=4)
        d.ellipse((x - 8, y - 8, x + 8, y + 8), fill=(255, 255, 255))
    caption(d, txt, num)
    return img


def card_scene(lines, num, t, dur, title):
    img = BG.copy()
    d = ImageDraw.Draw(img)
    a = ease(t / 0.5)
    d.ellipse((W / 2 - 55, 150, W / 2 + 55, 260), fill=GOLD)
    d.text((W / 2, 205), str(num), font=font(70), fill=DARK, anchor="mm")
    d.text((W / 2, 340 - (1 - a) * 30), title, font=font(76), fill=ICE, anchor="mm")
    for i, (txt, col) in enumerate(lines):
        ai = ease((t - 0.8 - 0.8 * i) / 0.6)
        if ai <= 0:
            continue
        y = 500 + i * 100 + (1 - ai) * 30
        d.rounded_rectangle((W / 2 - 800, y - 40, W / 2 + 800, y + 40), radius=40, fill=(10, 26, 58), outline=BLUE if col == ICE else GOLD, width=2)
        d.text((W / 2, y), txt, font=font(40), fill=col, anchor="mm")
    d.text((W / 2, 1050), RISK, font=font(17, False), fill=MUTED, anchor="mm")
    return img


def title_scene(t, dur):
    img = BG.copy()
    d = ImageDraw.Draw(img)
    a = ease(t / 0.6)
    d.text((W / 2, 300), "ALGOTRADERS24", font=font(48), fill=ICE, anchor="mm")
    d.rounded_rectangle((W / 2 - 320, 400, W / 2 + 320, 480), radius=40, fill=GOLD)
    d.text((W / 2, 440), "FREE  -  30 DAYS", font=font(54), fill=DARK, anchor="mm")
    d.text((W / 2, 620 - (1 - a) * 30), "XXX US30", font=font(190), fill=ICE, anchor="mm")
    d.text((W / 2, 790), "How to start your demo - step by step", font=font(54), fill=(207, 227, 255), anchor="mm")
    d.text((W / 2, 1050), RISK, font=font(17, False), fill=MUTED, anchor="mm")
    return img


def end_scene(t, dur):
    img = BG.copy()
    d = ImageDraw.Draw(img)
    d.text((W / 2, 330), "FREE 30-DAY DEMO", font=font(110), fill=GOLD, anchor="mm")
    d.text((W / 2, 500), "XXX US30", font=font(170), fill=ICE, anchor="mm")
    d.rounded_rectangle((W / 2 - 420, 640, W / 2 + 420, 740), radius=50, fill=GOLD)
    d.text((W / 2, 690), "algotraders24.ai/demo", font=font(64), fill=DARK, anchor="mm")
    d.text((W / 2, 840), "No payment. No card. Demo accounts only.", font=font(48), fill=BLUE, anchor="mm")
    d.text((W / 2, 1050), RISK, font=font(17, False), fill=MUTED, anchor="mm")
    return img


SCENES = [
    (3.5, lambda t, d_: title_scene(t, d_)),
    (7.0, lambda t, d_: shot_scene("demo", (352, 263, 543, 299), "Open algotraders24.ai/demo, log in and press Start", 1, t, d_)),
    (6.0, lambda t, d_: shot_scene("purchases", (282, 259, 427, 294), "Download the demo EA", 2, t, d_)),
    (7.0, lambda t, d_: shot_scene("purchases", (282, 426, 502, 458), "Show your licence key and copy it", 3, t, d_)),
    (7.0, lambda t, d_: card_scene([("Tools > Options > Expert Advisors", ICE), ("Tick: Allow WebRequest for listed URL", ICE), ("Add: https://www.algotraders24.ai", GOLD)], 4, t, d_, "In MetaTrader 5, one-time setting")),
    (7.0, lambda t, d_: card_scene([("Open a US30 chart on a DEMO account", ICE), ("Drag the EA on, paste the key in InpLicenseKey", ICE), ("Start with a small lot", GOLD)], 5, t, d_, "Attach the EA")),
    (5.0, lambda t, d_: end_scene(t, d_)),
]
TOTAL = sum(s[0] for s in SCENES)


def main():
    path = os.path.join(out_dir, "xxxus30-demo-howto-website-1920x1080.mp4")
    cmd = [FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-t", str(TOTAL), path]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    starts, acc = [], 0.0
    for dur, _ in SCENES:
        starts.append(acc)
        acc += dur
    for fi in range(int(TOTAL * FPS)):
        sec = fi / FPS
        idx = max(i for i, s0 in enumerate(starts) if s0 <= sec)
        dur, fn = SCENES[idx]
        t = sec - starts[idx]
        frame = fn(t, dur)
        # soft fade in/out between scenes
        edge = min(t, dur - t)
        if edge < 0.3:
            frame = Image.blend(BG, frame, max(0.0, edge / 0.3))
        p.stdin.write(frame.tobytes())
    p.stdin.close()
    p.wait()
    print("wrote", path, os.path.getsize(path) // 1024, "KB", TOTAL, "s")


main()
