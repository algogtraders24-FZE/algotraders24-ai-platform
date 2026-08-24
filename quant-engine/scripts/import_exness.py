"""
Streams the Exness tick-data zips (Downloads/Exness_<SYMBOL>_<YEAR>.zip,
format: "Exness","Symbol","Timestamp","Bid","Ask") straight out of the
zip (no full extraction - files are ~2GB CSV each) into quant_engine's
market.db, using its existing candles table schema (db.py).

Ticks have no OHLC/volume - mid=(bid+ask)/2 is aggregated into 1-minute
bars in a single streaming pass (O(1) memory: chunk + one pending
boundary-minute carried across chunk/file edges), then resampled up to
5m/15m/30m/1h/4h/1d exactly like data_import.py's existing TF_RULES.

Stored under suffixed symbol keys (e.g. "XAUUSD_EXNESS") rather than the
plain "XAUUSD"/"EURUSD" keys already in market.db - those existing rows
came from a different source (data_raw 5m/m15 CSVs) and demo.py/the
1764-strategy library already depend on them; blending a second source
into the same symbol key would silently change their price series.

Usage: python scripts/import_exness.py [--symbols XAUUSD,EURUSD,...] [--years 2024,2025,2026]
"""
import argparse
import io
import os
import sys
import time
import zipfile

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))
from db import get_conn, init_db  # noqa: E402

DOWNLOADS = r"C:\Users\om\Downloads"

# Exness zip "SYMBOL" name -> (zip file symbol token, market.db symbol key)
SYMBOL_MAP = {
    "XAUUSD": ("XAUUSD", "XAUUSD_EXNESS"),
    "XAUUSD_Zero_Spread": ("XAUUSD_Zero_Spread", "XAUUSD_ZS_EXNESS"),
    "EURUSD": ("EURUSD", "EURUSD_EXNESS"),
    "GBPUSD": ("GBPUSD", "GBPUSD_EXNESS"),
    "USOIL": ("USOIL", "USOIL_EXNESS"),
    "BTCUSD": ("BTCUSD", "BTCUSD_EXNESS"),
}

CONTRACT_SIZE = {
    "XAUUSD_EXNESS": 100.0, "XAUUSD_ZS_EXNESS": 100.0,
    "EURUSD_EXNESS": 100000.0, "GBPUSD_EXNESS": 100000.0,
    "USOIL_EXNESS": 1000.0, "BTCUSD_EXNESS": 1.0,
}

CHUNK_ROWS = 2_000_000
TF_RULES = {"5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1D"}

# Additive table alongside db.py's existing `candles` schema - real, time-varying
# bid/ask spread per bar (average + last-tick), so the execution engine can fill
# orders against actual market spread instead of one static assumed spread_price.
# Does not touch db.py's own schema/rows.
SPREAD_SCHEMA = """
CREATE TABLE IF NOT EXISTS candle_spread (
    symbol      TEXT NOT NULL,
    timeframe   TEXT NOT NULL,
    ts          TEXT NOT NULL,
    avg_spread  REAL NOT NULL,
    last_spread REAL NOT NULL,
    PRIMARY KEY (symbol, timeframe, ts)
);
"""


def _finalize_groups(chunk_mid):
    """chunk_mid: DataFrame with columns minute(floored), mid, spread, in original tick order.
    Returns per-minute OHLC + spread groups in chronological order (list of dict).
    avg_spread/last_spread are carried so the execution engine can fill orders against
    a real, time-varying bid/ask gap instead of one static assumed spread_price."""
    g = chunk_mid.groupby("minute", sort=True)
    out = g["mid"].agg(open="first", high="max", low="min", close="last")
    out["ticks"] = g["mid"].size()
    out["spread_sum"] = g["spread"].sum()
    out["last_spread"] = g["spread"].last()
    out = out.reset_index().rename(columns={"minute": "ts"})
    return out.to_dict("records")


def _merge_minute(a, b):
    """Merges two partial groups for the SAME minute where a's ticks are
    chronologically before b's (a = held-back pending, b = newly arrived)."""
    return {
        "ts": a["ts"],
        "open": a["open"],
        "high": max(a["high"], b["high"]),
        "low": min(a["low"], b["low"]),
        "close": b["close"],
        "ticks": a["ticks"] + b["ticks"],
        "spread_sum": a["spread_sum"] + b["spread_sum"],
        "last_spread": b["last_spread"],
    }


