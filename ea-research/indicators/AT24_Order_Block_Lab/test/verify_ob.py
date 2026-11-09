"""Independent check of AT24_OB_Core: order blocks, touch / control bars, reactions and statistics. Usage: python -I verify_ob.py OB_selftest.csv"""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
bars = [tuple(float(x) for x in r[1:5]) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6]), int(r[7]), int(r[8]), int(r[9]), int(r[10])) for r in rows if r[0] == "ob"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
n = len(bars); O = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]
K, TW, LOOK, FRAC = 1.0, 100, 24, 0.5
atr = [0.0] * n; a = 0.0; s = 0.0
for i in range(n):
    tr = H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        s += tr
        if i == 13: a = s / 14; atr[i] = a
    else:
        a = (a * 13 + tr) / 14; atr[i] = a
def react(tb, Lv, sg, thr):
    for u in range(tb, min(n - 1, tb + LOOK) + 1):
        if (C[u] - Lv) * sg >= thr: return 1
        if (C[u] - Lv) * (-sg) >= thr: return -1
    return 0
obs = []; lastj = -10
for j in range(15, n - 3):
    if j - lastj < 3: continue
    if C[j] < O[j]: d = 1
    elif C[j] > O[j]: d = -1
    else: continue
    conf = -1
    for t in range(j + 1, j + 4):
        if atr[t] <= 0: break
        if d == 1 and C[t] - H[j] >= K * atr[t]: conf = t; break
        if d == -1 and L[j] - C[t] >= K * atr[t]: conf = t; break
    if conf < 0: continue
    lastj = j
    Lv = H[j] if d == 1 else L[j]; sg = 1.0 if d == 1 else -1.0; thr = FRAC * atr[conf]
    touch = ctrl = -1
    for u in range(conf + 1, min(n - 1, conf + TW) + 1):
        if (d == 1 and L[u] <= Lv) or (d == -1 and H[u] >= Lv): touch = u; break
    res = react(touch, Lv, sg, thr) if touch >= 0 else 0
    mir = 2 * C[conf] - Lv
    for u in range(conf + 1, min(n - 1, conf + TW) + 1):
        if (d == 1 and H[u] >= mir) or (d == -1 and L[u] <= mir): ctrl = u; break
    cres = react(ctrl, mir, -sg, thr) if ctrl >= 0 else 0
    obs.append((j, conf, d, H[j], L[j], atr[conf], touch, ctrl, res, cres))
bad = 0 if len(obs) == len(mt) else 1
for x, y in zip(obs, mt):
    if x[:3] != y[:3] or abs(x[3] - y[3]) > 6e-4 or abs(x[4] - y[4]) > 6e-4 or abs(x[5] - y[5]) > 6e-6 or x[6:] != y[6:]: bad += 1
print("blocks python", len(obs), "mt5", len(mt), "mismatches", bad)
use = [x for x in obs if x[1] + TW + LOOK < n]
cnt = len(use); tch = sum(x[6] >= 0 for x in use); ct = sum(x[7] >= 0 for x in use)
dec = [x for x in use if x[8] != 0]; cdec = [x for x in use if x[9] != 0]
py = [cnt, 100 * tch / cnt, 100 * ct / cnt, 100 * sum(x[8] == 1 for x in dec) / len(dec), 100 * sum(x[9] == 1 for x in cdec) / len(cdec), len(dec), len(cdec)]
ok = bad == 0 and all(abs(x - y) < 1e-4 for x, y in zip(py, mst))
print("stats python", [round(x, 2) for x in py]); print("stats mt5   ", [round(x, 2) for x in mst])
print("RESULT", "PASS" if ok else "FAIL")
