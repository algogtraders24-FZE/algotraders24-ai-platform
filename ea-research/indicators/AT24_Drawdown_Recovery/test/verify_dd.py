"""Independent check of AT24_DD_Core: recovery table, losing-streak table, losses-to-drawdown counts and the
equity-curve analysis on three synthetic series. Usage: python -I verify_dd.py DD_selftest.csv"""
import csv, sys, math

rows = list(csv.reader(open(sys.argv[1])))
bad = 0
def chk(name, a, b, tol=1e-6):
    global bad
    ok = abs(a - b) <= tol
    if not ok: bad += 1
    return "ok" if ok else "DIFF"

for r in rows:
    if r[0] == "rec":
        d = float(r[1]) / 100; py = 100 * d / (1 - d)
        print(f"recovery from {float(r[1]):7.3f}% needs {py:10.4f}% mt5 {float(r[2]):10.4f}% {chk('rec', py, float(r[2]), 1e-5)}")
    elif r[0] == "streak":
        py = 100 * (1 - (1 - float(r[1]) / 100) ** int(r[2]))
        print(f"risk {r[1]}% x {r[2]:>2} losses -> dd py {py:9.5f} mt5 {float(r[3]):9.5f} {chk('streak', py, float(r[3]), 1e-6)}")
    elif r[0] == "lossesto":
        risk = float(r[1])
        # layout: lossesto, risk, 10, n10, 20, n20, 50, n50
        for tgt, mtn in ((10, int(r[3])), (20, int(r[5])), (50, int(r[7]))):
            n = math.ceil(math.log(1 - tgt / 100) / math.log(1 - risk / 100) - 1e-12)
            ok = chk('lossesto', n, mtn, 0)
            print(f"risk {risk}%: losses to reach {tgt}% dd py {n} mt5 {mtn} {ok}")

series = {}
for r in rows:
    if r[0] == "series": series[int(r[1])] = dict(n=int(r[2]), base=float(r[3]), fl=float(r[4]), pnl=[])
    elif r[0] == "pnl": series[int(r[1])]["pnl"].append(float(r[2]))
    elif r[0] == "out": series[int(r[1])]["out"] = [float(x) for x in r[2:]]
for s, d in sorted(series.items()):
    eq = peak = d["base"]; maxdd = 0.0; peak_at = 0
    for i, p in enumerate(d["pnl"]):
        eq += p
        if eq > peak: peak, peak_at = eq, i + 1
        maxdd = max(maxdd, 100 * (peak - eq) / peak)
    cur = eq + d["fl"]
    if cur > peak: peak, peak_at = cur, len(d["pnl"])
    cdd = 100 * (peak - cur) / peak
    maxdd = max(maxdd, cdd)
    py = [peak, maxdd, cdd, 100 * (cdd / 100) / (1 - cdd / 100) if cdd > 0 else 0.0, cur, 100 * (maxdd / 100) / (1 - maxdd / 100), len(d["pnl"]) - peak_at, len(d["pnl"])]
    res = [chk(n, a, b, 1e-3 if n in ("peak", "equity") else 1e-5) for n, a, b in zip(["peak", "maxdd", "curdd", "need", "equity", "maxneed", "since", "n"], py, d["out"])]
    print(f"series {s}: n={d['n']} peak {py[0]:.2f}/{d['out'][0]:.2f} maxDD {py[1]:.4f}/{d['out'][1]:.4f} curDD {py[2]:.4f}/{d['out'][2]:.4f} need {py[3]:.4f}/{d['out'][3]:.4f} -> {res}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