def iter_tick_chunks(zip_path, symbol_token):
    """Shared low-level reader: yields (ts, bid, ask) DataFrames straight out
    of one Exness zip's CSV, chunked, filtered to symbol_token, in original
    file order. Used both by stream_symbol_zip (1m aggregation, below) and
    by spec_engine.execution_tick (true tick-by-tick backtest execution) so
    both go through the exact same proven parsing path."""
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        assert len(names) == 1, f"expected exactly one CSV in {zip_path}, found {names}"
        with zf.open(names[0]) as raw:
            text_stream = io.TextIOWrapper(raw, encoding="utf-8")
            reader = pd.read_csv(
                text_stream,
                usecols=["Symbol", "Timestamp", "Bid", "Ask"],
                dtype={"Symbol": "category"},
                chunksize=CHUNK_ROWS,
            )
            for chunk in reader:
                chunk = chunk[chunk["Symbol"] == symbol_token]
                if chunk.empty:
                    continue
                yield pd.DataFrame({
                    "ts": pd.to_datetime(chunk["Timestamp"], format="ISO8601", utc=True),
                    "bid": chunk["Bid"].astype(float),
                    "ask": chunk["Ask"].astype(float),
                })


def stream_symbol_zip(zip_path, symbol_token, on_groups):
    """Reads one Exness zip's CSV in chunks, yields closed 1-minute OHLC
    groups via on_groups(list_of_dicts) as soon as they're safe to flush
    (i.e. not the still-open last minute of the current chunk)."""
    pending = None  # dict: the last (possibly incomplete) minute group, held back
    total_rows = 0

    for chunk in iter_tick_chunks(zip_path, symbol_token):
        total_rows += len(chunk)
        cm = pd.DataFrame({
            "minute": chunk["ts"].dt.floor("min"),
            "mid": (chunk["bid"] + chunk["ask"]) / 2.0,
            "spread": chunk["ask"] - chunk["bid"],
        })

        groups = _finalize_groups(cm)
        if not groups:
            continue

        if pending is not None:
            if groups[0]["ts"] == pending["ts"]:
                groups[0] = _merge_minute(pending, groups[0])
            else:
                on_groups([pending])

        pending = groups[-1]
        closed = groups[:-1]
        if closed:
            on_groups(closed)

    return pending, total_rows


def import_symbol(conn, zip_symbol, years):
    csv_symbol, db_symbol = SYMBOL_MAP[zip_symbol]
    print(f"\n=== {zip_symbol} -> {db_symbol} ===", flush=True)

    conn.execute(
        "INSERT OR REPLACE INTO symbols VALUES (?,?,?,?)",
        (db_symbol, f"{zip_symbol} (Exness tick feed, mid price)",
         CONTRACT_SIZE.get(db_symbol, 100000.0), 1.0),
    )
    conn.commit()

    buffer = []
    written = 0
    t0 = time.time()
    max_flushed_ts = [None]
    stale_dupes = [0]

    def flush(groups):
        nonlocal written
        # extremely rare (~1-in-300k, seen once on real XAUUSD 2024 data): a
        # brief out-of-order stretch in the source feed can re-emit an
        # already-flushed minute non-adjacently. Not fixable by the
        # adjacent-chunk-boundary merge above - just counted so it's visible
        # rather than silently overwritten by INSERT OR REPLACE.
        for g in groups:
            if max_flushed_ts[0] is not None and g["ts"] <= max_flushed_ts[0]:
                stale_dupes[0] += 1
            else:
                max_flushed_ts[0] = g["ts"]
        buffer.extend(groups)
        if len(buffer) >= 200_000:
            _write_1m(conn, db_symbol, buffer)
            written += len(buffer)
            buffer.clear()

    pending = None
    for year in years:
        zip_path = os.path.join(DOWNLOADS, f"Exness_{zip_symbol}_{year}.zip")
        if not os.path.exists(zip_path):
            print(f"  [skip] {zip_path} not found")
            continue
        print(f"  streaming {os.path.basename(zip_path)} ...", flush=True)
        year_pending, total_rows = stream_symbol_zip(zip_path, csv_symbol, flush)
        print(f"  {os.path.basename(zip_path)}: {total_rows:,} ticks read, "
              f"elapsed {time.time()-t0:.0f}s", flush=True)

        if pending is not None and year_pending is not None and pending["ts"] == year_pending["ts"]:
            pending = _merge_minute(pending, year_pending)
        else:
            if pending is not None:
                flush([pending])
            pending = year_pending

    if pending is not None:
        flush([pending])
    if buffer:
        _write_1m(conn, db_symbol, buffer)
        written += len(buffer)

    print(f"  wrote {written:,} 1m bars for {db_symbol} in {time.time()-t0:.0f}s"
          f"{f' ({stale_dupes[0]} out-of-order source dupes overwrote an earlier bar)' if stale_dupes[0] else ''}",
          flush=True)
    return written


