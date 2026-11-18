"""Independent check of the tight plan (stop beyond the H4 turn): from the H4 bars of the MQL5 dump recompute, for every plan,
the turn swing (strict local extreme, 3 bars each side, before the trigger), the stop, the risk, target 1 and the walk-forward result
(stop first, target, 8-week time stop, spread cost). Usage: python verify_ra_plan.py <dir with RAP_h4_*.csv and RAP_plans_*.csv>"""
import sys, glob, os, pandas as pd
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
allok = True
for f in sorted(glob.glob(os.path.join(d0, "RAP_plans_*.csv"))):
    sym = os.path.basename(f).split("_")[2].split(".")[0]
    b = pd.read_csv(os.path.join(d0, f"RAP_h4_{sym}.csv")); P = pd.read_csv(f)
    n = len(b); h = b.high.values; l = b.low.values; c = b.close.values; o = b.open.values; t = b.t.values
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, n)]
    atr = [0.0 if i < 14 else sum(tr[i - 13:i + 1]) / 14 for i in range(n)]
    bad = 0; checked = 0; maxd = 0.0
    for _, r in P.iterrows():
        if r.status == -4: continue
        checked += 1
        d = int(r.dir); tb = int(r.turnBar); trig = int(r.trig)
        ok = 0 <= tb < trig
        if ok:
            k = 3
            if d < 0:   # short: turn = lower high before the trigger
                ok = abs(h[tb] - r.turnPx) < 1e-6 and all(h[tb] > h[j] for j in range(tb - k, tb + k + 1) if j != tb and 0 <= j < n)
            else:
                ok = abs(l[tb] - r.turnPx) < 1e-6 and all(l[tb] < l[j] for j in range(tb - k, tb + k + 1) if j != tb and 0 <= j < n)
        sl = r.turnPx + d * -0.25 * atr[trig] if d > 0 else r.turnPx + 0.25 * atr[trig]
        ok &= abs(sl - r.tightSL) < 1e-6
        entry = o[int(r.entryIdx)] if r.entryIdx >= 0 else c[trig]
        ok &= abs(entry - r.entry) < 1e-6
        risk = d * (entry - sl)
        if risk <= 0: ok &= (r.tstatus == -4)
        else:
            ok &= abs(risk - r.risk) < 1e-6 and abs(entry + d * 3 * risk - r.tp1) < 1e-6
            if r.entryIdx >= 0:
                tp = entry + d * 3 * risk; res = None
                for j in range(int(r.entryIdx), n):
                    slh = (l[j] <= sl) if d > 0 else (h[j] >= sl); tph = (h[j] >= tp) if d > 0 else (l[j] <= tp)
                    if slh: res = (-1, j, sl); break
                    if tph: res = (1, j, tp); break
                    if t[j] - t[int(r.entryIdx)] >= 8 * 604800: res = (0, j, c[j]); break
                if res is None: ok &= (r.st == 2 and r.ex == -1)
                else:
                    rr = d * (res[2] - entry) / risk - r.cost / risk
                    ok &= (r.st == res[0] and r.ex == res[1] and abs(rr - r.r) < 1e-6); maxd = max(maxd, abs(rr - r.r))
        if not ok: bad += 1; print("  mismatch plan", int(r.k))
    allok &= bad == 0
    print(sym, "plans", len(P), "checked", checked, "mismatches", bad, "max R diff", f"{maxd:.1e}", "OK" if bad == 0 else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
