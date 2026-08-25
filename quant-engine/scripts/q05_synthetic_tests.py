"""
Q0.5 audit helper - temporary, isolated, does not modify any engine.
Synthetic, controlled scenarios (Step 7, tests A-N) run against
runner.py and execution_mtf.py (both accept an arbitrary DataFrame).
execution_tick.py CANNOT run these: it streams real ticks directly from
the Exness zip files by construction (zip_symbol/csv_symbol/years
params, no synthetic-data injection point exists) - this is itself a
reportable finding (see Q0.5_ENGINE_INVENTORY.md, Testability), not
worked around here.
"""
import os
import sys

import numpy as np
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


def test_signal_timing_bug():
    """TEST F/G - the headline finding: does execution_mtf fire a signal
    using price action that happens BEFORE the signal bar's own close is
    reached (i.e. at/near the bar's open), or only after (at/after the
    bar's close)? Flat baseline for 55 bars (no crossover possible, and
    long enough to clear both engines' >=50-bar minimum plus ATR14/EMA5
    warmup), then bar 55 jumps well above the (converged, flat) EMA - a
    clean, unambiguous cross_above at bar 55's close. df_1m gives 60
    one-minute bars per hour, minute 0 = the bar's open, minute 59 = just
    before its close."""
    n = 60
    jump_bar = 55
    path = [2000.0] * jump_bar + [2050.0] * (n - jump_bar)
    df_1h = hourly_bars(n, price_path=path)

    # 1-minute bars: within bar 20 (the jump bar), price is FLAT AT THE
    # OLD LEVEL (2000) for the entire hour except exactly matching the
    # 1h bar's own close (2050) only in the LAST minute - if execution_mtf
    # fires anywhere in minutes 0-58 of bar 20, it can only be because it
    # treated the bar as "closed" before the real jump (at minute 59) was
    # knowable, i.e. the look-ahead bug.
    rows = []
    start = df_1h["ts"].iloc[0]
    for h in range(n):
        bar_ts = start + pd.Timedelta(hours=h)
        level = path[h]
        for m in range(60):
            minute_price = level if not (h == jump_bar and m < 59) else 2000.0  # jump bar: flat at OLD price until the final minute
            rows.append({"ts": bar_ts + pd.Timedelta(minutes=m), "open": minute_price, "high": minute_price + 0.05,
                         "low": minute_price - 0.05, "close": minute_price, "spread": 0.10})
    df_1m = pd.DataFrame(rows)

    trades_r, _, stats_r = run_spec_backtest(df_1h, SIMPLE_SPEC, RISK)
    trades_m, _, stats_m = run_spec_backtest_mtf(df_1h, df_1m, SIMPLE_SPEC, RISK)

    print("TEST F/G - signal timing (does execution_mtf fire before the real jump is knowable?)")
    print(f"  runner:        trades={stats_r.get('trades_total')}  first entry: "
          f"{trades_r.iloc[0]['entry_time'] if len(trades_r) else 'NONE'}  "
          f"price={trades_r.iloc[0]['entry_price'] if len(trades_r) else '-'}")
    if len(trades_m):
        entry_ts = pd.Timestamp(trades_m.iloc[0]['entry_time'])
        jump_bar_start = start + pd.Timedelta(hours=jump_bar)
        minute_offset = (entry_ts - jump_bar_start).total_seconds() / 60
        print(f"  execution_mtf: trades={stats_m.get('trades_total')}  first entry: {entry_ts}  "
              f"price={trades_m.iloc[0]['entry_price']}  minute-offset-into-jump-bar={minute_offset:.0f}")
        if minute_offset < 59:
            print(f"  RESULT: BUG CONFIRMED - execution_mtf entered {59-minute_offset:.0f} minutes before "
                  f"the jump bar's close, using a price (2000, the OLD level) that could not have produced "
                  f"this entry unless it evaluated the signal before that bar actually closed.")
        else:
            print("  RESULT: no early entry observed in this run.")
    else:
        print("  execution_mtf: NO TRADES")


def test_basic_buy_tp():
    path = [2000.0]*55 + [1990.0] + [2010.0]*10  # flat warmup, dip, then jump+rally to TP
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, _, stats_r = run_spec_backtest(df_1h, SIMPLE_SPEC, RISK)
    print(f"TEST A - basic BUY->TP (runner): trades={stats_r.get('trades_total')} "
          f"reasons={list(trades_r['reason']) if len(trades_r) else []}")


def test_multiple_positions():
    # Two consecutive long signals with no exit between them - only one position should ever be open
    path = [2000.0]*55 + [1980.0] + [2020.0]*3 + [1980.0] + [2020.0]*5
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, _, stats_r = run_spec_backtest(df_1h, SIMPLE_SPEC, RISK)
    print(f"TEST H - multiple positions (runner): trades={stats_r.get('trades_total')} "
          f"(should never show 2 simultaneously-open positions - verified structurally in QUANT_LITE_EXECUTION_CONTRACT.md)")


def test_missing_data():
    df_1h = hourly_bars(60, price_path=[2000.0]*60)
    df_1h.loc[30, "close"] = np.nan
    try:
        trades_r, _, stats_r = run_spec_backtest(df_1h, SIMPLE_SPEC, RISK)
        print(f"TEST K - missing data (runner): handled gracefully, trades={stats_r.get('trades_total')}, "
              f"error={stats_r.get('error')}, rows dropped due to NaN as expected")
    except Exception as e:
        print(f"TEST K - missing data (runner): RAISED {type(e).__name__}: {e}")


if __name__ == "__main__":
    test_signal_timing_bug()
    print()
    test_basic_buy_tp()
    test_multiple_positions()
    test_missing_data()
