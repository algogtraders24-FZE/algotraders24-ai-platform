"""Independent check of AT24_TA_Core: per-trade MFE / MAE / move / post-exit move / R and the summary statistics.
Usage: python -I verify_ta.py TA_selftest.csv"""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; period, post_bars = int(meta[2]), int(meta[3])
bars = [(int(r[1]), float(r[2]), float(r[3])) for r in rows if r[0] == "bar"]
T = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; n = len(bars)
trades = [r for r in rows if r[0] == "trade"]
import bisect
def one(d, tin, tout, pin, pout, sl):
    s0, s1 = tin // period * period, tout // period * period
    i0 = bisect.bisect_left(T, s0); i1 = bisect.bisect_right(T, s1) - 1
    if i0 >= n or i1 < i0: return None
    fav = adv = 0.0
    for i in range(i0, i1 + 1):
        f = H[i] - pin if d > 0 else pin - L[i]; a = pin - L[i] if d > 0 else H[i] - pin
        fav = max(fav, f); adv = max(adv, a)
    move = d * (pout - pin); mfe = max(fav, move, 0.0); mae = max(adv, -move, 0.0)
    e = min(n - 1, i1 + post_bars)
    if i1 + 1 <= e: post = max((H[i] - pin if d > 0 else pin - L[i]) for i in range(i1 + 1, e + 1))
    else: post = move
    r = move / abs(pin - sl) if sl > 0 and abs(pin - sl) > 0 else 0.0
    return move, mfe, mae, post, r
bad = 0; res = []
for r in trades:
    d, tin, tout = int(r[1]), int(r[2]), int(r[3]); pin, pout, sl = float(r[4]), float(r[5]), float(r[6])
    py = one(d, tin, tout, pin, pout, sl); ref = [float(x) for x in r[8:13]] if r[7] == "1" else None
    ok = (py is None and ref is None) or (py is not None and ref is not None and all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(py, ref)))
    bad += 0 if ok else 1
    res.append((d, sl, py))
good = [(d, sl, p) for d, sl, p in res if p is not None]
win = [p for d, sl, p in good if p[0] > 0]; lose = [p for d, sl, p in good if p[0] < 0]
cap = sum(p[0] / p[1] for p in win if p[1] > 0) / len(win) if win else 0
gbden = [p for d, sl, p in good if p[1] > 0]; gb = 100 * sum(1 for p in gbden if p[0] < 0.5 * p[1]) / len(gbden) if gbden else 0
early = 100 * sum(1 for p in win if p[3] - p[0] >= p[0]) / len(win) if win else 0
rec = 100 * sum(1 for p in lose if p[3] >= 0) / len(lose) if lose else 0
mae = 100 * sum(p[2] / p[1] for p in win if p[1] > 0) / sum(1 for p in win if p[1] > 0) if win else 0
rs = [p[4] for d, sl, p in good if sl > 0 and p[4] != 0]; avgr = sum(rs) / len(rs) if rs else 0
sm = [r for r in rows if r[0] == "sum"][0]; ref = [float(x) for x in sm[1:]]
py = [len(good), len(win), len(lose), cap, gb, early, rec, mae, avgr, len(rs)]
oks = all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(py, ref))
print(f"per-trade rows differing: {bad} of {len(trades)}")
print(f"summary: n {py[0]} winners {py[1]} losers {py[2]} capture {py[3]:.3f} give-back {py[4]:.1f}% early {py[5]:.1f}% recover {py[6]:.1f}% winner heat {py[7]:.1f}% avgR {py[8]:.3f}  -> {'identical to MT5' if oks else 'DIFF ' + str(ref)}")
print("RESULT", "PASS" if bad == 0 and oks else "FAIL")
