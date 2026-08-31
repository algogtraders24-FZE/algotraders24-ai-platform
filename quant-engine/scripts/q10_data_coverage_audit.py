"""
Q1.0 Part 1 - real market.db coverage audit. Read-only (opened via
mode=ro URI, same pattern every prior sprint used). Queries actual data,
never config files. Writes a JSON summary consumed by
Q1.0_DATA_COVERAGE_AUDIT.md and by the timeframe/symbol validation script.
"""
import json
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")

EXPECTED_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440}


def q(conn, sql, params=()):
    return conn.execute(sql, params).fetchall()


def audit():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    pairs = q(conn, "SELECT DISTINCT symbol, timeframe FROM candles ORDER BY symbol, timeframe")

    results = []
    for symbol, timeframe in pairs:
        row = q(conn, "SELECT COUNT(*), MIN(ts), MAX(ts) FROM candles WHERE symbol=? AND timeframe=?", (symbol, timeframe))[0]
        count, min_ts, max_ts = row

        dup_row = q(conn, "SELECT COUNT(*) FROM (SELECT ts, COUNT(*) c FROM candles WHERE symbol=? AND timeframe=? GROUP BY ts HAVING c>1)", (symbol, timeframe))[0]
        dup_count = dup_row[0]

        bad_ohlc_row = q(conn, """
            SELECT COUNT(*) FROM candles
            WHERE symbol=? AND timeframe=?
              AND (high < low OR open <= 0 OR high <= 0 OR low <= 0 OR close <= 0
                   OR high < open OR high < close OR low > open OR low > close)
        """, (symbol, timeframe))[0]
        bad_ohlc_count = bad_ohlc_row[0]

        has_spread_table = q(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name='candle_spread'")
        spread_count = None
        spread_null_count = None
        if has_spread_table:
            sc = q(conn, "SELECT COUNT(*) FROM candle_spread WHERE symbol=? AND timeframe=?", (symbol, timeframe))
            spread_count = sc[0][0] if sc else 0
            if spread_count:
                sn = q(conn, "SELECT COUNT(*) FROM candle_spread WHERE symbol=? AND timeframe=? AND (avg_spread IS NULL OR avg_spread<0)", (symbol, timeframe))
                spread_null_count = sn[0][0]

        results.append({
            "symbol": symbol, "timeframe": timeframe,
            "rows": count, "min_ts": min_ts, "max_ts": max_ts,
            "duplicate_timestamps": dup_count,
            "bad_ohlc_rows": bad_ohlc_count,
            "spread_rows": spread_count,
            "spread_bad_rows": spread_null_count,
        })
        print(f"{symbol:20s} {timeframe:5s} rows={count:>8d} {min_ts} -> {max_ts}  dups={dup_count} bad_ohlc={bad_ohlc_count} spread_rows={spread_count}")

    conn.close()
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", "q10_coverage_audit.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    audit()
