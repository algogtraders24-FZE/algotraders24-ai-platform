"""Icon (400x400) and banner (1280x720) for the Universal EA listing. The banner plots the REAL reconstructed M15 equity curve of the
evidence package (not a smoothed or edited picture) and states the key risk numbers next to the profit.  python build_universalea_branding.py"""
import json
import os
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "branding", "universalea")
os.makedirs(OUT, exist_ok=True)
EV = os.path.join(HERE, "..", "m2-evidence-engine", "real_evidence_output", "evidence_UNIVERSALEA-v7.03-2025-2026-BASELINE_2c2af19b5b33236e_with_curve.json")
NAVY = (12, 22, 40); GOLD = (232, 184, 74); WHITE = (240, 240, 240); GREEN = (45, 200, 100); RED = (239, 83, 80); GREY = (150, 150, 160)
S = 4


def fnt(sz, bold=True):
    for n in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(n, sz)
        except Exception:
            pass
    return ImageFont.load_default()


# ---- icon: a straddle (BUY STOP above, SELL STOP below the price) around a U
im = Image.new("RGB", (400 * S, 400 * S), (10, 12, 18))
d = ImageDraw.Draw(im)
d.rounded_rectangle([12 * S, 12 * S, 388 * S, 388 * S], radius=70 * S, fill=NAVY, outline=GOLD, width=8 * S)
d.line([(70 * S, 125 * S), (330 * S, 125 * S)], fill=GREEN, width=5 * S)
d.line([(70 * S, 275 * S), (330 * S, 275 * S)], fill=RED, width=5 * S)
d.line([(70 * S, 200 * S), (330 * S, 200 * S)], fill=GREY, width=3 * S)
d.polygon([(200 * S, 70 * S), (235 * S, 115 * S), (165 * S, 115 * S)], fill=GREEN)
d.polygon([(200 * S, 330 * S), (235 * S, 285 * S), (165 * S, 285 * S)], fill=RED)
fu = ImageFont.truetype("segoeuib.ttf", 120 * S) if os.path.exists(r"C:\Windows\Fonts\segoeuib.ttf") else fnt(120 * S)
d.text((200 * S, 200 * S), "U", font=fu, fill=GOLD, anchor="mm")
icon = im.resize((400, 400), Image.LANCZOS)
icon.save(os.path.join(OUT, "icon.png"))

# ---- banner
e = json.load(open(EV, encoding="utf-8"))["evidence"]
pts = e["curves"]["equity"]
xs = [datetime.fromisoformat(p[0]) for p in pts]
ys = [p[1] for p in pts]
fig, ax = plt.subplots(figsize=(8.6, 3.6), dpi=150)
fig.patch.set_facecolor("#0A0C12"); ax.set_facecolor("#0A0C12")
ax.plot(xs, ys, color="#E8B84A", linewidth=1.1)
ax.axhline(1000, color="#6b7280", linewidth=0.8, linestyle="--")
ax.tick_params(colors="#9ca3af", labelsize=8)
for sp in ax.spines.values():
    sp.set_color("#374151")
ax.set_ylabel("equity (USD)", color="#9ca3af", fontsize=8)
ax.set_title("Strategy Tester equity, real M15 path (1,000 USD start, fixed 0.05 lot)", color="#e5e7eb", fontsize=9)
fig.tight_layout()
chart = os.path.join(OUT, "_equity.png")
fig.savefig(chart, facecolor=fig.get_facecolor())
plt.close(fig)

b = Image.new("RGB", (1280, 720), (10, 12, 18))
dd = ImageDraw.Draw(b)
dd.rectangle([0, 0, 1280, 6], fill=GOLD)
b.paste(icon.resize((110, 110)), (30, 24))
dd.text((160, 28), "AT24 UNIVERSAL EA", font=fnt(46), fill=GOLD)
dd.text((160, 88), "XAUUSD M5 pending-stop breakout  |  validated backtest evidence  |  MetaTrader 5", font=fnt(22, False), fill=(200, 205, 215))
c = Image.open(chart).convert("RGB")
c = c.resize((860, int(c.height * 860 / c.width)))
b.paste(c, (30, 160))
x0 = 920
stats = [("Net profit (test)", "+9,358 USD", GREEN), ("Profit factor", "1.33", WHITE), ("Trades", "2,639", WHITE),
         ("Win rate", "57%", WHITE), ("Max equity drawdown", "about 71%", RED)]
y = 170
for lab, val, col in stats:
    dd.text((x0, y), lab, font=fnt(18, False), fill=GREY)
    dd.text((x0, y + 24), val, font=fnt(32), fill=col)
    y += 82
dd.text((30, 585), "Real Strategy Tester report (ICMarketsSC-Demo, real ticks, 2025-09 to 2026-10), recomputed and checked by AT24.", font=fnt(20, False), fill=(235, 235, 235))
dd.text((30, 616), "High-risk test settings (0.05 lot on 1,000 USD). 2025 was weak, 2026 strong. Backtest, not live results.", font=fnt(20, False), fill=(235, 235, 235))
dd.text((30, 676), "algotraders24.ai", font=fnt(18, False), fill=GREY)
b.save(os.path.join(OUT, "banner.png"))
os.remove(chart)
print("written", OUT)
