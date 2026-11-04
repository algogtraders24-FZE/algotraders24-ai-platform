"""Independent check of AT24_PS_Core: synthetic cases recomputed with exact decimals, and the real symbol against
the platform's OrderCalcProfit when it was available. Usage: python -I verify_ps.py PS_selftest.csv"""
import csv, sys
from decimal import Decimal, ROUND_FLOOR

rows = list(csv.reader(open(sys.argv[1])))
bad = 0
for r in rows:
    if r[0] != "case": continue
    risk, sl, ts, tv, vmin, vmax, vst = [Decimal(x) for x in r[1:8]]
    lpl = sl / ts * tv
    raw = risk / lpl
    lots = (raw / vst).to_integral_value(rounding=ROUND_FLOOR) * vst
    small = capped = 0
    if lots < vmin: small, lots = 1, Decimal(0)
    elif lots > vmax: lots = (vmax / vst).to_integral_value(rounding=ROUND_FLOOR) * vst; capped = 1
    rk = lots * lpl
    mt = (Decimal(r[8]), Decimal(r[9]), Decimal(r[10]), Decimal(r[11]), int(r[12]), int(r[13]))
    ok = abs(mt[0] - lpl) < Decimal("1e-5") and abs(mt[1] - raw) < Decimal("1e-6") and abs(mt[2] - lots) < Decimal("1e-9") and abs(mt[3] - rk) < Decimal("1e-4") and mt[4] == small and mt[5] == capped
    print(f"case risk={r[1]:>9} sl={r[2]:>7} -> lots py {float(lots):8.2f} mt5 {float(mt[2]):8.2f} small={small} capped={capped} {'ok' if ok else 'DIFF'}")
    bad += 0 if ok else 1
for r in rows:
    if r[0] != "real": continue
    ts, tv, vmin, vmax, vst, cs = [Decimal(x) for x in r[2:8]]
    price, sl, risk = Decimal(r[8]), Decimal(r[9]), Decimal(r[10])
    lpl = sl / ts * tv
    lots = (risk / lpl / vst).to_integral_value(rounding=ROUND_FLOOR) * vst
    mt_lpl, mt_lots, mt_risk, okc, calc, used = Decimal(r[11]), Decimal(r[12]), Decimal(r[13]), int(r[14]), Decimal(r[15]), Decimal(r[16])
    ok = abs(mt_lpl - lpl) < Decimal("1e-4") and abs(mt_lots - lots) < Decimal("1e-9")
    print(f"real {r[1]}: tick {ts} value {tv} contract {cs}  lots py {lots} mt5 {mt_lots}  {'ok' if ok else 'DIFF'}")
    bad += 0 if ok else 1
    if okc and calc != 0:
        # OrderCalcProfit returns a negative number for a loss
        d = abs(abs(calc) - used * lpl)
        ok2 = d < Decimal("0.01")
        print(f"   platform OrderCalcProfit for {used} lots = {calc}  vs formula {used * lpl}  diff {d}  {'ok' if ok2 else 'DIFF'}")
        bad += 0 if ok2 else 1
    else:
        print("   OrderCalcProfit returned 0 (no account connected) - platform cross-check skipped; tick value estimated as tick size x contract size")
print("RESULT", "PASS" if bad == 0 else "FAIL")
