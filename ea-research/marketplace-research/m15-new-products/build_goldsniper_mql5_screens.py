"""Builds the MQL5 Market screenshots (1280x720 PNG) for Gold Sniper from the real trade list (no invented numbers).
Usage: python -I build_goldsniper_mql5_screens.py <out_dir>"""
import collections
import datetime as dt
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
EV = os.path.join(HERE, "..", "m2-evidence-engine", "real_evidence_output",
                  "evidence_GOLDSNIPER-v1.00-2025-2026-RISK2-BASELINE_73b4fd0cdca1b05e.json")
d = json.load(open(EV))
trades = d["trades"]
ms = d["evidence"]["metricsSummary"]

for f in ("segoeui.ttf", "segoeuib.ttf", "seguisb.ttf"):
    font_manager.fontManager.addfont(os.path.join(r"C:\Windows\Fonts", f))
plt.rcParams["font.family"] = "Segoe UI"
BG, PANEL, GOLD, CREAM, MUTED, RED, GREEN = "#08080c", "#14110a", "#f6c744", "#e9dfc4", "#9a8f73", "#ff5a4d", "#5fd08a"
DPI = 100
SIZE = (12.8, 7.2)


def base(title, subtitle):
    fig = plt.figure(figsize=SIZE, dpi=DPI, facecolor=BG)
    fig.text(0.04, 0.925, title, color=GOLD, fontsize=26, fontweight="bold", va="center")
    fig.text(0.04, 0.865, subtitle, color=CREAM, fontsize=13, va="center")
    fig.text(0.04, 0.03, "Gold Sniper v1.00  |  Strategy Tester, Exness XAUUSD, 2025-01 to 2026-10, 2% risk lot (compounding), 100,000 USD deposit  |  Past results do not predict future results",
             color=MUTED, fontsize=9.5)
    return fig


def style(ax):
    ax.set_facecolor(PANEL)
    for s in ax.spines.values():
        s.set_color("#3a3220")
    ax.tick_params(colors=MUTED, labelsize=10)
    ax.grid(color="#ffffff", alpha=0.06)


# ---- 1: balance curve (closed trades; no intraday equity - candle data had gaps) ----
fig = base("Balance curve", "Balance after each of the %d closed trades  |  profit factor %.2f  |  win rate %.1f%%  |  max closed-trade drawdown %.1f%%" % (len(trades), d["evidence"]["reportCrossCheck"]["profitFactor"]["reportValue"], ms["winRate"] * 100, ms["maxDrawdown"]["percent"] * 100))
ax = fig.add_axes([0.07, 0.12, 0.89, 0.70])
style(ax)
tt = sorted(trades, key=lambda x: x["timestamp"])
xs, ys, bal = [], [], 100000.0
for t in tt:
    bal += t["profit"]
    xs.append(dt.datetime.strptime(t["timestamp"], "%Y.%m.%d %H:%M:%S"))
    ys.append(bal)
ax.step(xs, ys, where="post", color=GOLD, linewidth=1.6)
ax.fill_between(xs, ys, min(ys) * 0.9, step="post", color=GOLD, alpha=0.10)
ax.axhline(100000, color=MUTED, linewidth=0.8, linestyle="--")
ax.set_ylim(min(ys) * 0.9, max(ys) * 1.05)
ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: "{:,.0f}".format(v)))
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
ax.set_ylabel("Balance (USD)", color=MUTED)
fig.savefig(os.path.join(out_dir, "01-balance-curve.png"), facecolor=BG)
plt.close(fig)

# ---- 2: monthly profit ----
m = collections.OrderedDict()
for t in sorted(trades, key=lambda x: x["timestamp"]):
    k = t["timestamp"][:7]
    m[k] = m.get(k, 0.0) + t["profit"]
