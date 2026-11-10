"""Independent check of AT24_HD_Core on the real history and on a deliberately corrupted copy.
Usage: python -I verify_hd.py HD_selftest.csv"""
import csv, sys
from datetime import datetime, timezone
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), int(r[6])) for r in rows if r[0] == "bar"]
c2 = [(int(r[1]), float(r[2]), float(r[3]), int(r[4])) for r in rows if r[0] == "c2"]
ref = {r[1]: [int(x) for x in r[2:]] for r in rows if r[0] == "audit"}
yref = {}
for r in rows:
    if r[0] == "year": yref.setdefault(r[1], {})[int(r[2])] = [int(x) for x in r[3:]]
n = len(bars)
T = [b[0] for b in bars]; O = [b[1] for b in bars]; H = [b[2] for b in bars]; L = [b[3] for b in bars]; C = [b[4] for b in bars]; S = [b[5] for b in bars]
def audit(T, O, H, L, C, S):
    year = lambda t: datetime.fromtimestamp(t, timezone.utc).year
    base = year(T[0]); yr = {}; invalid = nonmono = 0
    for i in range(len(T)):
        y = year(T[i]); d = yr.setdefault(y, dict(bars=0, days=set(), daycount={}, zs=0, flat=0))
        d["bars"] += 1; d["zs"] += S[i] == 0; d["flat"] += H[i] == L[i]
        dk = T[i] // 86400; d["daycount"][dk] = d["daycount"].get(dk, 0) + 1
        if H[i] < L[i] or O[i] > H[i] or O[i] < L[i] or C[i] > H[i] or C[i] < L[i] or O[i] <= 0 or C[i] <= 0: invalid += 1
        if i > 0 and T[i] <= T[i - 1]: nonmono += 1
    # day runs in order of appearance (like the core: consecutive same-day bars)
    valid = -1; i = 0; fulldays = {}; days = {}
    while i < len(T):
        dk = T[i] // 86400; j = i
        while j < len(T) and T[j] // 86400 == dk: j += 1
        y = year(T[i]); days[y] = days.get(y, 0) + 1
        if j - i >= 20: fulldays[y] = fulldays.get(y, 0) + 1
        if valid < 0 and j - i >= 20: valid = i
        i = j
    gaps = gh = 0
    if valid >= 0:
        for k in range(valid + 1, len(T)):
            g = T[k] - T[k - 1]
            if 2 * 3600 < g < 44 * 3600: gaps += 1; gh += g // 3600 - 1
    sf = -1
    for y in sorted(yr):
        if yr[y]["bars"] >= 500 and yr[y]["zs"] * 20 < yr[y]["bars"]:
            sf = next(k for k in range(len(T)) if year(T[k]) == y); break
    return [len(T), valid, invalid, nonmono, gaps, gh, sf, base], {y: [yr[y]["bars"], days[y], fulldays.get(y, 0), yr[y]["zs"], yr[y]["flat"]] for y in yr}
ok = True
for tag, args in (("real", (T, O, H, L, C, S)), ("corrupt", None)):
    if tag == "corrupt":
        T2 = [x[0] for x in c2]; H2 = [x[1] for x in c2]; L2 = [x[2] for x in c2]; S2 = [x[3] for x in c2]
        args = (T2, O, H2, L2, C, S2)
    g, yv = audit(*args)
    same = g == ref[tag] and all(yv[y] == yref[tag].get(y) for y in yv)
    ok &= same
    print(f"{tag}: bars {g[0]}, first hourly day index {g[1]}, invalid {g[2]}, non-monotonic {g[3]}, hour gaps {g[4]} ({g[5]} h), spread usable from index {g[6]}  -> {'identical to MT5' if same else 'DIFF ' + str(ref[tag])}")
print("years (real): bars/days/full days/zero-spread/flat:", {y: v for y, v in sorted(yv.items())} if False else {y: audit(T, O, H, L, C, S)[1][y] for y in sorted(audit(T, O, H, L, C, S)[1])})
print("RESULT", "PASS" if ok else "FAIL")
