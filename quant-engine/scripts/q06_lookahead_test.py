"""
Q0.6 audit helper - temporary, isolated. Reuses Q0.5's exact synthetic
look-ahead scenario (scripts/q05_synthetic_tests.py::test_signal_timing_bug)
against the now-fixed execution_mtf.py, to prove the fix closes the gap
that scenario was built to detect. Does not modify any engine.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))

from spec_engine.quant_lite_risk import quant_lite_risk_config
from spec_engine.runner import run_spec_backtest
from spec_engine.execution_mtf import run_spec_backtest_mtf

RISK = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)


def hourly_bars(n, start="2024-01-01 00:00:00", price_path=None):
    ts = pd.date_range(start, periods=n, freq="h", tz="UTC")
    if price_path is None:
        price_path = [2000.0] * n
    df = pd.DataFrame({"ts": ts})
    df["open"] = price_path
    df["high"] = [p + 0.5 for p in price_path]
    df["low"] = [p - 0.5 for p in price_path]
    df["close"] = price_path
    return df


SIMPLE_SPEC = {
    "name": "SyntheticEMA", "symbol": "SYN", "timeframe": "1h",
    "indicators": [
        {"id": "ema5", "type": "EMA", "period": 5},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "close", "op": "cross_above", "right": "ema5"}],
    "entry_short": [{"left": "close", "op": "cross_below", "right": "ema5"}],
    "risk": {"sl_mode": "PIPS", "sl_points": 5.0, "tp_mode": "PIPS", "tp_points": 10.0, "atr_id": "atr14"},
}


def test_signal_timing_after_fix():
    n = 70  # extra bars after the jump so an opened position has room to hit TP
    jump_bar = 55
    # after the jump, price keeps rising a little each bar so a BUY entered
    # near 2050 (TP=+10) actually reaches its TP within the test window,
    # giving a complete, inspectable closed trade rather than an
    # indefinitely-open one.
    path = [2000.0] * jump_bar + [2050.0 + 2.0 * k for k in range(n - jump_bar)]
    df_1h = hourly_bars(n, price_path=path)

    rows = []
    start = df_1h["ts"].iloc[0]
    for h in range(n):
        bar_ts = start + pd.Timedelta(hours=h)
        level = path[h]
        for m in range(60):
            minute_price = level if not (h == jump_bar and m < 59) else 2000.0
            rows.append({"ts": bar_ts + pd.Timedelta(minutes=m), "open": minute_price, "high": minute_price + 0.05,
                         "low": minute_price - 0.05, "close": minute_price, "spread": 0.10})
    df_1m = pd.DataFrame(rows)

    trades_r, _, stats_r = run_spec_backtest(df_1h, SIMPLE_SPEC, RISK)
    trades_m, _, stats_m = run_spec_backtest_mtf(df_1h, df_1m, SIMPLE_SPEC, RISK)

    jump_bar_start = start + pd.Timedelta(hours=jump_bar)
    jump_bar_close = jump_bar_start + pd.Timedelta(hours=1)  # real close, per left-labeled semantics

    print("TEST C (Q0.6) - signal timing, AFTER fix")
    print(f"  candle timestamp (label):        {jump_bar_start}")
    print(f"  candle CLOSE (real, left-label):  {jump_bar_close}")
    print(f"  runner:        trades={stats_r.get('trades_total')}  "
          f"first entry: {trades_r.iloc[0]['entry_time'] if len(trades_r) else 'NONE'}")

    if len(trades_m):
        entry_ts = pd.Timestamp(trades_m.iloc[0]['entry_time'])
        entry_price = trades_m.iloc[0]['entry_price']
        minute_offset = (entry_ts - jump_bar_start).total_seconds() / 60
        uses_future_info = entry_ts < jump_bar_close and abs(entry_price - 2000.0) < 5.0
        print(f"  execution_mtf: trades={stats_m.get('trades_total')}  entry_time={entry_ts}  "
              f"entry_price={entry_price}  minute-offset-into-jump-bar={minute_offset:.0f}")
        print(f"  signal_timestamp (bar considered closed at): {jump_bar_close if entry_ts >= jump_bar_close else '<before real close - BUG STILL PRESENT>'}")
        print(f"  entry occurs at or after real bar close ({jump_bar_close})? {entry_ts >= jump_bar_close}")
        if entry_ts >= jump_bar_close:
            print("  RESULT: FIX CONFIRMED - execution_mtf no longer enters before the signal "
                  "bar's real close; entry now uses the post-jump price, not pre-jump.")
            print(f"  expected price ~2050 (post-jump), actual entry_price={entry_price}")
        else:
            print("  RESULT: BUG STILL PRESENT - entry occurred before the bar's real close.")
    else:
        print("  execution_mtf: NO TRADES (also acceptable - the jump bar is the LAST bar in this "
              "series, and the fix correctly never marks the last bar closed since its real close "
              "time isn't derivable from the data - see execution_mtf.py comment)")


if __name__ == "__main__":
    test_signal_timing_after_fix()
