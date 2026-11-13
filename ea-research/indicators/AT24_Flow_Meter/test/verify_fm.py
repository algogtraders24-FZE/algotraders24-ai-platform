"""Independent check of AT24_FM_Core: REAL (aggressor-flagged) and TICK-RULE per-minute delta on real Binance trades, the bar-shape proxy and the daily-restart cumulative delta on real XAUUSD H1 bars.
Also reports how well the tick rule tracks the true delta on this trade sample.
Usage: python -I verify_fm.py FM_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; nt, t0, nb = int(meta[1]), int(meta[2]), int(meta[3])
ticks = [(int(r[1]), float(r[2]), float(r[3]), int(r[4])) for r in rows if r[0] == "tick"]
real_ref = {int(r[1]): (float(r[2]), int(r[3]), float(r[4]), int(r[5])) for r in rows if r[0] == "real"}
dr = [0.0] * nb; cr = [0] * nb; dt = [0.0] * nb; ct = [0] * nb
prev = None; d = 1
for ts, p, q, fl in ticks:
    off = ts - t0
    if off < 0:
        if prev is not None:
            if p > prev: d = 1
            elif p < prev: d = -1
        prev = p; continue
    b = off // 60; w = q if q > 0 else 1.0
    if b < nb:
        if fl & 1: dr[b] += w; cr[b] += 1
        elif fl & 2: dr[b] -= w; cr[b] += 1
    if prev is not None:
        if p > prev: d = 1
        elif p < prev: d = -1
    prev = p
    if b < nb: dt[b] += d * w; ct[b] += 1
ok_ticks = all(abs(real_ref[b][0] - dr[b]) < 1e-5 and real_ref[b][1] == cr[b] and abs(real_ref[b][2] - dt[b]) < 1e-5 and real_ref[b][3] == ct[b] for b in range(nb))
bars = [r for r in rows if r[0] == "bar"]
ok_bar = True; run = 0.0; day = None
for r in bars:
    t = int(r[1]); o, h, l, c = (float(x) for x in r[2:6]); tv = int(r[6]); dp_ref, cum_ref = float(r[7]), float(r[8])
    dp = tv * (c - o) / (h - l) if h > l else 0.0
    dd = t // 86400
    if dd != day: day = dd; run = 0.0
    run += dp
    if abs(dp - dp_ref) > 1e-4 * max(1, abs(dp)) or abs(run - cum_ref) > 1e-4 * max(1, abs(run)): ok_bar = False; break
def corr(x, y):
    n = len(x); mx, my = sum(x) / n, sum(y) / n; sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y); sxy = sum((a - mx) * (b - my) for a, b in zip(x, y)); return sxy / math.sqrt(sxx * syy)
print(f"trades {nt}, minutes {nb}: REAL + TICK-RULE per-minute delta and tick counts {'identical to MT5' if ok_ticks else 'DIFF'}")
print(f"XAUUSD H1 bars {len(bars)}: bar proxy and daily-restart cumulative delta {'identical to MT5' if ok_bar else 'DIFF'}")
print(f"on this trade sample the tick rule tracks the true delta: correlation {corr(dr, dt):.3f}, same sign {sum(1 for a, b in zip(dr, dt) if a * b > 0) / nb:.0%} of minutes")
print("RESULT", "PASS" if ok_ticks and ok_bar else "FAIL")
