"""Independent check of AT24_NW_Core: range after each high-impact event vs the same clock time on quiet days.
Usage: python -I verify_nw.py NW_selftest.csv   (window = 2 bars, exclusion = 3600 s)"""
import csv, sys, statistics
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3])) for r in rows if r[0] == "bar"]
ev = [(int(r[1]), float(r[2])) for r in rows if r[0] == "ev"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
WIN, EXC = 2, 3600
n = len(bars)
days = {}
for i, (t, h, l) in enumerate(bars):
    days.setdefault(t // 86400, []).append(i)
def bar_at(day, target):
    for i in days.get(day, []):
        if bars[i][0] >= target: return i
    return -1
def rng(s): return max(b[1] for b in bars[s:s + WIN]) - min(b[2] for b in bars[s:s + WIN])
times = [e[0] for e in ev]
ratios, evr, ctm, used, bad = [], [], [], 0, 0
for k, (et, mt_ratio) in enumerate(ev):
    ek = et // 86400
    s = bar_at(ek, et)
    if s < 0 or s + WIN > n or ek not in days: 
        if mt_ratio != -1.0: bad += 1
        continue
    r = rng(s); tod = et % 86400; cr = []
    for dk in days:
        if dk == ek: continue
        target = dk * 86400 + tod
        if any(abs(x - target) < EXC for x in times): continue
        s2 = bar_at(dk, target)
        if s2 < 0 or s2 + WIN > n: continue
        cr.append(rng(s2))
    if len(cr) < 5:
        if mt_ratio != -1.0: bad += 1
        continue
    med = statistics.median(cr)
    if med <= 0: continue
    ratio = r / med
    if abs(ratio - mt_ratio) > 2e-5: bad += 1
    ratios.append(ratio); evr.append(r); ctm.append(med); used += len(cr)
print("per-event ratio mismatches", bad, "of", len(ev))
py = [len(ratios), statistics.median(evr), statistics.median(ctm), statistics.median(ratios),
      100 * sum(x >= 1.5 for x in ratios) / len(ratios), 100 * sum(x >= 2 for x in ratios) / len(ratios), 100 * sum(x < 1 for x in ratios) / len(ratios), used]
ok = bad == 0
for nme, a, b in zip(["measured", "medEvent", "medCtrl", "medRatio", "r>=1.5%", "r>=2%", "r<1%", "ctrlWin"], py, mst):
    f = abs(a - b) <= 2e-3
    ok = ok and f
    print(f"{nme:9s} python {a:10.4f} mt5 {b:10.4f} {'ok' if f else 'DIFF'}")
print("RESULT", "PASS" if ok else "FAIL")
