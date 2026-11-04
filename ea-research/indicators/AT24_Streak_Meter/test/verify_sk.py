"""Independent check of AT24_SK_Core: same-colour streaks and the continuation statistics. Usage: python -I verify_sk.py SK_selftest.csv"""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
series = {}
for r in rows:
    if r[0] == "bar": series.setdefault(r[1], {"o": [], "c": [], "st": {}})["o"].append(float(r[2])); series[r[1]]["c"].append(float(r[3]))
    elif r[0] == "stat": series.setdefault(r[1], {"o": [], "c": [], "st": {}})["st"][int(r[2])] = float(r[3])
ok_all = True
for tag, d in series.items():
    o, c = d["o"], d["c"]; n = len(o)
    col = [1 if c[i] > o[i] else (-1 if c[i] < o[i] else 0) for i in range(n)]
    ln = [0] * n
    for i in range(n):
        if col[i] == 0: ln[i] = 0
        elif i and col[i - 1] == col[i]: ln[i] = ln[i - 1] + 1
        else: ln[i] = 1
    K = 6; cnt = [0] * (K + 1); same = [0] * (K + 1)
    for i in range(n - 1):
        if col[i] == 0 or col[i + 1] == 0: continue
        cont = col[i + 1] == col[i]; k = min(ln[i], K)
        cnt[k] += 1; same[k] += cont; cnt[0] += 1; same[0] += cont
    py = []
    for k in range(1, K + 1): py += [cnt[k], 100 * same[k] / cnt[k] if cnt[k] else 0.0]
    py += [cnt[0], 100 * same[0] / cnt[0]]
    ok = all(abs(a - d["st"][i]) < 1e-4 for i, a in enumerate(py))
    ok_all &= ok
    print(f"{tag}: bars {n}, baseline {py[13]:.1f}% of {py[12]:.0f}; continuation by streak length k=1..6:", ", ".join(f"{py[(k-1)*2+1]:.1f}% (n={py[(k-1)*2]:.0f})" for k in range(1, 7)), "ok" if ok else "DIFF")
print("RESULT", "PASS" if ok_all else "FAIL")
