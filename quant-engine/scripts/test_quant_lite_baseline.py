"""
Q0.4 verification: the same MACD Crossover / Bollinger Mean Reversion
2024 controlled test as Q0.3's scripts/test_tick_engine.py (kept
untouched - its output is already cited as Q0.3 evidence), run again
using quant_lite_risk_config() instead of a raw RiskConfig(...) call.

Does not modify entry/exit rules, indicators, position sizing, spread,
or SL/TP logic - only the RiskConfig construction differs from
test_tick_engine.py. Verifies, from the resulting trades_df alone (no
new instrumentation added to any engine file):
  - zero PARTIAL-reason rows (partial-close is directly observable this
    way, since a partial fire always creates its own trade row)
  - every SL-reason exit lands exactly on the ORIGINAL, unmoved stop
    distance implied by the spec (proves breakeven/trailing never
    repositioned `sl`, without needing to add a counter to
    execution_tick.py)
"""
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))

from data_import import load_candles
from spec_engine.quant_lite_risk import quant_lite_risk_config
from spec_engine.execution_tick import run_spec_backtest_tick
from spec_engine.indicators import compute_all

SPECS = [
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


def verify_no_be_trailing(trades_df, df_signal, spec):
    """Recomputes each SL-reason trade's theoretical ORIGINAL sl distance
    (entry_atr_mult, using the ATR value at entry time) and checks the
    actual exit_price matches it exactly - if breakeven/trailing had
    repositioned the stop, the exit would land at a different price."""
    if trades_df.empty:
        return {"sl_trades_checked": 0, "sl_price_mismatches": 0}
    sig = compute_all(df_signal.copy(), spec["indicators"]).dropna().reset_index(drop=True)
    sig = sig.set_index(pd.to_datetime(sig["ts"]))
    sl_mult = spec["risk"]["sl_atr_mult"]
    atr_id = spec["risk"]["atr_id"]

    mismatches = 0
    checked = 0
    sl_trades = trades_df[trades_df["reason"] == "SL"]
    for _, t in sl_trades.iterrows():
        entry_ts = pd.Timestamp(t["entry_time"])
        idx = sig.index.searchsorted(entry_ts, side="right") - 1
        if idx < 0:
            continue
        atr_at_entry = sig.iloc[idx][atr_id]
        expected_sl_dist = atr_at_entry * sl_mult
        expected_sl_price = t["entry_price"] - t["direction"] * expected_sl_dist
        checked += 1
        if abs(expected_sl_price - t["exit_price"]) > 1e-6:
            mismatches += 1
    return {"sl_trades_checked": checked, "sl_price_mismatches": mismatches}


def run_once(spec, df_1h):
    risk = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
    trades_df, equity, stats = run_spec_backtest_tick(
        df_1h, spec, risk, zip_symbol="XAUUSD", csv_symbol="XAUUSD", years=["2024"],
    )
    partial_rows = int((trades_df["reason"] == "PARTIAL").sum()) if not trades_df.empty else 0
    be_check = verify_no_be_trailing(trades_df, df_1h, spec)
    return trades_df, stats, partial_rows, be_check


def main():
    df_1h = load_candles("XAUUSD", "1h")
    df_1h["ts"] = pd.to_datetime(df_1h["ts"], utc=True)
    df_2024 = df_1h[(df_1h["ts"] >= "2024-01-01") & (df_1h["ts"] < "2025-01-01")].reset_index(drop=True)

    for spec in SPECS:
        print(f"\n{'='*70}\n{spec['name']}\n{'='*70}")
        results = []
        for run_i in (1, 2):
            t0 = time.time()
            trades_df, stats, partial_rows, be_check = run_once(spec, df_2024)
            elapsed = time.time() - t0
            print(f"\n--- run {run_i} (elapsed {elapsed:.0f}s) ---")
            print(stats)
            print(f"partial_close_rows: {partial_rows}")
            print(f"breakeven/trailing check: {be_check}")
            results.append((stats, partial_rows, be_check))

        (s1, p1, b1), (s2, p2, b2) = results
        identical = (s1 == s2) and (p1 == p2) and (b1 == b2)
        print(f"\n--- determinism check: run1 == run2 ? {identical} ---")


if __name__ == "__main__":
    main()
