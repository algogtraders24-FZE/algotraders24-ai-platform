"""Independent check of AT24_CS_Core: calendar-day alignment of two daily series, short / long window correlation, the delta, and the percentile of the short correlation in its history.
Usage: python -I verify_cs.py CS_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; SW, LW, HN = int(meta[3]), int(meta[4]), int(meta[5])
A = [(int(r[1]), float(r[2])) for r in rows if r[0] == "a"]; B = [(int(r[1]), float(r[2])) for r in rows if r[0] == "b"]
da = {}; db = {}
for t, c in A: da[t // 86400] = c            # one bar per calendar day
for t, c in B: db[t // 86400] = c
days = sorted(set(da) & set(db))
ca = [da[d] for d in days]; cb = [db[d] for d in days]; m = len(days)
ra = [math.log(ca[i] / ca[i - 1]) for i in range(1, m)]; rb = [math.log(cb[i] / cb[i - 1]) for i in range(1, m)]; nr = len(ra)
def corr(x, y, f, l):
    xs, ys = x[f:f + l], y[f:f + l]; mx, my = sum(xs) / l, sum(ys) / l
    sxx = sum((v - mx) ** 2 for v in xs); syy = sum((v - my) ** 2 for v in ys); sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    return sxy / math.sqrt(sxx * syy) if sxx > 0 and syy > 0 else 0.0
cs, cl = corr(ra, rb, nr - SW, SW), corr(ra, rb, nr - LW, LW)
h0 = max(0, nr - HN); vals = [corr(ra, rb, e - SW, SW) for e in range(h0 + SW, nr + 1)]
pct = 100.0 * sum(1 for v in vals if v < cs - 1e-12) / len(vals)
ref = [r for r in rows if r[0] == "row"][0]; rm, rok, rn, rcs, rcl, rdl, rpct = int(ref[1]), int(ref[2]), int(ref[3]), float(ref[4]), float(ref[5]), float(ref[6]), float(ref[7])
ok = (rm == m and rok == 1 and rn == nr and abs(rcs - cs) < 1e-6 and abs(rcl - cl) < 1e-6 and abs(rdl - (cs - cl)) < 1e-6 and abs(rpct - pct) < 1e-4)
sf = [r for r in rows if r[0] == "self"][0]; sok = abs(float(sf[1]) - 1.0) < 1e-9 and abs(float(sf[2]) - 1.0) < 1e-9 and abs(float(sf[3])) < 1e-9
print(f"matched days {m} (MT5 {rm}), returns {nr}, corr{SW} {cs:+.3f}, corr{LW} {cl:+.3f}, delta {cs - cl:+.3f}, percentile {pct:.0f}  -> {'identical to MT5' if ok else 'DIFF ' + str(ref)}")
print("known answer (series against itself): corr 1, delta 0 ->", "ok" if sok else "DIFF")
print("RESULT", "PASS" if ok and sok else "FAIL")
