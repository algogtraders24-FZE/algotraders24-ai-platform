"""
Q1.0 Part 4 - real engine compatibility + determinism sweep across
candidate SYMBOLS, at the one signal timeframe already proven end-to-end
in Q0.9 (1h). Two independent strategies (EMA20/50, RSI14) per symbol,
each run twice for determinism, via the real run_backtest_job.py runner.

Also confirms the two legacy (non-_EXNESS) symbols are correctly
DATA_INSUFFICIENT (they have no 1-minute execution data at all - a fact
already established in the Q1.0 coverage audit, re-confirmed here via a
live run to prove the failure path, not just the missing-data inference).
"""
import json
import os
import subprocess
import sys
import tempfile
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB_RUNNER = os.path.join(SCRIPT_DIR, "run_backtest_job.py")

EMA_SPEC = {
    "name": "EMA20/EMA50 Crossover", "symbol": "SYM", "timeframe": "1h",
    "indicators": [
        {"id": "ema20", "type": "EMA", "period": 20},
        {"id": "ema50", "type": "EMA", "period": 50},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "ema20", "op": "cross_above", "right": "ema50"}],
    "entry_short": [{"left": "ema20", "op": "cross_below", "right": "ema50"}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}

RSI_SPEC = {
    "name": "RSI14 Oversold/Overbought", "symbol": "SYM", "timeframe": "1h",
    "indicators": [
        {"id": "rsi14", "type": "RSI", "period": 14},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "rsi14", "op": "<", "right": 30}],
    "entry_short": [{"left": "rsi14", "op": ">", "right": 70}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}

# (dbSymbol, start, end, expect_data) - real coverage-informed windows
CANDIDATES = [
    ("XAUUSD_EXNESS", "2024-01-01", "2024-12-31", True),      # already proven Q0.9 - re-confirmed here
    ("EURUSD_EXNESS", "2024-01-01", "2024-12-31", True),      # proven in Q0.9 concurrency test
    ("GBPUSD_EXNESS", "2024-01-01", "2024-12-31", True),      # proven in Q0.9 concurrency test
    ("USOIL_EXNESS", "2024-01-01", "2024-12-31", True),       # new
    ("BTCUSD_EXNESS", "2024-01-01", "2024-12-31", True),      # new
    ("XAUUSD_ZS_EXNESS", "2024-01-01", "2024-12-31", True),   # new
    ("XAUUSD", "2024-01-01", "2024-12-31", False),            # legacy, no 1m data - must fail cleanly
    ("EURUSD", "2015-01-01", "2015-12-31", False),            # legacy, no 1m data - must fail cleanly
]


def run_job(spec, db_symbol, start, end):
    config = {
        "jobId": f"q10-{db_symbol}", "requestHash": "q10-symbol-sweep",
        "spec": spec, "dbSymbol": db_symbol, "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": start, "endDate": end,
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    }
    with tempfile.TemporaryDirectory() as td:
        cfg_path = os.path.join(td, "config.json")
        out_path = os.path.join(td, "out.json")
        with open(cfg_path, "w") as f:
            json.dump(config, f)
        t0 = time.time()
        subprocess.run([sys.executable, JOB_RUNNER, "--config", cfg_path, "--out", out_path])
        elapsed = time.time() - t0
        with open(out_path) as f:
            result = json.load(f)
        return result, elapsed


def main():
    all_results = []
    for db_symbol, start, end, expect_data in CANDIDATES:
        for spec_name, spec in [("EMA", EMA_SPEC), ("RSI", RSI_SPEC)]:
            r1, t1 = run_job(spec, db_symbol, start, end)
            r2, t2 = run_job(spec, db_symbol, start, end)

            status1, status2 = r1.get("status"), r2.get("status")
            deterministic = (
                status1 == "COMPLETED" and status2 == "COMPLETED"
                and r1.get("stats") == r2.get("stats")
                and json.dumps(r1.get("trades")) == json.dumps(r2.get("trades"))
            )
            trades = r1.get("stats", {}).get("trades_total") if status1 == "COMPLETED" else None
            err = r1.get("errorCode") if status1 == "FAILED" else None

            row = {
                "symbol": db_symbol, "strategy": spec_name, "expect_data": expect_data,
                "run1_status": status1, "run2_status": status2, "deterministic": deterministic,
                "trades_total": trades, "error_code": err,
                "run1_elapsed_s": round(t1, 2),
            }
            all_results.append(row)
            ok = (status1 == "COMPLETED") == expect_data
            print(f"{db_symbol:20s} {spec_name:4s} status={status1}({t1:.1f}s) trades={trades} "
                  f"deterministic={deterministic} err={err}  {'OK' if ok else 'UNEXPECTED'}")

    out_path = os.path.join(SCRIPT_DIR, "..", "output", "q10_symbol_sweep.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    main()
