"""
Q0.9 automated regression test for the real execution adapter
(run_backtest_job.py). Same convention as q06_regression_tests.py /
q06_lookahead_test.py - plain assertions + PASS/FAIL prints, no test
framework (none exists in this repo). Run from anywhere:

    python quant-engine/scripts/q09_regression_test.py

Exits 0 if every test passes, 1 otherwise (so it can gate CI later).
"""
import json
import os
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
JOB_RUNNER = os.path.join(SCRIPT_DIR, "run_backtest_job.py")

PASS = []
FAIL = []


def run_job(config: dict) -> dict:
    with tempfile.TemporaryDirectory() as td:
        cfg_path = os.path.join(td, "config.json")
        out_path = os.path.join(td, "out.json")
        with open(cfg_path, "w") as f:
            json.dump(config, f)
        subprocess.run([sys.executable, JOB_RUNNER, "--config", cfg_path, "--out", out_path])
        with open(out_path) as f:
            return json.load(f)


def check(name, condition, detail=""):
    if condition:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}  {detail}")


MACD_SPEC = {
    "name": "MACD Crossover", "symbol": "XAUUSD", "timeframe": "1h",
    "indicators": [
        {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
    "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}


def test_macd_regression_matches_q06():
    """Q0.9.29 - must reproduce Q0.6's own known-good MACD numbers exactly."""
    result = run_job({
        "jobId": "test-macd", "requestHash": "test",
        "spec": MACD_SPEC, "dbSymbol": "XAUUSD_EXNESS",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2024-01-01", "endDate": "2024-12-31",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    })
    check("macd_regression.status_completed", result.get("status") == "COMPLETED", result)
    if result.get("status") != "COMPLETED":
        return
    stats = result["stats"]
    expected = {
        "trades_total": 208, "win_rate_pct": 43.75, "profit_factor": 1.15,
        "total_return_pct": 19.61, "max_drawdown_pct": -10.42, "final_balance": 11961.23,
    }
    for key, exp_val in expected.items():
        check(f"macd_regression.{key}", stats.get(key) == exp_val, f"got {stats.get(key)}, expected {exp_val}")
    check("macd_regression.trade_count", len(result["trades"]) == 208, len(result["trades"]))
    if result["trades"]:
        t0 = result["trades"][0]
        check("macd_regression.first_trade_entry_time", t0["entryTime"] == "2024-01-02 01:00:00+00:00", t0["entryTime"])
        check("macd_regression.first_trade_entry_price", abs(t0["entryPrice"] - 2065.23265625) < 1e-6, t0["entryPrice"])


def test_new_strategy_end_to_end():
    """Q0.9.28 - a strategy that has never run before must produce a real result, not a canned one."""
    spec = {
        "name": "EMA20/EMA50 Crossover", "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "ema20", "type": "EMA", "period": 20},
            {"id": "ema50", "type": "EMA", "period": 50},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "ema20", "op": "cross_above", "right": "ema50"}],
        "entry_short": [{"left": "ema20", "op": "cross_below", "right": "ema50"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    }
    result = run_job({
        "jobId": "test-ema", "requestHash": "test",
        "spec": spec, "dbSymbol": "XAUUSD_EXNESS",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2024-06-01", "endDate": "2024-12-31",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    })
    check("new_strategy.status_completed", result.get("status") == "COMPLETED", result)
    check("new_strategy.has_real_trades", result.get("status") == "COMPLETED" and result["stats"]["trades_total"] > 0, result.get("stats"))


def test_data_unavailable():
    """Q0.9.30 - a date range with no data must fail cleanly, never fabricate a result."""
    result = run_job({
        "jobId": "test-baddate", "requestHash": "test",
        "spec": MACD_SPEC, "dbSymbol": "XAUUSD_EXNESS",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2019-01-01", "endDate": "2019-06-01",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    })
    check("data_unavailable.status_failed", result.get("status") == "FAILED", result)
    check("data_unavailable.error_code", result.get("errorCode") == "DATA_UNAVAILABLE", result.get("errorCode"))


def test_invalid_strategy():
    """Q0.9.31 - a malformed spec must be rejected before the engine ever runs."""
    bad_spec = {
        "name": "Broken", "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [{"id": "x1", "type": "NOT_A_REAL_INDICATOR"}],
        "entry_long": [{"left": "x1", "op": "not_a_real_op", "right": 0}],
        "entry_short": [],
        "risk": {"sl_mode": "ATR", "tp_mode": "ATR"},
    }
    result = run_job({
        "jobId": "test-badspec", "requestHash": "test",
        "spec": bad_spec, "dbSymbol": "XAUUSD_EXNESS",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2024-01-01", "endDate": "2024-03-01",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    })
    check("invalid_strategy.status_failed", result.get("status") == "FAILED", result)
    check("invalid_strategy.error_code", result.get("errorCode") == "INVALID_STRATEGY", result.get("errorCode"))
    check("invalid_strategy.has_details", len(result.get("details", [])) >= 3, result.get("details"))


def test_unsupported_symbol():
    """Symbols without 1-minute data must be rejected, not silently degraded."""
    result = run_job({
        "jobId": "test-badsymbol", "requestHash": "test",
        "spec": MACD_SPEC, "dbSymbol": "SOME_UNKNOWN_SYMBOL",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2024-01-01", "endDate": "2024-03-01",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    })
    check("unsupported_symbol.status_failed", result.get("status") == "FAILED", result)
    check("unsupported_symbol.error_code", result.get("errorCode") == "DATA_UNAVAILABLE", result.get("errorCode"))


def test_determinism():
    """Same config run twice must produce identical stats and trades (Q0.9.7's determinism premise)."""
    config = {
        "jobId": "test-det", "requestHash": "test",
        "spec": MACD_SPEC, "dbSymbol": "XAUUSD_EXNESS",
        "signalTimeframe": "1h", "execTimeframe": "1m",
        "startDate": "2024-01-01", "endDate": "2024-03-01",
        "initialCapital": 10000, "riskPct": 1.0, "spreadPrice": 0.30, "contractSize": 100,
    }
    r1 = run_job(config)
    r2 = run_job(config)
    check("determinism.both_completed", r1.get("status") == "COMPLETED" and r2.get("status") == "COMPLETED")
    check("determinism.stats_identical", r1.get("stats") == r2.get("stats"), (r1.get("stats"), r2.get("stats")))
    check("determinism.trades_identical",
          json.dumps(r1.get("trades")) == json.dumps(r2.get("trades")))


if __name__ == "__main__":
    test_macd_regression_matches_q06()
    test_new_strategy_end_to_end()
    test_data_unavailable()
    test_invalid_strategy()
    test_unsupported_symbol()
    test_determinism()

    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    sys.exit(1 if FAIL else 0)
