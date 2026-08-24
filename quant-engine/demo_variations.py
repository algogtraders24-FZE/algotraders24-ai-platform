"""Test the auto-suggest-variations engine on the losing ideas from demo.py
(RSI+EMA that never traded, MACD Crossover, Bollinger Mean Reversion)."""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.variation_suggester import find_improvements
from engine import RiskConfig
from data_import import load_candles

# same 3 losing specs from demo.py
LOSING_SPECS = [
    {
        "name": "RSI Oversold + EMA Trend",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "rsi14", "type": "RSI", "period": 14},
            {"id": "ema50", "type": "EMA", "period": 50},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "rsi14", "op": "<", "right": 30},
                        {"left": "close", "op": ">", "right": "ema50"}],
        "entry_short": [{"left": "rsi14", "op": ">", "right": 70},
                         {"left": "close", "op": "<", "right": "ema50"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 4.0, "atr_id": "atr14"},
    },
    {
        "name": "MACD Crossover",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
        "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    },
    {
        "name": "Bollinger Mean Reversion",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "bb1", "type": "BB", "period": 20, "mult": 2.0},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "close", "op": "<", "right": "bb1.lower"}],
        "entry_short": [{"left": "close", "op": ">", "right": "bb1.upper"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.0, "atr_id": "atr14"},
    },
]


def main():
    df = load_candles("XAUUSD", "1h")
    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)

    report = []
    for spec in LOSING_SPECS:
        print("=" * 70)
        print("BASE IDEA:", spec["name"])
        result = find_improvements(df, spec, risk, __import__("spec_engine.runner", fromlist=["run_spec_backtest"]).run_spec_backtest,
                                    min_trades=30, top_n=3)
        print(f"  base: trades={result['base_metrics'].get('trades_total')} "
              f"PF={result['base_profit_factor']}")
        print(f"  tried {result['n_candidates_tried']} candidate variations")
        if result["verdict"] == "no_improvement":
            print("  VERDICT: none of the tried variations improved on the original. Honest miss.")
        else:
            print(f"  VERDICT: {len(result['improved'])} variation(s) improved it:")
            for r in result["improved"]:
                m = r["metrics"]
                print(f"    - {r['description']}")
                print(f"      -> trades={m.get('trades_total')} win_rate={m.get('win_rate_pct')} "
                      f"PF={m.get('profit_factor')} return={m.get('total_return_pct')}% dd={m.get('max_drawdown_pct')}%")
        report.append({
            "base_name": spec["name"], "base_metrics": result["base_metrics"],
            "n_tried": result["n_candidates_tried"], "verdict": result["verdict"],
            "improved": [{"description": r["description"], "metrics": r["metrics"]} for r in result["improved"]],
        })

    with open(os.path.join(os.path.dirname(__file__), "output", "variation_suggestions.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("\nDone -> output/variation_suggestions.json")


if __name__ == "__main__":
    main()
