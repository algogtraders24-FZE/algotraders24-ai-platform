# Needs ev.json (the with_curve evidence package) and badge512.png (branding/ustech-final/icon-512.png) next to this script. Usage: python -I build_ustechsniper_profit_banner.py <out_dir>
"""USTECH Index Sniper 'profit' promo banners from the REAL tester trade list (balance after each closed trade). Labelled as a backtest."""
import datetime as dt
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker as mt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from PIL import Image  # noqa: E402

SP = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
d = json.load(open(os.path.join(SP, "ev.json")))
trades = sorted(d["trades"], key=lambda t: t["timestamp"])

for f in ("segoeui.ttf", "segoeuib.ttf", "seguisb.ttf"):
    font_manager.fontManager.addfont(os.path.join(r"C:\Windows\Fonts", f))
plt.rcParams["font.family"] = "Segoe UI"
BG, PANEL, BLUE, ICE, MUTED, GREEN = "#060a14", "#0b1424", "#409cff", "#dceaff", "#7f93b3", "#5fd08a"

xs, ys, bal = [], [], 100000.0
for t in trades:
    bal += t["profit"]
    xs.append(dt.datetime.strptime(t["timestamp"], "%Y.%m.%d %H:%M:%S"))
    ys.append(bal)
final = ys[-1]
from PIL import ImageDraw  # noqa: E402
badge = Image.open(os.path.join(SP, "badge512.png")).convert("RGBA")
_m = Image.new("L", badge.size, 0)
ImageDraw.Draw(_m).ellipse((0, 0, badge.size[0] - 1, badge.size[1] - 1), fill=255)
badge.putalpha(_m)


def make(size, name, wide):
    W, H = size
    fig = plt.figure(figsize=(W / 100, H / 100), dpi=100, facecolor=BG)
    # soft radial glow behind the chart (smooth gradient)
    gx = fig.add_axes([0, 0, 1, 1]); gx.set_axis_off()
    import numpy as np
    yy, xx = np.mgrid[0:H, 0:W]
    cx, cy = (0.72 * W, 0.45 * H)
    r = np.sqrt(((xx - cx) / (0.55 * W)) ** 2 + ((yy - cy) / (0.9 * H)) ** 2)
    a = np.clip(1 - r, 0, 1) ** 2 * 0.22
    rgba = np.zeros((H, W, 4)); rgba[..., 0] = 0.25; rgba[..., 1] = 0.61; rgba[..., 2] = 1.0; rgba[..., 3] = a
    gx.imshow(rgba, extent=[0, 1, 0, 1], aspect="auto", zorder=0)
    # chart
    if wide:
        ax = fig.add_axes([0.47, 0.22, 0.50, 0.58])
    else:
        ax = fig.add_axes([0.07, 0.17, 0.86, 0.34])
    ax.set_facecolor("none")
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(colors=MUTED, labelsize=9 if wide else 11)
    ax.grid(color="#ffffff", alpha=0.05)
    ax.fill_between(xs, ys, 0, step="post", color=BLUE, alpha=0.20)
    ax.step(xs, ys, where="post", color=BLUE, linewidth=2.6, solid_capstyle="round")
    ax.set_ylim(0, max(ys) * 1.08)
    ax.set_xlim(xs[0], xs[-1])
    ax.yaxis.set_major_formatter(mt.FuncFormatter(lambda v, _: "%dM" % (v / 1e6) if v else "0"))
    ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%b %y"))
    ax.xaxis.set_major_locator(matplotlib.dates.MonthLocator(interval=3))
    ax.annotate("%.1fM" % (final / 1e6), (xs[-1], final), xytext=(-8, 14), textcoords="offset points", color=GREEN, fontsize=16 if wide else 20, fontweight="bold", ha="right")
    # badge + title
    if wide:
        bx = fig.add_axes([0.02, 0.56, 0.16, 0.40]); bx.imshow(badge); bx.set_axis_off()
        fig.text(0.195, 0.80, "USTECH", color=ICE, fontsize=36, fontweight="bold", va="center")
        fig.text(0.195, 0.64, "INDEX SNIPER", color=BLUE, fontsize=36, fontweight="bold", va="center")
        fig.text(0.035, 0.44, "Backtest result  |  100,000 USD start", color=MUTED, fontsize=14)
        fig.text(0.035, 0.31, "+%s" % format(round(final - 100000), ","), color=GREEN, fontsize=40, fontweight="bold", va="center")
        fig.text(0.035, 0.215, "USD net profit, Strategy Tester, 2% risk compounding", color=ICE, fontsize=13)
        chips = [("1.76", "profit factor"), ("94.6%", "winning trades"), ("11.5%", "max drawdown"), ("14,893", "trades")]
        x0 = 0.035
        for big, small in chips:
            fig.text(x0, 0.115, big, color=ICE, fontsize=22, fontweight="bold", va="center")
            fig.text(x0, 0.055, small, color=MUTED, fontsize=11, va="center")
            x0 += 0.105
        fig.text(0.47, 0.89, "Balance after each closed trade (real tester trades, Jun 2025 - Sep 2026)", color=MUTED, fontsize=12)
        fig.text(0.975, 0.025, "Strategy Tester backtest, not live results. Profit compounds and came mostly in 2025; 2026 is flat to negative. Past results do not predict future results.",
                 color=MUTED, fontsize=8.5, ha="right")
    else:
        bx = fig.add_axes([0.04, 0.70, 0.19, 0.27]); bx.imshow(badge); bx.set_axis_off()
        fig.text(0.29, 0.88, "USTECH", color=ICE, fontsize=44, fontweight="bold", va="center")
        fig.text(0.29, 0.77, "INDEX SNIPER", color=BLUE, fontsize=44, fontweight="bold", va="center")
        fig.text(0.07, 0.62, "+%s USD" % format(round(final - 100000), ","), color=GREEN, fontsize=40, fontweight="bold", va="center")
        fig.text(0.07, 0.555, "Strategy Tester backtest from 100,000 USD, 2% risk compounding", color=ICE, fontsize=14)
        chips = [("1.76", "profit factor"), ("94.6%", "winning trades"), ("11.5%", "max drawdown"), ("14,893", "trades")]
        x0 = 0.07
        for big, small in chips:
            fig.text(x0, 0.095, big, color=ICE, fontsize=20, fontweight="bold", va="center")
            fig.text(x0, 0.055, small, color=MUTED, fontsize=10, va="center")
            x0 += 0.22
        fig.text(0.5, 0.012, "Backtest, not live results. Profit compounds and came mostly in 2025; 2026 is flat to negative. Past results do not predict future results.", color=MUTED, fontsize=8, ha="center")
    fig.savefig(os.path.join(out_dir, name), facecolor=BG)
    plt.close(fig)
    print("saved", name, size)


make((1600, 500), "profit-banner-1600x500.png", True)
make((1200, 630), "profit-social-1200x630.png", False)