neg = sum(1 for v in m.values() if v < 0)
fig = base("Profit by month", "%d of %d months were losing months  |  results are uneven - see the product description" % (neg, len(m)))
ax = fig.add_axes([0.07, 0.15, 0.89, 0.67])
style(ax)
labels = [dt.datetime.strptime(k, "%Y.%m").strftime("%b %y") for k in m]
ax.bar(range(len(m)), list(m.values()), color=[GREEN if v >= 0 else RED for v in m.values()], width=0.7)
ax.set_xticks(range(len(m)))
ax.set_xticklabels(labels, rotation=60, ha="right")
ax.axhline(0, color=MUTED, linewidth=0.8)
ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: "{:,.0f}".format(v)))
ax.set_ylabel("Net profit (USD)", color=MUTED)
fig.savefig(os.path.join(out_dir, "02-profit-by-month.png"), facecolor=BG)
plt.close(fig)

# ---- 3: how it trades ----
fig = base("How Gold Sniper trades", "One precise pending order at a time on XAUUSD (M1)")
steps = [
    ("1", "Session + spread", "Only inside the London and New York sessions (broker server time) and only when the spread is acceptable."),
    ("2", "M5 trend", "Price must be on the right side of a rising / falling M5 EMA(50)."),
    ("3", "Fair value gap", "A fresh 3-candle M1 fair value gap of at least 8 pips in the same direction."),
    ("4", "One pending order", "A buy-stop / sell-stop just beyond the last 5 M1 bars' high / low (30 points buffer), cancelled after 3 minutes."),
    ("5", "Managed exit", "Fixed stop loss and take profit, break-even and a fixed-distance trailing stop, checked on every tick."),
]
y = 0.75
for n, head, body in steps:
    fig.patches.append(matplotlib.patches.FancyBboxPatch((0.04, y - 0.075), 0.92, 0.11, boxstyle="round,pad=0.005,rounding_size=0.015", transform=fig.transFigure,
                                                          facecolor=PANEL, edgecolor="#3a3220", linewidth=1.2))
    fig.text(0.07, y - 0.02, n, color=BG, fontsize=22, fontweight="bold", ha="center", va="center",
             bbox=dict(boxstyle="circle,pad=0.35", facecolor=GOLD, edgecolor="none"))
    fig.text(0.115, y + 0.012, head, color=GOLD, fontsize=16, fontweight="bold", va="center")
    fig.text(0.115, y - 0.032, body, color=CREAM, fontsize=12, va="center")
    y -= 0.145
fig.savefig(os.path.join(out_dir, "03-how-it-trades.png"), facecolor=BG)
plt.close(fig)

# ---- 4: settings ----
fig = base("Default settings", "These defaults are the exact distances and filters of the tested run")
rows = [
    ("Stop loss", "5000 pips = 50.00 USD price move"), ("Take profit", "11000 pips = 110.00 USD price move"),
    ("Break-even trigger / lock", "100 / 20 points (points mode)"), ("Trailing stop / step", "fixed 10 pips behind price / 20 points"),
    ("Trend filter", "M5 EMA(50)"), ("Fair value gap minimum", "8 pips"),
    ("Entry", "Buy-stop / sell-stop beyond last 5 M1 bars, 30 points buffer, expires in 3 min"),
    ("Sessions (server time)", "London 7-16, New York 12-21"), ("Optional CVD / regime / order-flow filters", "OFF (as tested)"),
    ("Lot size", "Risk-based, 0.5% per trade by default (test used 2%) - choose your own"),
]
y = 0.77
for k, v in rows:
    fig.text(0.06, y, k, color=GOLD, fontsize=14, fontweight="bold", va="center")
    fig.text(0.40, y, v, color=CREAM, fontsize=14, va="center")
    fig.add_artist(matplotlib.lines.Line2D([0.05, 0.95], [y - 0.03, y - 0.03], transform=fig.transFigure, color="#3a3220", linewidth=0.8))
    y -= 0.07
fig.savefig(os.path.join(out_dir, "04-default-settings.png"), facecolor=BG)
plt.close(fig)
print("screenshots written to", out_dir)
