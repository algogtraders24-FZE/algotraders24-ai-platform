"""Independent check of AT24_TP_Core against a separate implementation, and against the platform's own OrderCalcProfit.
Usage: python -I verify_tp.py TP_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
m = [r for r in rows if r[0] == "meta"][0]; ts, tv, vmin, vmax, vstep = (float(x) for x in m[1:6])
bad = 0; plat_bad = 0; plat_n = 0
for r in rows:
    if r[0] != "case": continue
    k, d = int(r[1]), int(r[2]); entry, sl, tp, risk, spr, com, dly = (float(x) for x in r[3:10])
    ref = [float(x) for x in r[11:19]]; lines_ok = int(r[10]); okp = int(r[19]); pfsl, pftp = float(r[20]), float(r[21])
    sld = d * (entry - sl); tpd = d * (tp - entry); rr = tpd / sld
    loss_per_lot = sld / ts * tv; raw = risk / loss_per_lot; lots = math.floor(raw / vstep + 1e-9) * vstep
    if lots > vmax: lots = math.floor(vmax / vstep + 1e-9) * vstep
    if lots < vmin - 1e-12: lots = 0.0
    risk_m = lots * loss_per_lot; reward = lots * tpd / ts * tv; sc = lots * spr / ts * tv; cm = lots * com
    cs = 100 * (sc + cm) / reward if reward > 0 else 0.0; ds = 100 * (risk_m + sc + cm) / dly if dly > 0 else 0.0
    py = [rr, lots, risk_m, reward, sc, cm, cs, ds]
    ok = lines_ok == 1 and all(abs(a - b) < 1e-5 * max(1, abs(a)) for a, b in zip(py, ref))
    bad += 0 if ok else 1
    note = ""
    if okp:
        plat_n += 1
        e1 = abs(-pfsl - risk_m) / max(risk_m, 1e-9); e2 = abs(pftp - reward) / max(reward, 1e-9)
        note = f" platform stop {-pfsl:.2f} vs {risk_m:.2f}, target {pftp:.2f} vs {reward:.2f}"
        if e1 > 0.002 or e2 > 0.002: plat_bad += 1; note += " DIFF"
    print(f"case {k}: dir {d:+d} lots {lots:.2f} risk {risk_m:.2f} reward {reward:.2f} R:R {rr:.2f} costs {cs:.1f}% daily {ds:.1f}%  {'ok' if ok else 'DIFF ' + str(ref)}{note}")
b = [r for r in rows if r[0] == "bad"][0]
bad_ok = int(b[2]) == 0 and float(b[3]) == 0.0
print("wrong-side stop rejected:", bad_ok, "| platform OrderCalcProfit cross-checks:", plat_n, "of 8 available" + ("" if plat_n else " (offline terminal has no quotes: run on a connected terminal)"), "| differing:", plat_bad)
print("RESULT", "PASS" if bad == 0 and bad_ok and plat_bad == 0 else "FAIL")
