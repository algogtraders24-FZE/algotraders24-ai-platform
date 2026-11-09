"""Independent check of AT24_SW_Core: Asian-range sweeps, reversal / continuation trades in R, control and statistics.
Usage: python -I verify_sw.py SW_selftest.csv"""
import csv, sys, math, statistics
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6]), float(r[7]), float(r[8])) for r in rows if r[0] == "ev"]
mst = {int(r[1]): (float(r[2]), float(r[3])) for r in rows if r[0] == "st"}
n = len(bars); G = [b[0] for b in bars]; O = [b[1] for b in bars]; H = [b[2] for b in bars]; L = [b[3] for b in bars]; C = [b[4] for b in bars]
GD = [g // 86400 for g in G]; GH = [(g % 86400) // 3600 for g in G]
COST, EXIT, MAXB = 0.25, 16, 11
def sim(idx, d, stop, risk):
    entry = O[idx + 1]; target = entry + d * risk; res = None
    for j in range(idx + 1, min(idx + 1 + MAXB, n)):
        if GD[j] != GD[idx] or GH[j] >= EXIT: res = (O[j] - entry) * d if j > idx + 1 else 0.0; break
        hs = (L[j] <= stop) if d == 1 else (H[j] >= stop); ht = (H[j] >= target) if d == 1 else (L[j] <= target)
        if hs: res = -risk; break
        if ht: res = risk; break
    if res is None: res = (C[min(idx + MAXB, n - 1)] - entry) * d
    return (res - COST) / risk
ev = []; i = 0
while i < n:
    dk = GD[i]; j = i
    while j < n and GD[j] == dk: j += 1
    asia = [k for k in range(i, j) if GH[k] < 7]; win = [k for k in range(i, j) if 7 <= GH[k] <= 12]
    if len(asia) >= 6 and len(win) >= 4:
        hi = max(H[k] for k in asia); lo = min(L[k] for k in asia); sw = None
        for k in win:
            up = H[k] > hi and C[k] <= hi; dn = L[k] < lo and C[k] >= lo
            if up and dn: break
            if up: sw = (k, -1, H[k]); break
            if dn: sw = (k, 1, L[k]); break
        if sw and sw[0] + 1 < n and GD[sw[0] + 1] == dk:
            k, d, ext = sw; entry = O[k + 1]; risk = abs(entry - ext)
            if risk > 0.5: ev.append((k, dk, d, ext, entry, risk, sim(k, d, ext, risk), sim(k, -d, entry + d * risk, risk)))
    i = j
bad = 0 if len(ev) == len(mt) else 1
for a, b in zip(ev, mt):
    if a[0] != b[0] or a[1] != b[1] or a[2] != b[2] or abs(a[3] - b[3]) > 6e-4 or abs(a[4] - b[4]) > 6e-4 or abs(a[5] - b[5]) > 6e-5 or abs(a[6] - b[6]) > 1e-6 or abs(a[7] - b[7]) > 1e-6: bad += 1
print("events python", len(ev), "mt5", len(mt), "mismatches", bad)
def stats_(es):
    m = len(es); r = [e[6] for e in es]; c = [e[7] for e in es]; d = [(x - y) / 2 for x, y in zip(r, c)]
    def tt(v): s = statistics.stdev(v); return statistics.mean(v) / (s / math.sqrt(len(v))) if s > 0 else 0.0
    return [m, statistics.mean(r), tt(r), 100 * sum(x > 0 for x in r) / m, statistics.mean(c), tt(c), 100 * sum(x > 0 for x in c) / m, (statistics.mean(r) + statistics.mean(c)) / 2, statistics.mean(d), tt(d), statistics.median(e[5] for e in es)]
ok = bad == 0
for lab, es, col in (("all events", ev, 0), ("last 250", ev[max(0, len(ev) - 250):], 1)):
    py = stats_(es)
    for z in range(11):
        if abs(py[z] - mst[z][col]) > 2e-4 * max(1, abs(py[z])): ok = False; print("DIFF", lab, z, py[z], mst[z][col])
    print(f"{lab}: n={py[0]}  reversal {py[1]:+.4f} R (t {py[2]:+.2f}, hit {py[3]:.1f}%)  continuation {py[4]:+.4f} R  control {py[7]:+.4f} R  reversal-control {py[8]:+.4f} R (t {py[9]:+.2f})  median risk {py[10]:.2f}")
print("RESULT", "PASS" if ok else "FAIL")
