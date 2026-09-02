"""
Q1.3 Part 1 - intermediate performance benchmark. Q1.1 measured 1-year
(39.9s/42.3s, NORMAL) and full-history ~2.6yr (81.6s/70.0s, SLOW) for
1m/5m on EURUSD_EXNESS - this fills the gap with an 18-month window to
narrow exactly where the NORMAL/SLOW crossover sits, rather than leaving
it pinned to "the last measured NORMAL point" (Q1.2's own documented
limitation). Same symbol/strategy as Q1.1 for a like-for-like comparison.
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

# 18 months - the midpoint between Q1.1's 1-year (NORMAL) and full-history
# (~2.6yr, SLOW) measured points.
WINDOWS = [("18 months", "2024-02-01", "2025-08-01")]


def sample_peak_mem(pid, stop_event, samples):
    while not stop_event.is_set():
        try:
            out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=5)
            line = out.stdout.strip()
            if line and "No tasks" not in line:
                parts = [p.strip('"') for p in line.split('","')]
                if len(parts) >= 5:
                    mem_str = parts[4].replace(" K", "").replace(",", "")
                    samples.append(int(mem_str))
        except Exception:
            pass
        time.sleep(0.5)


def run_benchmark(signal_tf, start, end):
    config = {
        "jobId": f"q13-bench-{signal_tf}", "requestHash": "q13-bench",
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

        with open(out_path) as f:
            result = json.load(f)
        peak_mem_kb = max(samples) if samples else None
        return result, elapsed, peak_mem_kb


def main():
    all_results = []
    for tf in ("1m", "5m"):
        for label, start, end in WINDOWS:
            result, elapsed, peak_mem_kb = run_benchmark(tf, start, end)
            status = result.get("status")
            trades = result.get("stats", {}).get("trades_total") if status == "COMPLETED" else None
            peak_mem_mb = round(peak_mem_kb / 1024, 1) if peak_mem_kb else None
            row = {"timeframe": tf, "window": label, "start": start, "end": end, "status": status, "trades": trades, "elapsedSeconds": round(elapsed, 2), "peakMemoryMb": peak_mem_mb}
            all_results.append(row)
            print(f"{tf:3s} {label:10s} status={status} trades={trades} elapsed={elapsed:6.1f}s peakMem={peak_mem_mb}MB")

    out_path = os.path.join(SCRIPT_DIR, "..", "output", "q13_intermediate_benchmark.json")
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    main()
