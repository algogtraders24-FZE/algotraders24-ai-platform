"""Independent check of AT24_CL_Core: pattern flags per bar and follow-through statistics.
Usage: python -I verify_cl.py CL_selftest.csv"""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
n, H = int(meta[1]), int(meta[2])
bars = [(float(r[1]), float(r[2]), float(r[3]), float(r[4]), int(r[5])) for r in rows if r[0] == "bar"]
O = [b[0] for b in bars]; Hh = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]
mt = {r[1]: [float(x) for x in r[2:]] for r in rows if r[0] == "stat"}
atr = [0.0] * n; a = 0.0; s = 0.0
for i in range(n):
    tr = Hh[i] - L[i] if i == 0 else max(Hh[i] - L[i], abs(Hh[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        s += tr
        if i == 13: a = s / 14; atr[i] = a
    else:
        a = (a * 13 + tr) / 14; atr[i] = a
fl = [0] * n
for i in range(1, n):
    rg = Hh[i] - L[i]
    if atr[i] <= 0 or rg < 0.5 * atr[i] or rg <= 0: continue
    body, pbody = abs(C[i] - O[i]), abs(C[i - 1] - O[i - 1])
    up, dn, pup, pdn = C[i] > O[i], C[i] < O[i], C[i - 1] > O[i - 1], C[i - 1] < O[i - 1]
    if up and pdn and O[i] <= C[i - 1] and C[i] >= O[i - 1] and body > pbody: fl[i] |= 1
    if dn and pup and O[i] >= C[i - 1] and C[i] <= O[i - 1] and body > pbody: fl[i] |= 2
    lower, upper = min(O[i], C[i]) - L[i], Hh[i] - max(O[i], C[i])
    if body <= 0.3 * rg and lower >= 0.6 * rg: fl[i] |= 4
    if body <= 0.3 * rg and upper >= 0.6 * rg: fl[i] |= 8
bad = sum(1 for i in range(n) if fl[i] != bars[i][4])
print("pattern flags: bars", n, "mismatches", bad)
tot = n - H; up_all = sum(1 for i in range(tot) if C[i + H] > C[i]); base_up = 100 * up_all / tot
names = ["bull_engulf", "bear_engulf", "bull_pin", "bear_pin"]
ok_all = bad == 0
for k, nm in enumerate(names):
    bull = k % 2 == 0
    cnt = hit = 0; mv = 0.0
    for i in range(1, n - H):
        if fl[i] & (1 << k):
            d = C[i + H] - C[i]; cnt += 1
            if (d > 0) if bull else (d < 0): hit += 1
            mv += d if bull else -d
    py = [cnt, 100 * hit / cnt if cnt else 0.0, base_up if bull else 100 - base_up, mv / cnt if cnt else 0.0]
    ok = all(abs(x - y) < 1e-4 for x, y in zip(py, mt[nm]))
    ok_all &= ok
    print(f"{nm:12s} n={py[0]:4d} hit {py[1]:5.1f}% base {py[2]:5.1f}% meanMove {py[3]:7.3f}  mt5 n={mt[nm][0]:.0f} hit {mt[nm][1]:.1f}  {'ok' if ok else 'DIFF'}")
print("RESULT", "PASS" if ok_all else "FAIL")
