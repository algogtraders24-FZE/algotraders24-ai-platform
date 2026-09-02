"""
Q0.9 real-execution job runner. This is the ONLY process boundary between
the Quant Lite backend (frontend/services/quant-lite/backend/executionAdapter.ts)
and the audited execution_mtf.py engine - it does not add, duplicate, or
alter any backtest logic. Its entire job is: read a validated, already-
server-side-checked config JSON, call run_spec_backtest_mtf() exactly the
way quant-engine/scripts/q06_cross_engine_test.py does, and write a single
structured result JSON. Never touches stdin, never execs a shell string,
never accepts a raw file path from outside --config/--out.

Usage:
    python run_backtest_job.py --config <path to job config json> --out <path to write result json>

Exit code 0  => --out contains {"status": "COMPLETED", ...}
Exit code 1  => --out contains {"status": "FAILED", "errorCode": ..., "errorMessage": ...}

This process never raises an uncaught exception past main() - every
failure path writes a structured result to --out first (Q0.9.9/Q0.9.11:
the Node adapter enforces the hard timeout and kills the process if this
script hangs, but if this script itself fails, it always leaves a real
result file behind rather than silently exiting).
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
import traceback
from datetime import datetime, timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
QUANT_ENGINE_DIR = os.path.join(SCRIPT_DIR, "..")
QUANT_ENGINE_MIN_DIR = os.path.join(SCRIPT_DIR, "..", "..", "quant_engine")
DB_PATH = os.path.join(QUANT_ENGINE_MIN_DIR, "market.db")

sys.path.insert(0, SCRIPT_DIR)
sys.path.insert(0, QUANT_ENGINE_DIR)
sys.path.insert(0, QUANT_ENGINE_MIN_DIR)

ENGINE_VERSION = "execution_mtf-q0.6-lookahead-fixed"

# Real execution requires real 1-minute candle+spread data (Q0.9.1 audit
# finding: only _EXNESS symbols have 1m granularity + candle_spread rows).
# Kept here, not imported from the frontend, so this script has no
# frontend dependency - the Node validation layer enforces the identical
# list before ever spawning this process (defense in depth, Q0.9.4).
REAL_EXECUTION_SYMBOLS = {
    "XAUUSD_EXNESS", "XAUUSD_ZS_EXNESS", "EURUSD_EXNESS",
    "GBPUSD_EXNESS", "USOIL_EXNESS", "BTCUSD_EXNESS",
}

SIGNAL_WARMUP_LOOKBACK_DAYS = 120


def fail(out_path, code, message, details=None):
    payload = {
        "status": "FAILED",
        "errorCode": code,
        "errorMessage": message,
        "details": details or [],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    sys.exit(1)


def load_candles(symbol, timeframe, start_iso, end_iso, with_spread):
    """Mirrors quant-engine/scripts/q06_cross_engine_test.py's load(), scoped
    to a date range via a WHERE clause. Safe to do a string range compare
    here (not for symbols in general) because REAL_EXECUTION_SYMBOLS is
    checked by the caller before this runs, and every _EXNESS symbol's ts
    column is a consistently-formatted, zero-padded, tz-aware ISO string
    (confirmed in the Q0.9.1 audit) - lexicographic and chronological
    ordering agree for that format.
    """
    import pandas as pd

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        if with_spread:
            q = (
                "SELECT c.ts,c.open,c.high,c.low,c.close,s.avg_spread AS spread "
                "FROM candles c LEFT JOIN candle_spread s "
                "ON s.symbol=c.symbol AND s.timeframe=c.timeframe AND s.ts=c.ts "
                "WHERE c.symbol=? AND c.timeframe=? AND c.ts>=? AND c.ts<=? ORDER BY c.ts"
            )
        else:
            q = (
                "SELECT ts,open,high,low,close FROM candles "
                "WHERE symbol=? AND timeframe=? AND ts>=? AND ts<=? ORDER BY ts"
            )
        df = pd.read_sql_query(q, conn, params=(symbol, timeframe, start_iso, end_iso))
    finally:
        conn.close()
    if len(df):
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    out_path = args.out

    try:
        with open(args.config, "r") as f:
            config = json.load(f)
    except Exception as e:
        # Can't write a structured result via the normal path if --out
        # itself is unusable, but --config failures are always our fault,
        # not the caller's, so still try.
        fail(out_path, "ENGINE_ERROR", f"could not read config file: {e}")
        return

    try:
        spec = config["spec"]
        db_symbol = config["dbSymbol"]
        signal_tf = config["signalTimeframe"]
        exec_tf = config.get("execTimeframe", "1m")
        start_date = config["startDate"]
        end_date = config["endDate"]
        initial_capital = float(config["initialCapital"])
        risk_pct = float(config["riskPct"])
        spread_price = float(config.get("spreadPrice", 0.30))
        contract_size = float(config.get("contractSize", 100))
        request_hash = config.get("requestHash", "")
        job_id = config.get("jobId", "")
    except KeyError as e:
        fail(out_path, "INVALID_REQUEST", f"missing required config field: {e}")
        return

    if db_symbol not in REAL_EXECUTION_SYMBOLS:
        fail(out_path, "DATA_UNAVAILABLE",
             f"'{db_symbol}' has no 1-minute execution data - real backtests are "
             f"currently limited to: {sorted(REAL_EXECUTION_SYMBOLS)}")
        return

    try:
        from spec_engine.schema import validate_spec
        errors = validate_spec(spec)
        if errors:
            fail(out_path, "INVALID_STRATEGY", "strategy specification failed validation", errors)
            return

        from spec_engine.quant_lite_risk import quant_lite_risk_config
        from spec_engine.execution_mtf import run_spec_backtest_mtf

        end_dt = datetime.fromisoformat(end_date)
        start_dt = datetime.fromisoformat(start_date)
        warmup_start_dt = start_dt - timedelta(days=SIGNAL_WARMUP_LOOKBACK_DAYS)

        signal_start_iso = warmup_start_dt.strftime("%Y-%m-%d 00:00:00+00:00")
        exec_start_iso = start_dt.strftime("%Y-%m-%d 00:00:00+00:00")
        end_iso = end_dt.strftime("%Y-%m-%d 23:59:59+00:00")

        df_signal = load_candles(db_symbol, signal_tf, signal_start_iso, end_iso, with_spread=False)
        df_exec = load_candles(db_symbol, exec_tf, exec_start_iso, end_iso, with_spread=True)

        if len(df_exec) == 0:
            fail(out_path, "DATA_UNAVAILABLE",
                 f"no {exec_tf} execution data for {db_symbol} between {start_date} and {end_date}")
            return

        risk = quant_lite_risk_config(
            risk_pct=risk_pct, spread_price=spread_price,
            contract_size=contract_size, start_balance=initial_capital,
        )

        trades_df, equity, stats = run_spec_backtest_mtf(df_signal, df_exec, spec, risk)

        if stats.get("error") == "not enough signal bars":
            fail(out_path, "DATA_UNAVAILABLE",
                 f"not enough {signal_tf} signal bars for {db_symbol} in this range "
                 f"(even with a {SIGNAL_WARMUP_LOOKBACK_DAYS}-day indicator warmup lookback)")
            return

        trades = []
        running_balance = initial_capital
        for i, row in enumerate(trades_df.to_dict("records")):
            running_balance += row["pnl"]
            trades.append({
                "tradeNumber": i + 1,
                "direction": row["direction"],
                "entryTime": str(row["entry_time"]),
                "entryPrice": row["entry_price"],
                "exitTime": str(row["exit_time"]),
                "exitPrice": row["exit_price"],
                "volume": row["volume"],
                "pnl": row["pnl"],
                "reason": row["reason"],
                "balanceAfter": round(running_balance, 2),
            })

        equity_curve = [{"time": "start", "balance": initial_capital}] + [
            {"time": t["exitTime"], "balance": t["balanceAfter"]} for t in trades
        ]

        result_core = {"stats": stats, "trades": trades}
        result_hash = hashlib.sha256(
            json.dumps(result_core, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()

        payload = {
            "status": "COMPLETED",
            "stats": stats,
            "trades": trades,
            "equityCurve": equity_curve,
            "provenance": {
                "jobId": job_id,
                "requestHash": request_hash,
                "resultHash": result_hash,
                "symbol": db_symbol,
                "signalTimeframe": signal_tf,
                "execTimeframe": exec_tf,
                "dateRange": {"start": start_date, "end": end_date},
                "initialCapital": initial_capital,
                "riskPct": risk_pct,
                "spreadPrice": spread_price,
                "contractSize": contract_size,
                "engineVersion": ENGINE_VERSION,
                "signalBarsLoaded": int(len(df_signal)),
                "execBarsLoaded": int(len(df_exec)),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            },
        }
        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2, default=str)
        sys.exit(0)

    except Exception as e:
        # Q1.5 Part 13 fix: the full traceback (every frame includes this
        # machine's absolute source paths, e.g. "File \"E:\\...\\schema.py\"")
        # was previously placed straight into `details`, which
        # executionAdapter.ts forwards verbatim into the job's client-facing
        # `error.details` - a real internal-filesystem-path/stack-trace
        # exposure. The traceback is still fully captured, just routed to
        # stderr only (captured server-side as `stderrTail` in the job
        # store, confirmed never returned by GET /api/quant-lite/backtest/
        # [jobId] - see Q1.5_SECURITY_AUDIT.md). The client-facing message
        # stays a plain str(e) (the vast majority of engine exceptions here
        # are things like ValueError/KeyError with no path in their own
        # text) and `details` is now a fixed, non-identifying string.
        tb = "".join(traceback.format_exception(type(e), e, e.__traceback__))[-4000:]
        print(tb, file=sys.stderr)
        fail(out_path, "ENGINE_ERROR", str(e), ["an internal engine error occurred - details were logged server-side, not exposed to the client"])


if __name__ == "__main__":
    main()
