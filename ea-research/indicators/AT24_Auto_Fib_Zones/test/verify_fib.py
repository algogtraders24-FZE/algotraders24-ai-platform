"""Independent check of AT24_Fib_Core: swings + pullback statistics from the dumped bars.
Usage: python verify_fib.py Fib_selftest.csv [k]"""
import csv, sys, statistics

rows = list(csv.reader(open(sys.argv[1])))
k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
hi, lo = [], []
for r in rows:
    if r[0] == "bar": hi.append(float(r[2])); lo.append(float(r[3]))
# swings: sw,idx,conf,price,dir
mt5_sw = [(int(r[1]), int(r[2]), float(r[3]), int(r[4])) for r in rows if r[0] == "sw"]
mt5_stats = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]

n = len(hi)
sw = []  # [idx, conf, price, dir]
for i in range(k, n - k):
    win = range(i - k, i + k + 1)
    is_h = all(hi[j] < hi[i] for j in win if j != i)
    is_l = all(lo[j] > lo[i] for j in win if j != i)
    for d, ok, pr in ((1, is_h, hi[i]), (-1, is_l, lo[i])):
        if not ok: continue
        if sw and sw[-1][3] == d:
            if (d == 1 and pr > sw[-1][2]) or (d == -1 and pr < sw[-1][2]):
                sw[-1] = [i, i + k, pr, d]
            continue
        sw.append([i, i + k, pr, d])

bad = 0
if len(sw) != len(mt5_sw): bad += 1; print("swing count", len(sw), len(mt5_sw))
for a, b in zip(sw, mt5_sw):
    if a[0] != b[0] or a[1] != b[1] or a[3] != b[3] or abs(a[2] - b[2]) > 0.0006: bad += 1
print("swings python", len(sw), "mt5", len(mt5_sw), "mismatches", bad)

dep, r, beyond, res, sh, shres = [], [0] * 5, 0, 0, 0, 0
lv = [0.236, 0.382, 0.5, 0.618, 0.786]
for j in range(len(sw) - 3):
    leg = abs(sw[j + 1][2] - sw[j][2])
    if leg <= 0: continue
    d = abs(sw[j + 1][2] - sw[j + 2][2]) / leg
    dep.append(d)
    for q, L in enumerate(lv):
        if d >= L: r[q] += 1
    if d > 1: beyond += 1
    resumed = sw[j + 3][2] > sw[j + 1][2] if sw[j + 1][3] == 1 else sw[j + 3][2] < sw[j + 1][2]
    res += resumed
    if d <= 0.618:
        sh += 1; shres += resumed
c = len(dep)
py = [c, statistics.median(dep)] + [100 * x / c for x in r] + [100 * beyond / c, 100 * res / c, 100 * shres / sh if sh else 0, sh]
names = ["legs", "median", "r236", "r382", "r50", "r618", "r786", "beyond", "resumed", "shallowRes", "shallowN"]
ok = True
for nme, a, b in zip(names, py, mt5_stats):
    diff = abs(a - b)
    tol = 0.0006 if nme == "median" else 0.0006 if nme in ("legs", "shallowN") else 0.0011
    flag = "ok" if diff <= max(tol, 1e-3) else "DIFF"
    if flag == "DIFF": ok = False
    print(f"{nme:11s} python {a:10.4f}  mt5 {b:10.4f}  {flag}")
print("RESULT", "PASS" if ok and bad == 0 else "FAIL")
