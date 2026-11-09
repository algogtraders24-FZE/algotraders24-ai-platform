"""Independent check of AT24_FL_Core: the three ledger rules replayed from three start dates, New York hour vs zoneinfo.
Usage: python -I verify_fl.py FL_selftest.csv"""
import csv, sys, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n0, v0 = int(meta[1]), int(meta[2])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6]), float(r[7])) for r in rows if r[0] == "bar"]
res = {(int(r[1]), int(r[2])): [float(x) for x in r[3:]] for r in rows if r[0] == "res"}
NY, UTC = ZoneInfo("America/New_York"), timezone.utc
bad_hr = sum(1 for t, g, hr, *_ in bars if datetime.fromtimestamp(g, UTC).astimezone(NY).hour != hr)
print("New York hour mismatches vs zoneinfo:", bad_hr, "of", len(bars))
# first valid index: first server day with >= 20 bars
days = {}
for i, b in enumerate(bars): days.setdefault(b[0] // 86400, []).append(i)
first = next(v[0] for k, v in sorted(days.items()) if len(v) >= 20)
print("valid-from index python", first, "mt5", v0)
bars = bars[first:]
T = [b[0] for b in bars]; HR = [b[2] for b in bars]; O = [b[3] for b in bars]; H = [b[4] for b in bars]; L = [b[5] for b in bars]; C = [b[6] for b in bars]; n = len(bars)
atr = [0.0] * n; a = 0.0; s = 0.0
for i in range(n):
    tr = H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        s += tr
        if i == 13: a = s / 14; atr[i] = a
    else:
        a = (a * 13 + tr) / 14; atr[i] = a
def run(rule, start):
    ds = [math.log(C[i] / O[i]) for i in range(n) if T[i] >= start]; drift = 1e4 * sum(ds) / len(ds) if ds else 0.0
    hold = (1, 4, 24)[rule]; last = -1; rets = []; dirs = []
    for i in range(15, n):
        entry = ex = -1; d = 0
        if rule == 0:
            if HR[i] == 18 and T[i] >= start: entry = ex = i; d = 1
        elif rule == 1:
            body = C[i] - O[i]
            if atr[i - 1] > 0 and abs(body) >= 2.5 * atr[i - 1] and i + 4 < n and T[i + 1] >= start: entry, ex, d = i + 1, i + 4, (-1 if body > 0 else 1)
        else:
            if i < 120 or i + 24 >= n: continue
            sg = sum(1 if C[i] > C[i - k] else -1 for k in (1, 4, 24, 120))
            if abs(sg) == 4 and T[i + 1] >= start: entry, ex, d = i + 1, i + 24, (1 if sg > 0 else -1)
        if entry < 0 or ex >= n or entry <= last: continue
        rets.append(1e4 * d * math.log(C[ex] / O[entry])); dirs.append(d); last = ex
    m = len(rets)
    if m == 0: return [0] * 11
    mean = sum(rets) / m; var = (sum(x * x for x in rets) - m * mean * mean) / (m - 1) if m > 1 else 0.0; sd = math.sqrt(max(var, 0))
    md = sum(dirs) / m; adj = mean - md * hold * drift
    return [m, mean, sd, mean / (sd / math.sqrt(m)) if sd > 0 else 0, 100 * sum(x > 0 for x in rets) / m, sum(rets), md, drift, adj, adj / (sd / math.sqrt(m)) if sd > 0 else 0]
bad = 0
for (st, rule), ref in sorted(res.items()):
    py = run(rule, st)
    ok = int(ref[0]) == py[0] and all(abs(x - y) < 2e-4 * max(1, abs(y)) for x, y in zip(py[1:], ref[1:]))
    bad += 0 if ok else 1
    dt = datetime.fromtimestamp(st, UTC).date()
    print(f"start {dt} rule {rule}: n {py[0]:3d} mean {py[1]:7.3f} bp t {py[3]:6.2f} hit {py[4]:5.1f}% drift {py[7]:6.3f} adj {py[8]:7.3f} tAdj {py[9]:5.2f}  {'ok' if ok else 'DIFF ' + str(ref)}")
print("RESULT", "PASS" if bad == 0 and bad_hr == 0 and first == v0 else "FAIL")