def _write_1m(conn, symbol, groups):
    candle_rows = [
        (symbol, "1m", pd.Timestamp(g["ts"]).isoformat(), g["open"], g["high"], g["low"], g["close"], g["ticks"])
        for g in groups
    ]
    spread_rows = [
        (symbol, "1m", pd.Timestamp(g["ts"]).isoformat(),
         g["spread_sum"] / g["ticks"] if g["ticks"] else g["last_spread"], g["last_spread"])
        for g in groups
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO candles (symbol,timeframe,ts,open,high,low,close,volume) "
        "VALUES (?,?,?,?,?,?,?,?)", candle_rows)
    conn.executemany(
        "INSERT OR REPLACE INTO candle_spread (symbol,timeframe,ts,avg_spread,last_spread) "
        "VALUES (?,?,?,?,?)", spread_rows)
    conn.commit()


def resample_from_1m(conn, symbol):
    df = pd.read_sql_query(
        "SELECT c.ts,c.open,c.high,c.low,c.close,c.volume,s.avg_spread,s.last_spread "
        "FROM candles c JOIN candle_spread s "
        "ON s.symbol=c.symbol AND s.timeframe=c.timeframe AND s.ts=c.ts "
        "WHERE c.symbol=? AND c.timeframe='1m' ORDER BY c.ts",
        conn, params=(symbol,), parse_dates=["ts"],
    )
    if df.empty:
        print(f"  [skip resample] no 1m rows for {symbol}")
        return
    # tick-weighted spread contribution, summed per bucket then divided by bucket volume
    df["spread_x_vol"] = df["avg_spread"] * df["volume"]
    d = df.set_index("ts")
    for tf, rule in TF_RULES.items():
        out = d.resample(rule).agg({"open": "first", "high": "max", "low": "min", "close": "last",
                                     "volume": "sum", "spread_x_vol": "sum", "last_spread": "last"}).dropna(
            subset=["open"]).reset_index()
        out["avg_spread"] = out["spread_x_vol"] / out["volume"].replace(0, np.nan)
        rows = [(symbol, tf, ts.isoformat(), o, h, l, c, v)
                for ts, o, h, l, c, v in zip(out["ts"], out["open"], out["high"],
                                              out["low"], out["close"], out["volume"])]
        spread_rows = [(symbol, tf, ts.isoformat(), avg_sp, last_sp)
                        for ts, avg_sp, last_sp in zip(out["ts"], out["avg_spread"], out["last_spread"])]
        conn.executemany(
            "INSERT OR REPLACE INTO candles (symbol,timeframe,ts,open,high,low,close,volume) "
            "VALUES (?,?,?,?,?,?,?,?)", rows)
        conn.executemany(
            "INSERT OR REPLACE INTO candle_spread (symbol,timeframe,ts,avg_spread,last_spread) "
            "VALUES (?,?,?,?,?)", spread_rows)
        conn.commit()
        print(f"  {symbol} {tf}: {len(rows):,} candles ({out['ts'].min()} -> {out['ts'].max()})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default=",".join(SYMBOL_MAP.keys()))
    ap.add_argument("--years", default="2024,2025,2026")
    args = ap.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    years = [y.strip() for y in args.years.split(",") if y.strip()]

    init_db()
    conn = get_conn()
    conn.executescript(SPREAD_SCHEMA)
    conn.commit()
    t0 = time.time()
    for sym in symbols:
        import_symbol(conn, sym, years)
        resample_from_1m(conn, SYMBOL_MAP[sym][1])
    conn.close()
    print(f"\nAll done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
