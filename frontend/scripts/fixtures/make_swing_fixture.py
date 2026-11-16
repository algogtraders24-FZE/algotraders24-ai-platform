"""Builds scripts/fixtures/swing-lab-fixture.json: real BTCUSDT and ETHUSDT daily (401) and 4-hour (221) klines from the public Binance
market-data host, plus the expected swing-map values computed here, independently of the TypeScript code.
Run: python make_swing_fixture.py <out.json> (internet needed once)."""
import json, sys, time, urllib.request
import numpy as np

H = "https://data-api.binance.vision"
DAY = 86_400_000


def get(p):
    with urllib.request.urlopen(H + p, timeout=20) as r:
        return json.loads(r.read())


def closed(rows, now):
    return [[int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4])] for r in rows if int(r[6]) < now]


def trend(bars):
    if len(bars) < 50:
        return None
    c = [b[4] for b in bars]
    cl, f, s = c[-1], sum(c[-20:]) / 20, sum(c[-50:]) / 50
    return "up" if cl > f > s else "down" if cl < f < s else "mixed"


def weekly(daily):
    g = {}
    for b in daily:
        g.setdefault((b[0] + 3 * DAY) // (7 * DAY), []).append(b)
    out = []
    for k in sorted(g):
        w = g[k]
        if len(w) != 7:
            continue
        out.append([w[0][0], w[0][1], max(x[2] for x in w), min(x[3] for x in w), w[-1][4]])
    return out


def expected(daily_rows, h4_rows, now):
    d, h4 = closed(daily_rows, now), closed(h4_rows, now)
    price = h4[-1][4]
    tr = []
    for i in range(len(d) - 14, len(d)):
        pc = d[i - 1][4]
        tr.append(max(d[i][2] - d[i][3], abs(d[i][2] - pc), abs(d[i][3] - pc)))
    atr = sum(tr) / 14
    wk = weekly(d)
    w1, d1, t4 = trend(wk), trend(d), trend(h4)
    al = "aligned up" if (w1, d1, t4) == ("up", "up", "up") else "aligned down" if (w1, d1, t4) == ("down", "down", "down") else "mixed"
    cands = []
    n = len(d)
    for i in range(max(5, n - 180), n - 5):
        if all(d[i][2] > d[i - k][2] and d[i][2] > d[i + k][2] for k in range(1, 6)):
            cands.append((d[i][2], "daily swing high"))
        if all(d[i][3] < d[i - k][3] and d[i][3] < d[i + k][3] for k in range(1, 6)):
            cands.append((d[i][3], "daily swing low"))
    cands += [(wk[-1][2], "previous week high"), (wk[-1][3], "previous week low")]
    cands += [(max(b[2] for b in d[-20:]), "20-day high"), (min(b[3] for b in d[-20:]), "20-day low")]
    up = None
    dn = None
    for p, s in cands:
        if p > price and (up is None or p < up[0]):
            up = (p, s)
        if p < price and (dn is None or p > dn[0]):
            dn = (p, s)
    lo50, hi50 = min(b[3] for b in d[-50:]), max(b[2] for b in d[-50:])
    lv = lambda x: None if x is None else {"price": x[0], "pct": 100 * (x[0] - price) / price, "atr": (x[0] - price) / atr, "source": x[1]}
    return {"price": price, "atr": atr, "atrPct": 100 * atr / price, "w1": w1, "d1": d1, "h4": t4, "alignment": al, "weeks": len(wk),
            "resistance": lv(up), "support": lv(dn), "rangePos": 100 * (price - lo50) / (hi50 - lo50), "candidates": len(cands)}


out = {"symbols": {}, "expected": {}}
now = int(time.time() * 1000)
out["nowMs"] = now
for s in ("BTCUSDT", "ETHUSDT"):
    d = get(f"/api/v3/klines?symbol={s}&interval=1d&limit=401")
    h = get(f"/api/v3/klines?symbol={s}&interval=4h&limit=221")
    out["symbols"][s] = {"daily": d, "h4": h}
    out["expected"][s] = expected(d, h, now)
json.dump(out, open(sys.argv[1], "w"))
for s, e in out["expected"].items():
    print(s, {k: (round(v, 4) if isinstance(v, float) else v) for k, v in e.items() if k not in ("resistance", "support")})
    print("  res", e["resistance"], "\n  sup", e["support"])
