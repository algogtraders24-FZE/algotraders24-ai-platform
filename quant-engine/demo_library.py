"""Option B proof: build the pre-computed strategy library on real XAUUSD
1h data, then run LuxAlgo-style search/filter queries against it."""
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.library_generator import build_library, iter_grid_specs
from spec_engine.library_search import find_strategies, library_stats
from spec_engine.runner import run_spec_backtest
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine
from engine import RiskConfig
from data_import import load_candles

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUT_DIR, exist_ok=True)


def main():
    df = load_candles("XAUUSD", "1h")
    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)

    n_grid = sum(1 for _ in iter_grid_specs())
    print(f"Grid size: {n_grid} spec variations to backtest")

    t0 = time.time()
    n = build_library(df, run_spec_backtest, risk, symbol="XAUUSD", timeframe="1h")
    elapsed = time.time() - t0
    print(f"Built library: {n} strategies backtested in {elapsed:.1f}s\n")

    stats = library_stats("XAUUSD", "1h")
    print("Library stats (trades>=30 only):", stats, "\n")

    queries = [
        dict(label="Best profit factor overall", min_trades=30, order_by="profit_factor", top_n=5),
        dict(label="Best PF with drawdown capped at 20%", min_trades=30, max_drawdown_pct=20,
             order_by="profit_factor", top_n=5),
        dict(label="Highest win rate with PF > 1.0", min_trades=30, min_profit_factor=1.0,
             order_by="win_rate", top_n=5),
    ]

    all_query_results = []
    for q in queries:
        label = q.pop("label")
        print("=" * 70)
        print("QUERY:", label, q)
        results = find_strategies(symbol="XAUUSD", timeframe="1h", **q)
        for r in results:
            print(f"  {r['name']}: trades={r['trades_total']} win_rate={r['win_rate_pct']} "
                  f"PF={r['profit_factor']} return={r['total_return_pct']}% dd={r['max_drawdown_pct']}%")
        all_query_results.append({"query": {"label": label, **q},
                                    "results": [{k: v for k, v in r.items() if k != "spec"} for r in results]})

    # Generate code for the single best PF-with-capped-DD result, proving the
    # library->code path works end to end same as templates/LLM specs do.
    best = find_strategies(symbol="XAUUSD", timeframe="1h", min_trades=30, max_drawdown_pct=20,
                            order_by="profit_factor", top_n=1)
    if best:
        spec = best[0]["spec"]
        slug = "LIBRARY_BEST_" + spec["name"].replace(" ", "_").replace("[", "").replace("]", "").replace("+", "_")
        with open(os.path.join(OUT_DIR, f"{slug}.mq5"), "w") as f:
            f.write(generate_mql5(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.pine"), "w") as f:
            f.write(generate_pine(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.spec.json"), "w") as f:
            json.dump(spec, f, indent=2)
        print(f"\nGenerated code for top library match: {slug}.mq5 / .pine")

    with open(os.path.join(OUT_DIR, "library_query_results.json"), "w") as f:
        json.dump({"grid_size": n_grid, "build_seconds": round(elapsed, 1), "stats": stats,
                    "queries": all_query_results}, f, indent=2)
    print("\nDone -> output/library_query_results.json")


if __name__ == "__main__":
    main()
