"""
Q0.6 audit helper - temporary, isolated, no engine semantics changed by
this script itself. Reruns the EXACT Q0.5 methodology (same specs, same
symbol/year, same quant_lite_risk_config, same 2-runs-for-determinism
structure) now that execution_mtf.py's look-ahead bug is fixed, for a
direct, apples-to-apples before/after comparison against Q0.5's own
recorded numbers. runner.py and execution_tick.py are unchanged since
Q0.5, so their results here serve as a consistency check (should be
identical to Q0.5's) while execution_mtf.py's results are the ones this
sprint is actually testing.
"""
import json
import os
import sys
import time

import pandas as pd
import sqlite3

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))

from spec_engine.quant_lite_risk import quant_lite_risk_config
from spec_engine.runner import run_spec_backtest
from spec_engine.execution_mtf import run_spec_backtest_mtf
from spec_engine.execution_tick import run_spec_backtest_tick

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output", "q06")
os.makedirs(OUT_DIR, exist_ok=True)

SYMBOL = "XAUUSD_EXNESS"
YEAR = "2024"

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


def load(symbol, timeframe, with_spread=False):
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
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


def stats_only(d):
    return {k: v for k, v in d.items()}


def trades_to_records(trades_df):
    if trades_df is None or trades_df.empty:
        return []
    d = trades_df.copy()
    for col in ("entry_time", "exit_time"):
        if col in d.columns:
            d[col] = d[col].astype(str)
    return d.to_dict("records")


def run_engine(engine_name, spec, df_1h, df_1m):
    if engine_name == "runner":
        risk = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
        trades_df, equity, stats = run_spec_backtest(df_1h, spec, risk)
    elif engine_name == "execution_mtf":
        risk = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
        trades_df, equity, stats = run_spec_backtest_mtf(df_1h, df_1m, spec, risk)
    elif engine_name == "execution_tick":
        risk = quant_lite_risk_config(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)
        trades_df, equity, stats = run_spec_backtest_tick(
            df_1h, spec, risk, zip_symbol="XAUUSD", csv_symbol="XAUUSD", years=[YEAR],
        )
    else:
        raise ValueError(engine_name)
    return trades_df, stats


def main():
    df_1h_full = load(SYMBOL, "1h")
    df_1m_full = load(SYMBOL, "1m", with_spread=True)
    df_1h = df_1h_full[(df_1h_full["ts"] >= f"{YEAR}-01-01") & (df_1h_full["ts"] < f"{int(YEAR)+1}-01-01")].reset_index(drop=True)
    df_1m = df_1m_full[(df_1m_full["ts"] >= f"{YEAR}-01-01") & (df_1m_full["ts"] < f"{int(YEAR)+1}-01-01")].reset_index(drop=True)
    print(f"df_1h rows: {len(df_1h)}  df_1m rows: {len(df_1m)}  symbol: {SYMBOL}  year: {YEAR}")

    summary = {}
    for spec in SPECS:
        spec_key = spec["name"].replace(" ", "_")
        summary[spec_key] = {}
        for engine_name in ("runner", "execution_mtf", "execution_tick"):
            runs = []
            for run_i in (1, 2):
                t0 = time.time()
                trades_df, stats = run_engine(engine_name, spec, df_1h, df_1m)
                elapsed = time.time() - t0
                print(f"\n[{spec['name']} | {engine_name} | run {run_i}] elapsed={elapsed:.0f}s")
                print(stats)
                runs.append({"stats": stats_only(stats), "trades": trades_to_records(trades_df), "elapsed_s": elapsed})
                # save ledger for run 1 only (run 2 saved separately for determinism diff)
                out_path = os.path.join(OUT_DIR, f"{spec_key}__{engine_name}__run{run_i}.json")
                with open(out_path, "w") as f:
                    json.dump(runs[-1], f, indent=2, default=str)
            identical = (runs[0]["stats"] == runs[1]["stats"]) and (runs[0]["trades"] == runs[1]["trades"])
            print(f"[{spec['name']} | {engine_name}] determinism (run1==run2): {identical}")
            summary[spec_key][engine_name] = {
                "run1_stats": runs[0]["stats"],
                "deterministic": identical,
                "trade_count": len(runs[0]["trades"]),
            }

    summary_path = os.path.join(OUT_DIR, "q05_summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nSummary written: {summary_path}")


if __name__ == "__main__":
    main()
