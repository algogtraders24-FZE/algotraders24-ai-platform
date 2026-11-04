"""Independent check of AT24_ER_Core: server days, expected range, hit bar and statistics from the dumped bars.
Usage: python -I verify_er.py ER_selftest.csv"""
import csv, sys, statistics

rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), int(r[2]), float(r[3]), int(r[4])) for r in rows if r[0] == "day"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
LB = 14
days = []  # dict per day
cur = None
for i, (t, o, h, l, c) in enumerate(bars):
    dk = t // 86400
    if dk != cur:
        cur = dk
        days.append(dict(first=i, last=i, o=o, h=h, l=l, c=c, exp=0.0, hit=-1))
    else:
        d = days[-1]; d["last"] = i; d["c"] = c; d["h"] = max(d["h"], h); d["l"] = min(d["l"], l)
for k in range(1, len(days)):
    if k - 1 < LB: continue
    days[k]["exp"] = sum(days[j]["h"] - days[j]["l"] for j in range(k - LB, k)) / LB
    hi, lo = -1e300, 1e300
    for i in range(days[k]["first"], days[k]["last"] + 1):
        hi = max(hi, bars[i][2]); lo = min(lo, bars[i][3])
        if hi - lo >= days[k]["exp"]: days[k]["hit"] = i; break

bad = 0 if len(days) == len(mt) else 1
for a, b in zip(days, mt):
    if a["first"] != b[0] or a["last"] != b[1] or abs(a["exp"] - b[2]) > 6e-5 or a["hit"] != b[3]: bad += 1
print("days python", len(days), "mt5", len(mt), "mismatches", bad)

ratio, fin, dir_ = [], [], 0
for d in days[:-1]:
    if d["exp"] <= 0: continue
    rg = (d["h"] - d["l"]) / d["exp"]; ratio.append(rg)
    if abs(d["c"] - d["o"]) >= 0.5 * d["exp"]: dir_ += 1
    if d["hit"] >= 0: fin.append(rg)
m = len(ratio)
py = [m, statistics.median(ratio), 100 * sum(r >= 1 for r in ratio) / m, 100 * sum(r >= 1.5 for r in ratio) / m, len(fin),
      100 * sum(r >= 1.25 for r in fin) / len(fin), statistics.median(fin), 100 * dir_ / m]
ok = bad == 0
for nme, a, b in zip(["days", "medRatio", "r100%", "r150%", "hits", "hit125%", "hitMed", "dir50%"], py, mst):
    f = abs(a - b) <= 1.1e-3
    ok = ok and f
    print(f"{nme:9s} python {a:9.3f} mt5 {b:9.3f} {'ok' if f else 'DIFF'}")
print("RESULT", "PASS" if ok else "FAIL")
