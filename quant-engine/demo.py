"""
End-to-end proof: plain-English idea -> spec -> real backtest (on actual
XAUUSD H1 data already in quant_engine/market.db) -> MQL5 EA + Pine
Script strategy code. Run: python3 demo.py
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

# --- Example ideas, hand-translated to specs (this step is what an LLM
#     parser would do automatically in the real product; the point of
#     this demo is proving specs 2-4 downstream) -------------------------

IDEA_1 = {
    "idea_text": "RSI oversold buy with EMA trend filter — buy when RSI(14) < 30 "
                 "and price is above EMA(50), sell when RSI > 70 and price is below EMA(50)",
    "spec": {
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
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 4.0,
                  "atr_id": "atr14"},
    },
}

IDEA_2 = {
    "idea_text": "MACD bullish crossover above zero line — buy when MACD line crosses "
                 "above signal line, sell on the opposite crossover",
    "spec": {
        "name": "MACD Crossover",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
        "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0,
                  "atr_id": "atr14"},
    },
}

IDEA_3 = {
    "idea_text": "Bollinger Band mean reversion — buy when price closes below the lower "
                 "band, sell when price closes above the upper band",
    "spec": {
        "name": "Bollinger Mean Reversion",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "bb1", "type": "BB", "period": 20, "mult": 2.0},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "close", "op": "<", "right": "bb1.lower"}],
        "entry_short": [{"left": "close", "op": ">", "right": "bb1.upper"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.0,
                  "atr_id": "atr14"},
    },
}

IDEAS = [IDEA_1, IDEA_2, IDEA_3]


def main():
    df = load_candles("XAUUSD", "1h")
    print(f"Loaded {len(df)} XAUUSD 1h candles for backtest\n")

    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)

    results_summary = []

    for idea in IDEAS:
        spec = idea["spec"]
        slug = spec["name"].replace(" ", "_").replace("+", "plus")
        print("=" * 70)
        print(f"IDEA: {idea['idea_text']}")
        print("=" * 70)

        errors = validate_spec(spec)
        if errors:
            print("SPEC INVALID:", errors)
            continue
        print("Spec validated OK.")

        trades_df, equity, metrics = run_spec_backtest(df, spec, risk)

        def _fmt(key, suffix=""):
            v = metrics.get(key)
            return f"{v}{suffix}" if v is not None else "n/a"

        print(f"Backtest: trades={metrics.get('trades_total', 0)} "
              f"win_rate={_fmt('win_rate_pct', '%')} "
              f"profit_factor={_fmt('profit_factor')} "
              f"final_balance={_fmt('final_balance')} "
              f"return_pct={_fmt('total_return_pct', '%')} "
              f"max_dd={_fmt('max_drawdown_pct', '%')}")

        mql5_code = generate_mql5(spec)
        pine_code = generate_pine(spec)

        mql5_path = os.path.join(OUT_DIR, f"{slug}.mq5")
        pine_path = os.path.join(OUT_DIR, f"{slug}.pine")
        spec_path = os.path.join(OUT_DIR, f"{slug}.spec.json")
        with open(mql5_path, "w") as f:
            f.write(mql5_code)
        with open(pine_path, "w") as f:
            f.write(pine_code)
        with open(spec_path, "w") as f:
            json.dump(spec, f, indent=2)

        print(f"Wrote: {mql5_path}")
        print(f"Wrote: {pine_path}")
        print(f"Wrote: {spec_path}\n")

        results_summary.append({
            "name": spec["name"], "idea_text": idea["idea_text"],
            "metrics": {k: metrics.get(k) for k in
                        ("trades_total", "win_rate_pct", "profit_factor",
                         "final_balance", "total_return_pct", "max_drawdown_pct")},
        })

    summary_path = os.path.join(OUT_DIR, "demo_summary.json")
    with open(summary_path, "w") as f:
        json.dump(results_summary, f, indent=2)
    print("=" * 70)
    print(f"Summary written: {summary_path}")


if __name__ == "__main__":
    main()
