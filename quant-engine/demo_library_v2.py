"""Final proof for the expanded library: new indicators, 3 symbol/timeframe
combos, and walk-forward robustness filtering (not just raw profit factor)."""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.library_search import find_strategies, library_stats
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUT_DIR, exist_ok=True)

COMBOS = [("XAUUSD", "1h"), ("XAUUSD", "4h"), ("EURUSD", "1h")]


def main():
    report = {"stats": {}, "queries": {}}

    for symbol, tf in COMBOS:
        stats = library_stats(symbol, tf)
        report["stats"][f"{symbol}_{tf}"] = stats
        print(f"{symbol} {tf}: {stats}")

    print("\n" + "=" * 70)
    print("QUERY: raw best profit factor (no robustness filter) — XAUUSD 1h")
    naive = find_strategies("XAUUSD", "1h", min_trades=30, order_by="profit_factor", top_n=3)
    for r in naive:
        print(f"  {r['name']}: PF={r['profit_factor']} wf_folds_profitable={r['wf_pct_profitable']}% "
              f"wf_avg_fold_pf={r['wf_avg_fold_pf']} robustness={r['wf_robustness_score']}")

    print("\n" + "=" * 70)
    print("QUERY: robustness-filtered (>=60% folds profitable), ranked by robustness — XAUUSD 1h")
    robust = find_strategies("XAUUSD", "1h", min_trades=30, min_pct_folds_profitable=60,
                              order_by="robustness", top_n=5)
    for r in robust:
        print(f"  {r['name']}: PF={r['profit_factor']} wf_folds_profitable={r['wf_pct_profitable']}% "
              f"wf_avg_fold_pf={r['wf_avg_fold_pf']} wf_min_fold_pf={r['wf_min_fold_pf']} "
              f"robustness={r['wf_robustness_score']}")
    report["queries"]["xauusd_1h_naive_top3"] = [{k: v for k, v in r.items() if k != "spec"} for r in naive]
    report["queries"]["xauusd_1h_robust_top5"] = [{k: v for k, v in r.items() if k != "spec"} for r in robust]

    for symbol, tf in COMBOS:
        print("\n" + "=" * 70)
        print(f"QUERY: robustness-filtered best — {symbol} {tf}")
        res = find_strategies(symbol, tf, min_trades=30, min_pct_folds_profitable=60,
                               order_by="robustness", top_n=3)
        for r in res:
            print(f"  {r['name']}: PF={r['profit_factor']} wf_folds_profitable={r['wf_pct_profitable']}% "
                  f"robustness={r['wf_robustness_score']}")
        report["queries"][f"{symbol}_{tf}_robust_top3"] = [{k: v for k, v in r.items() if k != "spec"} for r in res]

    # Generate code for the single most robust XAUUSD 1h match
    if robust:
        spec = robust[0]["spec"]
        slug = "LIBRARY_ROBUST_" + spec["name"].replace(" ", "_").replace("[", "").replace("]", "").replace("+", "_")
        with open(os.path.join(OUT_DIR, f"{slug}.mq5"), "w") as f:
            f.write(generate_mql5(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.pine"), "w") as f:
            f.write(generate_pine(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.spec.json"), "w") as f:
            json.dump(spec, f, indent=2)
        print(f"\nGenerated code for most robust match: {slug}.mq5 / .pine")

    with open(os.path.join(OUT_DIR, "library_v2_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("\nDone -> output/library_v2_report.json")


if __name__ == "__main__":
    main()
