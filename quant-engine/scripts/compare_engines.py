"""
Runs the same specs through both backtest engines on the SAME real Exness
XAUUSD data and prints both results side by side:
  - spec_engine.runner.run_spec_backtest        (original: single-timeframe,
    static spread, coarse same-bar SL/TP)
  - spec_engine.execution_mtf.run_spec_backtest_mtf (new: 1h signals, 1m
    execution replay, real time-varying spread)

This is the concrete "did the upgrade actually change anything" check -
if the two engines agree closely, the coarse engine was already fine for
this data; if they diverge, that's exactly the execution-realism gap the
new engine exists to close, made visible rather than assumed.
"""
import os
import sys

import pandas as pd
import sqlite3

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))

from engine import RiskConfig  # noqa: E402
from spec_engine.runner import run_spec_backtest  # noqa: E402
from spec_engine.execution_mtf import run_spec_backtest_mtf  # noqa: E402

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")
SYMBOL = "XAUUSD_EXNESS"


def load(symbol, timeframe, with_spread=False):
    conn = sqlite3.connect(DB_PATH)
    if with_spread:
        df = pd.read_sql_query(
            "SELECT c.ts,c.open,c.high,c.low,c.close,s.avg_spread AS spread "
            "FROM candles c LEFT JOIN candle_spread s "
            "ON s.symbol=c.symbol AND s.timeframe=c.timeframe AND s.ts=c.ts "
            "WHERE c.symbol=? AND c.timeframe=? ORDER BY c.ts",
            conn, params=(symbol, timeframe),
        )
    else:
        df = pd.read_sql_query(
            "SELECT ts,open,high,low,close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
            conn, params=(symbol, timeframe),
        )
    conn.close()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df


SPECS = [
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
    df_1h = load(SYMBOL, "1h")
    df_1m = load(SYMBOL, "1m", with_spread=True)
    print(f"Loaded {len(df_1h)} {SYMBOL} 1h bars, {len(df_1m)} 1m bars "
          f"({df_1h['ts'].min()} -> {df_1h['ts'].max()})\n")

    risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)

    rows = []
    for spec in SPECS:
        _, _, old_m = run_spec_backtest(df_1h, spec, risk)
        _, _, new_m = run_spec_backtest_mtf(df_1h, df_1m, spec, risk)
        rows.append({
            "spec": spec["name"],
            "old_trades": old_m.get("trades_total"), "new_trades": new_m.get("trades_total"),
            "old_pf": old_m.get("profit_factor"), "new_pf": new_m.get("profit_factor"),
            "old_return_pct": old_m.get("total_return_pct"), "new_return_pct": new_m.get("total_return_pct"),
            "old_max_dd_pct": old_m.get("max_drawdown_pct"), "new_max_dd_pct": new_m.get("max_drawdown_pct"),
            "same_minute_sl_tp_conflicts": new_m.get("same_minute_sl_tp_conflicts"),
        })
        print(f"=== {spec['name']} ===")
        print(f"  OLD (1h-only, static spread):  trades={old_m.get('trades_total')} "
              f"pf={old_m.get('profit_factor')} return={old_m.get('total_return_pct')}% "
              f"max_dd={old_m.get('max_drawdown_pct')}% account_blown={old_m.get('account_blown')}")
        print(f"  NEW (1m replay, real spread):  trades={new_m.get('trades_total')} "
              f"pf={new_m.get('profit_factor')} return={new_m.get('total_return_pct')}% "
              f"max_dd={new_m.get('max_drawdown_pct')}% account_blown={new_m.get('account_blown')} "
              f"same-minute SL+TP conflicts={new_m.get('same_minute_sl_tp_conflicts')}")
        print()

    out = pd.DataFrame(rows)
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", "engine_comparison.json")
    out.to_json(out_path, orient="records", indent=2)
    print(f"Comparison written: {out_path}")


if __name__ == "__main__":
    main()
