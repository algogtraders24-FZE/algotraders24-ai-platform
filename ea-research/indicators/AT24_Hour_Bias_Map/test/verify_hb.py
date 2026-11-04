"""Independent check of AT24_HB_Core: New York hour from server time (vs zoneinfo), hourly return statistics, significance counts
and the first-half / second-half comparison. Usage: python -I verify_hb.py HB_selftest.csv"""
import csv, sys, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n, base, rule = int(meta[1]), int(meta[2]), int(meta[3])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6])) for r in rows if r[0] == "bar"]
mth = {int(r[1]): [float(x) for x in r[2:]] for r in rows if r[0] == "hour"}
msum = [float(x) for x in [r for r in rows if r[0] == "sum"][0][1:]]
NY, UTC = ZoneInfo("America/New_York"), timezone.utc
bad_hour = 0; ret = []; hrs = []
for srv, gmt, hr, o, c, rt in bars:
    d = datetime.fromtimestamp(gmt, UTC).astimezone(NY)
    srv_exp = gmt + (base + (1 if (rule == 2 and d.dst().total_seconds() != 0) else 0)) * 3600
    if d.hour != hr or srv != srv_exp: bad_hour += 1
    ret.append(math.log(c / o)); hrs.append(hr)
print("New York hour / server clock mismatches vs zoneinfo:", bad_hour, "of", n)
half = n // 2
S = {h: [0.0, 0.0, 0, 0, 0.0, 0.0, 0, 0] for h in range(24)}  # sum, sum2, n, up, sumA, sumB, nA, nB
for i, (r, h) in enumerate(zip(ret, hrs)):
    s = S[h]; s[0] += r; s[1] += r * r; s[2] += 1; s[3] += r > 0
    if i < half: s[4] += r; s[6] += 1
    else: s[5] += r; s[7] += 1
bad = 0; sig196 = sig3 = agree = 0; ma = [0.0] * 24; mb = [0.0] * 24
for h in range(24):
    s = S[h]; ma[h] = s[4] / s[6] if s[6] else 0.0; mb[h] = s[5] / s[7] if s[7] else 0.0
    if s[2] < 3: continue
    mean = s[0] / s[2]; var = (s[1] - s[2] * mean * mean) / (s[2] - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(s[2])) if sd > 0 else 0.0
    py = [s[2], mean * 1e4, t, 100 * s[3] / s[2], ma[h] * 1e4, mb[h] * 1e4, sd * 1e4]
    if not all(abs(a - b) < 2e-4 * max(1.0, abs(b)) for a, b in zip(py, mth[h])): bad += 1
    sig196 += abs(t) >= 1.96; sig3 += abs(t) >= 3.0
    if mean != 0 and ma[h] != 0 and mb[h] != 0 and (mean > 0) == (ma[h] > 0) == (mb[h] > 0): agree += 1
xa, xb = sum(ma) / 24, sum(mb) / 24
sxy = sum((a - xa) * (b - xb) for a, b in zip(ma, mb)); sxx = sum((a - xa) ** 2 for a in ma); syy = sum((b - xb) ** 2 for b in mb)
corr = sxy / math.sqrt(sxx * syy)
ok = bad_hour == 0 and bad == 0 and sig196 == msum[0] and sig3 == msum[1] and abs(corr - msum[2]) < 1e-6 and agree == msum[3]
print(f"hours with mismatching statistics: {bad}; |t|>=1.96: {sig196} (mt5 {msum[0]:.0f}), |t|>=3: {sig3} (mt5 {msum[1]:.0f}); first/second-half correlation {corr:.3f} (mt5 {msum[2]:.3f}); consistent hours {agree} (mt5 {msum[3]:.0f})")
print("RESULT", "PASS" if ok else "FAIL")
