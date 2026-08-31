"""
Q1.0 Part 1/6 - gap detection. Loads only the `ts` column per
(symbol, timeframe) - lightweight even for the ~1m-row 1-minute tables -
and flags gaps beyond what a normal market closure explains. FX/CFD
instruments close ~Fri 22:00 UTC to Sun 22:00 UTC (~48h); BTCUSD trades
24/7 so any gap beyond a handful of missed bars is suspicious there.
Read-only. Does not repair anything - classification only (Part 6).
"""
import json
import os
import sqlite3
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")
EXPECTED_MIN = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440}

# Anomaly threshold per symbol class - anything beyond this (in minutes)
# for a single consecutive gap is flagged for manual review, not treated
# as an automatic weekend closure.
WEEKEND_TOLERANT_MAX_GAP_MIN = 3 * 24 * 60  # 3 days - covers a normal FX/CFD weekend + a bank holiday Monday
CONTINUOUS_MAX_GAP_MIN = {"BTCUSD_EXNESS": 6 * 60}  # BTC trades 24/7 - >6h is suspicious


def audit():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    pairs = conn.execute("SELECT DISTINCT symbol, timeframe FROM candles ORDER BY symbol, timeframe").fetchall()

    results = []
    for symbol, timeframe in pairs:
        ts_rows = conn.execute("SELECT ts FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts", (symbol, timeframe)).fetchall()
        ts = pd.to_datetime(pd.Series([r[0] for r in ts_rows]), utc=True, format="mixed")
        diffs_min = ts.diff().dt.total_seconds().dropna() / 60.0

        expected = EXPECTED_MIN[timeframe]
        threshold = CONTINUOUS_MAX_GAP_MIN.get(symbol, WEEKEND_TOLERANT_MAX_GAP_MIN)

        anomalous_gaps = diffs_min[diffs_min > threshold]
        monotonic = bool(ts.is_monotonic_increasing)
        max_gap_min = float(diffs_min.max()) if len(diffs_min) else 0.0

        results.append({
            "symbol": symbol, "timeframe": timeframe,
            "monotonic": monotonic,
            "max_gap_minutes": round(max_gap_min, 1),
            "expected_interval_minutes": expected,
            "anomalous_gap_count": int(len(anomalous_gaps)),
            "anomalous_gap_threshold_minutes": threshold,
        })
        flag = "  <-- ANOMALOUS GAPS" if len(anomalous_gaps) > 0 or not monotonic else ""
        print(f"{symbol:20s} {timeframe:5s} monotonic={monotonic} max_gap={max_gap_min/60:.1f}h anomalous_gaps={len(anomalous_gaps)}{flag}")

    conn.close()
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", "q10_gap_audit.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nWritten: {out_path}")


if __name__ == "__main__":
    audit()
