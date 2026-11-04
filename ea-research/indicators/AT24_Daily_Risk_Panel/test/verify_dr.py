"""Independent check of AT24_DR_Core on the deterministic scenarios. Usage: python -I verify_dr.py DR_selftest.csv"""
import csv, sys
rows = list(csv.reader(open(sys.argv[1])))
scn = {}
for r in rows:
    if r[0] == "scn": scn[int(r[1])] = dict(n=int(r[2]), ds=float(r[3]), closed=float(r[4]), fl=float(r[5]), trades=int(r[6]), dl=float(r[7]), mt=float(r[8]), mo=float(r[9]), mx=int(r[10]), pos=[])
    elif r[0] == "pos": scn[int(r[1])]["pos"].append([float(x) for x in r[2:]])
    elif r[0] == "out": scn[int(r[1])]["out"] = [float(x) for x in r[2:]]
bad = 0
for s, d in sorted(scn.items()):
    opn, nosl, over, risks = 0.0, 0, 0, []
    for vol, en, sl, dr, ts, tv, mt_risk in d["pos"]:
        dist = (en - sl) if dr > 0 else (sl - en)
        risk = 0.0 if (sl <= 0 or dist <= 0) else dist / ts * tv * vol
        risks.append(risk)
        if abs(risk - mt_risk) > 1e-4: bad += 1
        opn += risk
        if sl <= 0: nosl += 1
        elif 100 * risk / d["ds"] > d["mt"] + 1e-9: over += 1
    res = d["closed"] + d["fl"]
    limit = d["ds"] * d["dl"] / 100
    used = 100 * (-res) / limit if (limit > 0 and res < 0) else 0.0
    open_pct = 100 * opn / d["ds"]
    tr = 1.0 if d["trades"] > d["mx"] else 0.0
    op = 1.0 if open_pct > d["mo"] + 1e-9 else 0.0
    lm = 1.0 if used >= 100 else 0.0
    py = [used, res, opn, open_pct, nosl, over, tr, op, lm, nosl + over + tr + op + lm]
    ok = all(abs(a - b) < 1e-4 for a, b in zip(py, d["out"]))
    if not ok: bad += 1
    print(f"scenario {s}: n={d['n']} dailyUsed {py[0]:7.2f}% openRisk {py[2]:8.2f} ({py[3]:5.2f}%) noSL {py[4]} over {py[5]} trades {int(py[6])} open {int(py[7])} limit {int(py[8])} breaks {int(py[9])}  {'ok' if ok else 'DIFF'}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
