"""Independent check of AT24_WG_Core: weekend gaps, fill/control bars and statistics. Usage: python -I verify_wg.py WG_selftest.csv"""
import csv, sys, statistics
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), int(r[6]), int(r[7])) for r in rows if r[0] == "gap"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
n = len(bars); T = [b[0] for b in bars]; O = [b[1] for b in bars]; H = [b[2] for b in bars]; L = [b[3] for b in bars]; C = [b[4] for b in bars]
atr = [0.0] * n; a = 0.0; s = 0.0
for i in range(n):
    tr = H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        s += tr
        if i == 13: a = s / 14; atr[i] = a
    else:
        a = (a * 13 + tr) / 14; atr[i] = a
gaps = []
for i in range(15, n):
    if T[i] - T[i - 1] <= 12 * 3600: continue
    size = O[i] - C[i - 1]
    if atr[i - 1] <= 0 or abs(size) < 0.1 * atr[i - 1]: continue
    fb = cb = -1; mirror = O[i] + size
    for j in range(i, n):
        if fb < 0 and ((size > 0 and L[j] <= C[i - 1]) or (size < 0 and H[j] >= C[i - 1])): fb = j
        if cb < 0 and ((size > 0 and H[j] >= mirror) or (size < 0 and L[j] <= mirror)): cb = j
        if fb >= 0 and cb >= 0: break
    gaps.append((i, C[i - 1], O[i], size, atr[i - 1], fb, cb))
bad = 0 if len(gaps) == len(mt) else 1
for g, m in zip(gaps, mt):
    if g[0] != m[0] or abs(g[1] - m[1]) > 6e-4 or abs(g[3] - m[3]) > 6e-4 or abs(g[4] - m[4]) > 6e-6 or g[5] != m[5] or g[6] != m[6]: bad += 1
print("gaps python", len(gaps), "mt5", len(mt), "mismatches", bad)
W = [1, 4, 24, 120]; maxw = max(W)
use = [g for g in gaps if g[0] + maxw < n]
py = [len(use), 100 * sum(g[3] > 0 for g in use) / len(use), statistics.median(abs(g[3]) / g[4] for g in use)]
for w in W:
    py.append(100 * sum(1 for g in use if g[5] >= 0 and g[5] - g[0] < w) / len(use))
    py.append(100 * sum(1 for g in use if g[6] >= 0 and g[6] - g[0] < w) / len(use))
ok = bad == 0 and all(abs(x - y) < 1e-4 for x, y in zip(py, mst))
print("stats python", [round(x, 2) for x in py]); print("stats mt5   ", [round(x, 2) for x in mst])
print("RESULT", "PASS" if ok else "FAIL")
