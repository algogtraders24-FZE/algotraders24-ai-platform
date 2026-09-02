"""
Q1.1.23/24/25 - full-history 1m and 5m performance benchmark. Real runs
through the actual run_backtest_job.py runner (the same code path the API
uses), not a synthetic microbenchmark. No optimization is attempted, per
instruction - this only measures.

Memory: no psutil/resource module available in this environment (checked
- neither installed nor available on Windows respectively), so peak
working-set memory is sampled via periodic `tasklist` polling from a
background thread while the child process runs - a coarse, ~1s-resolution
measurement, not a precise profiler. Documented as such in
Q1.1_PERFORMANCE_BENCHMARK.md.

Uses EURUSD_EXNESS - the cleanest, most complete symbol (Q1.1's own gap
registry: ~97% coverage, only one ~13-day gap) - so measured runtime
reflects real engine/data-volume cost, not gap-related short-circuiting.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB_RUNNER = os.path.join(SCRIPT_DIR, "run_backtest_job.py")
SYMBOL = "EURUSD_EXNESS"
FULL_HISTORY_END = "2026-08-21"

MACD_SPEC = {
    "name": "MACD Crossover", "symbol": "EURUSD", "timeframe": "signal",
    "indicators": [
        {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
    "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}

WINDOWS = [
    ("1 month", "2024-07-01", "2024-08-01"),
    ("3 months", "2024-05-01", "2024-08-01"),
    ("6 months", "2024-02-01", "2024-08-01"),
    ("1 year", "2024-08-01", "2025-08-01"),
    ("full history", "2024-01-01", FULL_HISTORY_END),
]


def sample_peak_mem(pid, stop_event, samples):
    while not stop_event.is_set():
        try:
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=5)
            line = out.stdout.strip()
            if line and "No tasks" not in line:
                # CSV: "python.exe","<pid>","Console","1","123,456 K"
                parts = [p.strip('"') for p in line.split('","')]
                if len(parts) >= 5:
                    mem_str = parts[4].replace(" K", "").replace(",", "")
                    samples.append(int(mem_str))
        except Exception:
            pass
        time.sleep(0.5)


def run_benchmark(signal_tf, start, end):
    config = {
        "jobId": f"bench-{signal_tf}", "requestHash": "bench",
        "spec": {**MACD_SPEC, "timeframe": signal_tf},
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
        proc = subprocess.Popen([sys.executable, JOB_RUNNER, "--config", cfg_path, "--out", out_path])

        samples = []
        stop_event = threading.Event()
        sampler = threading.Thread(target=sample_peak_mem, args=(proc.pid, stop_event, samples), daemon=True)
        sampler.start()

        proc.wait()
        stop_event.set()
        sampler.join(timeout=2)
        elapsed = time.time() - t0

        t_serialize0 = time.time()
        with open(out_path) as f:
            result = json.load(f)
        serialize_time = time.time() - t_serialize0

        peak_mem_kb = max(samples) if samples else None
        return result, elapsed, peak_mem_kb, serialize_time


def main():
    all_results = []
    for tf in ("1m", "5m"):
        for label, start, end in WINDOWS:
            result, elapsed, peak_mem_kb, serialize_time = run_benchmark(tf, start, end)
            status = result.get("status")
            trades = result.get("stats", {}).get("trades_total") if status == "COMPLETED" else None
            err = result.get("errorCode") if status == "FAILED" else None
            peak_mem_mb = round(peak_mem_kb / 1024, 1) if peak_mem_kb else None
            row = {
                "timeframe": tf, "window": label, "start": start, "end": end,
                "status": status, "trades": trades, "errorCode": err,
                "elapsedSeconds": round(elapsed, 2),
                "peakMemoryMb": peak_mem_mb,
                "resultReadSeconds": round(serialize_time, 4),
            }
            all_results.append(row)
            print(f"{tf:3s} {label:14s} status={status} trades={trades} elapsed={elapsed:6.1f}s peakMem={peak_mem_mb}MB err={err}")

    out_path = os.path.join(SCRIPT_DIR, "..", "output", "q11_performance_benchmark.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    main()
