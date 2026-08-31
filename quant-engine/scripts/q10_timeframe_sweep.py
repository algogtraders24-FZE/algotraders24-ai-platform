"""
Q1.0 Parts 2/3/7/9 - real engine compatibility + determinism + runtime
sweep across candidate SIGNAL timeframes, on one representative symbol
(XAUUSD_EXNESS - the most-audited symbol from Q0.5/Q0.6/Q0.9). Execution
timeframe is always 1m (the only granularity execution_mtf.py's real
minute-replay design is built for - see Q0.9_EXISTING_EXECUTION_PATH.md).

Runs two independent, deterministic strategies (EMA20/50 crossover, RSI14
oversold/overbought) per candidate timeframe, twice each (determinism),
via the real run_backtest_job.py runner - the exact same code path the
API uses, not a separate test harness.

A representative (not full-history) window is used per timeframe tier to
keep total runtime tractable - this is a coverage/compatibility sweep,
not a performance-maximizing run; Part 7 records real elapsed time for
each so slow tiers can be marked PERFORMANCE-LIMITED rather than silently
accepted.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB_RUNNER = os.path.join(SCRIPT_DIR, "run_backtest_job.py")
SYMBOL = "XAUUSD_EXNESS"

EMA_SPEC = {
    "name": "EMA20/EMA50 Crossover", "symbol": "XAUUSD", "timeframe": "signal",
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
    "name": "RSI14 Oversold/Overbought", "symbol": "XAUUSD", "timeframe": "signal",
    "indicators": [
        {"id": "rsi14", "type": "RSI", "period": 14},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "rsi14", "op": "<", "right": 30}],
    "entry_short": [{"left": "rsi14", "op": ">", "right": 70}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}

# (signal_timeframe, start, end) - windows sized so each tier has enough
# bars to be meaningful without making the sweep impractically slow.
TIMEFRAME_WINDOWS = [
    ("1m",  "2024-01-01", "2024-01-15"),   # 2 weeks
    ("5m",  "2024-01-01", "2024-02-01"),   # 1 month
    ("15m", "2024-01-01", "2024-04-01"),   # 3 months
    ("30m", "2024-01-01", "2024-06-01"),   # 5 months
    ("1h",  "2024-01-01", "2024-12-31"),   # full year - already proven in Q0.9, re-run here for a consistent record
    ("4h",  "2024-01-01", "2025-12-31"),   # 2 years
    ("1d",  "2024-01-01", "2026-05-31"),   # full available range
]


def run_job(spec, signal_tf, start, end):
    config = {
        "jobId": f"q10-{signal_tf}", "requestHash": "q10-sweep",
        "spec": {**spec, "timeframe": signal_tf},
        "dbSymbol": SYMBOL, "signalTimeframe": signal_tf, "execTimeframe": "1m",
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
    for signal_tf, start, end in TIMEFRAME_WINDOWS:
        for spec_name, spec in [("EMA", EMA_SPEC), ("RSI", RSI_SPEC)]:
            r1, t1 = run_job(spec, signal_tf, start, end)
            r2, t2 = run_job(spec, signal_tf, start, end)

            status1 = r1.get("status")
            status2 = r2.get("status")
            deterministic = (
                status1 == "COMPLETED" and status2 == "COMPLETED"
                and r1.get("stats") == r2.get("stats")
                and json.dumps(r1.get("trades")) == json.dumps(r2.get("trades"))
            )
            trades = r1.get("stats", {}).get("trades_total") if status1 == "COMPLETED" else None
            err = r1.get("errorCode") if status1 == "FAILED" else None

            row = {
                "symbol": SYMBOL, "signal_timeframe": signal_tf, "strategy": spec_name,
                "window": f"{start} to {end}",
                "run1_status": status1, "run2_status": status2,
                "deterministic": deterministic,
                "trades_total": trades, "error_code": err,
                "run1_elapsed_s": round(t1, 2), "run2_elapsed_s": round(t2, 2),
            }
            all_results.append(row)
            print(f"{signal_tf:5s} {spec_name:4s} run1={status1}({t1:.1f}s) run2={status2}({t2:.1f}s) "
                  f"trades={trades} deterministic={deterministic} err={err}")

    out_path = os.path.join(SCRIPT_DIR, "..", "output", "q10_timeframe_sweep.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    main()
