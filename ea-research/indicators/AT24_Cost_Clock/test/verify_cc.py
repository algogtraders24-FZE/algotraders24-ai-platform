"""Independent check of AT24_CC_Core (cost clock) and of the New York hour vs zoneinfo.
Usage: python -I verify_cc.py CC_selftest.csv"""
import csv, sys, statistics
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; point = float(meta[2]); days = int(meta[3]); minb = int(meta[4])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), int(r[6])) for r in rows if r[0] == "bar"]
ref = {int(r[1]): r[2:] for r in rows if r[0] == "hour"}
NY, UTC = ZoneInfo("America/New_York"), timezone.utc
bad_hr = sum(1 for t, g, hr, *_ in bars if datetime.fromtimestamp(g, UTC).astimezone(NY).hour != hr)
print("New York hour mismatches vs zoneinfo:", bad_hr, "of", len(bars))
frm = bars[-1][0] - days * 86400
res = {}
for h in range(24):
    sp, rg, ra = [], [], []
    for t, g, hr, hi, lo, s in bars:
        if hr != h or t < frm or s <= 0 or hi - lo <= 0: continue
        sp.append(s * point); rg.append(hi - lo); ra.append(s * point / (hi - lo))
    res[h] = (len(sp), statistics.median(sp) if len(sp) >= minb else 0.0, statistics.median(rg) if len(sp) >= minb else 0.0, statistics.median(ra) if len(sp) >= minb else 0.0)
ok_h = [h for h in range(24) if res[h][0] >= minb]
rank = {h: 1 + sum(1 for k in ok_h if k != h and (res[k][3] < res[h][3] or (res[k][3] == res[h][3] and k < h))) for h in ok_h}
bad = 0
for h in range(24):
    n, ms, mr, mq = res[h]; r = ref[h]
    ok = int(r[0]) == n and abs(float(r[1]) - ms) < 1e-6 and abs(float(r[2]) - mr) < 1e-6 and abs(float(r[3]) - mq) < 1e-8 and int(r[4]) == rank.get(h, 0)
    bad += 0 if ok else 1
    print(f"NY {h:02d}: n {n:4d} spread {ms:.3f} range {mr:6.2f} cost/range {mq*100:5.2f} % rank {rank.get(h, 0):2d}  {'ok' if ok else 'DIFF ' + str(r)}")
print("RESULT", "PASS" if bad == 0 and bad_hr == 0 else "FAIL")
