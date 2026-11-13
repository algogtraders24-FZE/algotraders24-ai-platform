"""Independent check of AT24_EM_Core: the 60-minute move after each past release, the baseline window range and the grouping by release name.
The event list (time in the bar clock, name) comes from the terminal's calendar dump; everything else is recomputed here from the bars.
Usage: python -I verify_em.py EM_selftest.csv"""
import csv, sys, bisect
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n, m, base_ref, ng = int(meta[1]), int(meta[2]), float(meta[3]), int(meta[4])
bars = [(int(r[1]), *[float(x) for x in r[2:6]]) for r in rows if r[0] == "bar"]
T = [b[0] for b in bars]; O = [b[1] for b in bars]; H = [b[2] for b in bars]; L = [b[3] for b in bars]; C = [b[4] for b in bars]
atr = [0.0] * n
for i in range(n):
    tr = H[0] - L[0] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    atr[i] = tr if i == 0 else ((atr[i - 1] * i + tr) / (i + 1) if i < 14 else (atr[i - 1] * 13 + tr) / 14)
WB, BAR = 4, 900
def measure(ev):
    start = ev // BAR * BAR
    i0 = bisect.bisect_left(T, start)
    if i0 < 1 or i0 + WB - 1 > n - 1: return None
    if T[i0] - start > BAR: return None
    hh = max(H[i0:i0 + WB]); ll = min(L[i0:i0 + WB]); a = atr[i0 - 1]
    if a <= 0 or O[i0] <= 0: return None
    return 1e4 * (C[i0 + WB - 1] / O[i0] - 1), 1e4 * (hh - ll) / O[i0], (hh - ll) / a
evs = [(int(r[1]), r[2], int(r[3]), float(r[4]), float(r[5]), float(r[6])) for r in rows if r[0] == "ev"]
bad = 0; groups = {}; order = []
for t, name, ok, mv, rg, ra in evs:
    py = measure(t)
    same = (py is None and ok == 0) or (py is not None and ok == 1 and abs(py[0] - mv) < 1e-4 and abs(py[1] - rg) < 1e-4 and abs(py[2] - ra) < 1e-5)
    if not same: bad += 1
    if py is not None:
        if name not in groups: groups[name] = []; order.append(name)
        groups[name].append(py)
s = 0.0; c = 0
for i in range(15, n - WB + 1, WB):
    if atr[i - 1] <= 0: continue
    s += (max(H[i:i + WB]) - min(L[i:i + WB])) / atr[i - 1]; c += 1
base = s / c
base_ok = abs(base - base_ref) < 1e-6
stats = [r for r in rows if r[0] == "stat"]
gok = len(stats) == len(order) and base_ok
for (r, name) in zip(stats, order):
    g = groups[name]; k = len(g)
    mine = (k, sum(abs(x[0]) for x in g) / k, sum(x[1] for x in g) / k, (sum(x[2] for x in g) / k) / base, max(x[1] for x in g))
    ref = (int(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[6]))
    if r[1] != name or not all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(mine, ref)): gok = False
print(f"bars {n}, calendar events (high importance) {m}, measured {sum(1 for e in evs if e[2] == 1)}, per-event measurements differing: {bad}")
print(f"baseline window range {base:.3f} ATR ({'identical' if base_ok else 'DIFF'}), groups {len(order)} (MT5 {ng}) -> {'identical' if gok else 'DIFF'}")
for r in sorted(stats, key=lambda r: -float(r[4]))[:5]: print(f"  {r[1]}: n {r[2]}, mean |move| {float(r[3]):.1f} bp, mean range {float(r[4]):.1f} bp, {float(r[5]):.2f}x normal")
print("RESULT", "PASS" if bad == 0 and gok else "FAIL")
