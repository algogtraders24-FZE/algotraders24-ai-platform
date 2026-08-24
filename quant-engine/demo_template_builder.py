"""Option A proof: wizard-built specs (zero AI) -> real backtest -> code."""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.template_builder import build_spec
from spec_engine.runner import run_spec_backtest
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine
from engine import RiskConfig
from data_import import load_candles

OUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUT_DIR, exist_ok=True)

WIZARD_PICKS = [
    dict(name="Wizard: EMA9x21 Cross, No Filter, Standard Risk",
         trigger_key="ema_cross", filter_key="none", risk_key="standard"),
    dict(name="Wizard: MACD Cross + Trend Filter, Conservative Risk",
         trigger_key="macd_cross", filter_key="ema_trend", risk_key="conservative"),
    dict(name="Wizard: BB Breakout + RSI Momentum Filter, Aggressive Risk",
         trigger_key="bb_breakout", filter_key="rsi_midline", risk_key="aggressive"),
]


def main():
    df = load_candles("XAUUSD", "1h")
    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
    results = []

    for pick in WIZARD_PICKS:
        spec = build_spec(**pick)
        slug = spec["name"].replace(" ", "_").replace(",", "").replace("+", "plus")
        print("=" * 70)
        print("WIZARD PICK:", pick)
        trades_df, equity, metrics = run_spec_backtest(df, spec, risk)
        print(f"trades={metrics.get('trades_total')} win_rate={metrics.get('win_rate_pct')} "
              f"PF={metrics.get('profit_factor')} return_pct={metrics.get('total_return_pct')} "
              f"max_dd={metrics.get('max_drawdown_pct')}")

        with open(os.path.join(OUT_DIR, f"{slug}.mq5"), "w") as f:
            f.write(generate_mql5(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.pine"), "w") as f:
            f.write(generate_pine(spec))
        with open(os.path.join(OUT_DIR, f"{slug}.spec.json"), "w") as f:
            json.dump(spec, f, indent=2)

        results.append({"wizard_pick": pick, "name": spec["name"], "metrics": metrics})

    with open(os.path.join(OUT_DIR, "template_builder_summary.json"), "w") as f:
        json.dump(results, f, indent=2)
    print("=" * 70)
    print("Done -> output/template_builder_summary.json")


if __name__ == "__main__":
    main()
