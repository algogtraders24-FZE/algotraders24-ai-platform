"""Independent check of AT24_ET_Core: per-hour recent/previous window statistics, status and CUSUM change point.
Usage: python -I verify_et.py ET_selftest.csv"""
import csv, sys, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n, REC = int(meta[1]), int(meta[2])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4])) for r in rows if r[0] == "bar"]
mt = {int(r[1]): r[2:] for r in rows if r[0] == "hour"}
msum = [float(x) for x in [r for r in rows if r[0] == "sum"][0][1:]]
NY, UTC = ZoneInfo("America/New_York"), timezone.utc
bad_hr = sum(1 for g, h, d, r in bars if datetime.fromtimestamp(g, UTC).astimezone(NY).hour != h)
print("New York hour mismatches vs zoneinfo:", bad_hr, "of", n)
THR = 2.0; last = bars[-1][2]; r0 = last - REC + 1; p0 = r0 - REC; a0 = r0 - 3 * REC
def tstat(v):
    m = len(v); mean = sum(v) / m; var = (sum(x * x for x in v) - m * mean * mean) / (m - 1); sd = math.sqrt(max(var, 0))
    return mean, (mean / (sd / math.sqrt(m)) if sd > 0 else 0.0)
bad = 0; alive = born = died = sig = 0
for h in range(24):
    R = [b[3] for b in bars if b[1] == h and b[2] >= r0]; P = [b[3] for b in bars if b[1] == h and p0 <= b[2] < r0]
    hist = [(i, b[3]) for i, b in enumerate(bars) if b[1] == h and b[2] >= a0]
    mR = tR = mP = tP = 0.0
    if len(R) >= 30: mR, tR = tstat(R)
    if len(P) >= 30: mP, tP = tstat(P)
    sR = len(R) >= 30 and abs(tR) >= THR; sP = len(P) >= 30 and abs(tP) >= THR
    st = 1 if (sR and sP and tR * tP > 0) else (2 if sR else (3 if sP else 0))
    sig += sR; alive += st == 1; born += st == 2; died += st == 3
    cpIdx = -1; cpBar = -1; mb = ma = cps = 0.0
    m = len(hist)
    if m >= 90:
        xs = [x for _, x in hist]; mu = sum(xs) / m; sdv = math.sqrt(sum((x - mu) ** 2 for x in xs) / (m - 1))
        S = 0.0; best = 0.0; kb = -1
        for j in range(m - 1):
            S += xs[j] - mu
            if abs(S) > best: best = abs(S); kb = j
        if kb >= 0 and sdv > 0:
            cpIdx, cpBar = kb, hist[kb][0]; mb = 1e4 * sum(xs[:kb + 1]) / (kb + 1); ma = 1e4 * sum(xs[kb + 1:]) / (m - kb - 1); cps = best / (sdv * math.sqrt(m))
    ref = mt[h]
    ok = (int(ref[0]) == len(R) and abs(float(ref[1]) - mR * 1e4) < 1e-3 and abs(float(ref[2]) - tR) < 1e-4 and int(ref[3]) == len(P) and abs(float(ref[4]) - mP * 1e4) < 1e-3 and abs(float(ref[5]) - tP) < 1e-4
          and int(ref[6]) == st and int(ref[7]) == cpIdx and int(ref[8]) == cpBar and abs(float(ref[9]) - mb) < 1e-3 and abs(float(ref[10]) - ma) < 1e-3 and abs(float(ref[11]) - cps) < 1e-4)
    if not ok: bad += 1; print("DIFF hour", h, ref)
ok_all = bad == 0 and bad_hr == 0 and [sig, alive, born, died] == msum
print(f"hours with mismatches {bad}; significant now {sig}, alive {alive}, newborn {born}, died {died} (mt5 {msum})")
print("RESULT", "PASS" if ok_all else "FAIL")
