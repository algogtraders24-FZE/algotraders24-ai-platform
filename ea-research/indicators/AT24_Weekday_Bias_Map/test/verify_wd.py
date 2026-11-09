"""Independent check of AT24_WD_Core: weekday (from timestamps, checked with datetime) and the return statistics.
Usage: python -I verify_wd.py WD_selftest.csv"""
import csv, sys, math
from datetime import datetime, timezone
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3])) for r in rows if r[0] == "bar"]
mth = {int(r[1]): [float(x) for x in r[2:]] for r in rows if r[0] == "dow"}
msum = [float(x) for x in [r for r in rows if r[0] == "sum"][0][1:]]
n = len(bars); half = n // 2
ret, dow = [], []
for t, o, c in bars:
    d = datetime.fromtimestamp(t, timezone.utc)
    dow.append((d.weekday() + 1) % 7)       # Python Monday=0 -> our Sunday=0
    ret.append(math.log(c / o))
S = {d: [0.0, 0.0, 0, 0, 0.0, 0.0, 0, 0] for d in range(7)}
for i, (r, d) in enumerate(zip(ret, dow)):
    s = S[d]; s[0] += r; s[1] += r * r; s[2] += 1; s[3] += r > 0
    if i < half: s[4] += r; s[6] += 1
    else: s[5] += r; s[7] += 1
bad = 0; sig196 = sig258 = agree = used = 0; ma = {}; mb = {}
for d in range(1, 6):
    s = S[d]
    if s[2] < 30: continue
    used += 1
    ma[d] = s[4] / s[6] if s[6] else 0.0; mb[d] = s[5] / s[7] if s[7] else 0.0
    mean = s[0] / s[2]; var = (s[1] - s[2] * mean * mean) / (s[2] - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(s[2])) if sd > 0 else 0.0
    py = [s[2], mean * 1e4, t, 100 * s[3] / s[2], ma[d] * 1e4, mb[d] * 1e4, sd * 1e4]
    if not all(abs(a - b) < 2e-4 * max(1.0, abs(b)) for a, b in zip(py, mth[d])): bad += 1
    sig196 += abs(t) >= 1.96; sig258 += abs(t) >= 2.58
    if mean != 0 and ma[d] != 0 and mb[d] != 0 and (mean > 0) == (ma[d] > 0) == (mb[d] > 0): agree += 1
ks = sorted(ma); xa = sum(ma[k] for k in ks) / len(ks); xb = sum(mb[k] for k in ks) / len(ks)
sxy = sum((ma[k] - xa) * (mb[k] - xb) for k in ks); sxx = sum((ma[k] - xa) ** 2 for k in ks); syy = sum((mb[k] - xb) ** 2 for k in ks)
corr = sxy / math.sqrt(sxx * syy)
ok = bad == 0 and sig196 == msum[0] and sig258 == msum[1] and abs(corr - msum[2]) < 1e-6 and agree == msum[3] and used == msum[4]
print(f"weekdays with mismatching statistics: {bad}; |t|>=1.96: {sig196} (mt5 {msum[0]:.0f}), |t|>=2.58: {sig258} (mt5 {msum[1]:.0f}); half-to-half corr {corr:.3f} (mt5 {msum[2]:.3f}); consistent {agree} (mt5 {msum[3]:.0f}); evaluated {used}")
print("RESULT", "PASS" if ok else "FAIL")
