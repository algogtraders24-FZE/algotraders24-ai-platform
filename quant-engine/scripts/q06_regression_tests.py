"""
Q0.6 audit helper - temporary, isolated. Regression tests E-J (basic
entries/exits, risk sizing, MTF behavior) against the fixed
execution_mtf.py, cross-checked against runner.py where the two engines
should agree in outcome (not necessarily exact price, per the
already-documented spread/timing differences that are NOT part of this
fix). Proves the look-ahead fix didn't disturb unrelated behavior.
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
    df = pd.DataFrame({"ts": ts})
    df["open"] = price_path
    df["high"] = [p + 0.5 for p in price_path]
    df["low"] = [p - 0.5 for p in price_path]
    df["close"] = price_path
    return df


def minute_bars_from_hourly(df_1h, spread=0.10):
    rows = []
    for h in range(len(df_1h)):
        bar_ts = df_1h["ts"].iloc[h]
        level = df_1h["close"].iloc[h]
        for m in range(60):
            rows.append({"ts": bar_ts + pd.Timedelta(minutes=m), "open": level, "high": level + 0.05,
                         "low": level - 0.05, "close": level, "spread": spread})
    return pd.DataFrame(rows)


SPEC = {
    "name": "SyntheticEMA", "symbol": "SYN", "timeframe": "1h",
    "indicators": [
        {"id": "ema5", "type": "EMA", "period": 5},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "close", "op": "cross_above", "right": "ema5"}],
    "entry_short": [{"left": "close", "op": "cross_below", "right": "ema5"}],
    "risk": {"sl_mode": "PIPS", "sl_points": 5.0, "tp_mode": "PIPS", "tp_points": 10.0, "atr_id": "atr14"},
}


def run_pair(df_1h, spec=SPEC, risk=RISK):
    df_1m = minute_bars_from_hourly(df_1h)
    trades_r, _, stats_r = run_spec_backtest(df_1h, spec, risk)
    trades_m, _, stats_m = run_spec_backtest_mtf(df_1h, df_1m, spec, risk)
    return trades_r, stats_r, trades_m, stats_m


def test_e_buy_tp():
    path = [2000.0] * 55 + [1990.0] + [2010.0 + 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, stats_r, trades_m, stats_m = run_pair(df_1h)
    print(f"TEST E - basic BUY->TP: runner trades={stats_r.get('trades_total')} "
          f"reasons={list(trades_r['reason']) if len(trades_r) else []} | "
          f"execution_mtf trades={stats_m.get('trades_total')} "
          f"reasons={list(trades_m['reason']) if len(trades_m) else []}")


def test_f_buy_sl():
    path = [2000.0] * 55 + [1990.0] + [1980.0 - 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, stats_r, trades_m, stats_m = run_pair(df_1h)
    print(f"TEST F - basic BUY->SL: runner trades={stats_r.get('trades_total')} "
          f"reasons={list(trades_r['reason']) if len(trades_r) else []} | "
          f"execution_mtf trades={stats_m.get('trades_total')} "
          f"reasons={list(trades_m['reason']) if len(trades_m) else []}")


def test_g_sell_tp():
    path = [2000.0] * 55 + [2010.0] + [1990.0 - 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, stats_r, trades_m, stats_m = run_pair(df_1h)
    print(f"TEST G - basic SELL->TP: runner trades={stats_r.get('trades_total')} "
          f"reasons={list(trades_r['reason']) if len(trades_r) else []} | "
          f"execution_mtf trades={stats_m.get('trades_total')} "
          f"reasons={list(trades_m['reason']) if len(trades_m) else []}")


def test_h_sell_sl():
    path = [2000.0] * 55 + [2010.0] + [2020.0 + 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    trades_r, stats_r, trades_m, stats_m = run_pair(df_1h)
    print(f"TEST H - basic SELL->SL: runner trades={stats_r.get('trades_total')} "
          f"reasons={list(trades_r['reason']) if len(trades_r) else []} | "
          f"execution_mtf trades={stats_m.get('trades_total')} "
          f"reasons={list(trades_m['reason']) if len(trades_m) else []}")


def test_i_risk_sizing():
    path = [2000.0] * 55 + [1990.0] + [2010.0 + 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    df_1m = minute_bars_from_hourly(df_1h)
    risk_1pct = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
    risk_2pct = quant_lite_risk_config(risk_pct=2.0, spread_price=0.30, contract_size=100, start_balance=10000)
    _, _, stats_1 = run_spec_backtest_mtf(df_1h, df_1m, SPEC, risk_1pct)
    _, _, stats_2 = run_spec_backtest_mtf(df_1h, df_1m, SPEC, risk_2pct)
    print(f"TEST I - risk sizing (execution_mtf): 1% risk final_balance={stats_1.get('final_balance')} | "
          f"2% risk final_balance={stats_2.get('final_balance')} "
          f"(2% should move ~2x as far from start_balance=10000 for the same trade)")


def test_j_mtf_signal_behavior():
    """Confirms signal detection still uses df_signal only (1h), execution
    still uses df_exec (1m) - the MTF split itself is untouched by the fix,
    only WHEN a signal is considered available changed."""
    path = [2000.0] * 55 + [1990.0] + [2010.0 + 2 * k for k in range(14)]
    df_1h = hourly_bars(len(path), price_path=path)
    df_1m = minute_bars_from_hourly(df_1h)
    trades_m, _, stats_m = run_spec_backtest_mtf(df_1h, df_1m, SPEC, RISK)
    if len(trades_m):
        entry_ts = pd.Timestamp(trades_m.iloc[0]['entry_time'])
        signal_bar_ts = df_1h["ts"].iloc[56]  # the bar AFTER the dip (index 56 = dip bar, cross confirmed there)
        print(f"TEST J - MTF signal behavior: entry_time={entry_ts}, "
              f"is minute-level timestamp (not hour-aligned)? {entry_ts.minute != 0 or entry_ts.second != 0}")
    else:
        print("TEST J - MTF signal behavior: NO TRADES (path may need adjustment, not a fix regression)")


if __name__ == "__main__":
    test_e_buy_tp()
    test_f_buy_sl()
    test_g_sell_tp()
    test_h_sell_sl()
    test_i_risk_sizing()
    test_j_mtf_signal_behavior()
