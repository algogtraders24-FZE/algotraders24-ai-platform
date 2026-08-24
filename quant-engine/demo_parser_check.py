"""
Honesty check for llm_parser.py: this sandbox has no ANTHROPIC_API_KEY, so
parse_idea_to_spec() cannot literally be invoked here (verified: the SDK call
fails with "Could not resolve authentication method" — no live call was
faked). What this script DOES prove: for two NEW ideas (not in demo.py),
specs hand-written to exactly follow SYSTEM_PROMPT + SPEC_TOOL's rules in
llm_parser.py run cleanly through validate_spec() -> real backtest -> MQL5 +
Pine codegen. That's the same job the live model call does; only the
network call itself is untested until a real ANTHROPIC_API_KEY is wired in
on the website backend.
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.schema import validate_spec
from spec_engine.runner import run_spec_backtest
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine
from engine import RiskConfig
from data_import import load_candles

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUT_DIR, exist_ok=True)

IDEAS = [
    {
        "idea_text": "9 EMA crosses above 21 EMA and RSI is above 50 -> buy; "
                     "opposite crossover with RSI below 50 -> sell",
        "spec": {
            "name": "EMA9x21 Cross + RSI Filter",
            "symbol": "XAUUSD", "timeframe": "1h",
            "indicators": [
                {"id": "ema9", "type": "EMA", "period": 9},
                {"id": "ema21", "type": "EMA", "period": 21},
                {"id": "rsi14", "type": "RSI", "period": 14},
                {"id": "atr14", "type": "ATR", "period": 14},
            ],
            "entry_long": [{"left": "ema9", "op": "cross_above", "right": "ema21"},
                            {"left": "rsi14", "op": ">", "right": 50}],
            "entry_short": [{"left": "ema9", "op": "cross_below", "right": "ema21"},
                             {"left": "rsi14", "op": "<", "right": 50}],
            "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 4.0,
                      "atr_id": "atr14"},
        },
    },
    {
        "idea_text": "Overbought/oversold reversal: sell when price closes above the upper "
                     "Bollinger Band and RSI > 70, buy when price closes below the lower "
                     "Bollinger Band and RSI < 30",
        "spec": {
            "name": "BB + RSI Reversal",
            "symbol": "XAUUSD", "timeframe": "1h",
            "indicators": [
                {"id": "bb1", "type": "BB", "period": 20, "mult": 2.0},
                {"id": "rsi14", "type": "RSI", "period": 14},
                {"id": "atr14", "type": "ATR", "period": 14},
            ],
            "entry_long": [{"left": "close", "op": "<", "right": "bb1.lower"},
                            {"left": "rsi14", "op": "<", "right": 30}],
            "entry_short": [{"left": "close", "op": ">", "right": "bb1.upper"},
                             {"left": "rsi14", "op": ">", "right": 70}],
            "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.5,
                      "atr_id": "atr14"},
        },
    },
]


def main():
    df = load_candles("XAUUSD", "1h")
    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
    results = []

    for item in IDEAS:
        spec = item["spec"]
        slug = spec["name"].replace(" ", "_").replace("+", "plus")
        print("=" * 70)
        print("IDEA:", item["idea_text"])
        errors = validate_spec(spec)
        print("validate_spec errors:", errors if errors else "none (valid)")
        if errors:
            continue

        trades_df, equity, metrics = run_spec_backtest(df, spec, risk)
        print(f"trades={metrics.get('trades_total')} win_rate={metrics.get('win_rate_pct')} "
              f"PF={metrics.get('profit_factor')} return_pct={metrics.get('total_return_pct')} "
              f"max_dd={metrics.get('max_drawdown_pct')}")

        mql5_code = generate_mql5(spec)
        pine_code = generate_pine(spec)
        with open(os.path.join(OUT_DIR, f"{slug}.mq5"), "w") as f:
            f.write(mql5_code)
        with open(os.path.join(OUT_DIR, f"{slug}.pine"), "w") as f:
            f.write(pine_code)
        with open(os.path.join(OUT_DIR, f"{slug}.spec.json"), "w") as f:
            json.dump(spec, f, indent=2)

        results.append({"name": spec["name"], "idea_text": item["idea_text"], "metrics": metrics})

    with open(os.path.join(OUT_DIR, "parser_check_summary.json"), "w") as f:
        json.dump(results, f, indent=2)
    print("=" * 70)
    print("Done -> output/parser_check_summary.json")


if __name__ == "__main__":
    main()
