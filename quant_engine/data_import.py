"""
Loads raw CSVs into the shared SQLite database, normalized to one
candles table across symbols and timeframes so the engine can pull
"give me XAUUSD H1 from 2021-2023" with one query regardless of source.
"""
import pandas as pd
import numpy as np
from db import get_conn, init_db

TF_RULES = {"15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1D"}


def resample_ohlc(df, rule):
    d = df.set_index("ts")
    out = d.resample(rule).agg({"open": "first", "high": "max", "low": "min",
                                  "close": "last", "volume": "sum"}).dropna()
    return out.reset_index()


def store_candles(conn, symbol, timeframe, df):
    rows = [(symbol, timeframe, ts.isoformat(), o, h, l, c, v)
            for ts, o, h, l, c, v in zip(df["ts"], df["open"], df["high"],
                                          df["low"], df["close"], df["volume"])]
    conn.executemany(
        "INSERT OR REPLACE INTO candles (symbol,timeframe,ts,open,high,low,close,volume) "
        "VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    print(f"  stored {symbol} {timeframe}: {len(rows)} candles "
          f"({df['ts'].min()} -> {df['ts'].max()})")


def import_xauusd(conn):
    print("Importing XAUUSD (source: 5m, Aug 2020 - Aug 2025, verified against real price history)...")
    df = pd.read_csv("data_raw/XAUUSD_5m.csv", dtype={"Date": str, "Time": str})
    df["ts"] = pd.to_datetime(df["Date"] + " " + df["Time"], format="%Y%m%d %H:%M:%S")
    df = df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                             "Close": "close", "Volume": "volume"})
    df = df[["ts", "open", "high", "low", "close", "volume"]].sort_values("ts").reset_index(drop=True)

    conn.execute("INSERT OR REPLACE INTO symbols VALUES (?,?,?,?)",
                 ("XAUUSD", "Gold vs US Dollar spot", 100.0, 1.0))
    store_candles(conn, "XAUUSD", "5m", df)
    for tf, rule in TF_RULES.items():
        store_candles(conn, "XAUUSD", tf, resample_ohlc(df, rule))


def import_fx_pair(conn, symbol, price_scale=100000.0):
    print(f"Importing {symbol} (source: ejtraderLabs/historical-data, m15 base, 2012 - Mar 2022)...")
    base = pd.read_csv(f"data_raw/{symbol}/{symbol}m15.csv")
    base["ts"] = pd.to_datetime(base["Date"])
    base = base.rename(columns={"open": "open", "high": "high", "low": "low",
                                 "close": "close", "tick_volume": "volume"})
    for c in ["open", "high", "low", "close"]:
        base[c] = base[c] / price_scale
    base = base[["ts", "open", "high", "low", "close", "volume"]].sort_values("ts").reset_index(drop=True)

    conn.execute("INSERT OR REPLACE INTO symbols VALUES (?,?,?,?)",
                 (symbol, f"{symbol} spot FX", 100000.0, 1.0))  # already de-scaled on import
    store_candles(conn, symbol, "15m", base)
    for tf, rule in [("30m", "30min"), ("1h", "1h"), ("4h", "4h"), ("1d", "1D")]:
        store_candles(conn, symbol, tf, resample_ohlc(base, rule))


def load_candles(symbol, timeframe, start=None, end=None):
    """Query helper the engine/strategies use to pull a DataFrame from the DB."""
    conn = get_conn()
    q = "SELECT ts,open,high,low,close,volume FROM candles WHERE symbol=? AND timeframe=?"
    params = [symbol, timeframe]
    if start:
        q += " AND ts>=?"; params.append(start)
    if end:
        q += " AND ts<?"; params.append(end)
    q += " ORDER BY ts"
    df = pd.read_sql_query(q, conn, params=params, parse_dates=["ts"])
    conn.close()
    return df


if __name__ == "__main__":
    init_db()
    conn = get_conn()
    import_xauusd(conn)
    import_fx_pair(conn, "EURUSD")
    import_fx_pair(conn, "GBPUSD")
    conn.close()
    print("\nDone. Symbols x timeframes now in market.db:")
    conn = get_conn()
    print(pd.read_sql_query(
        "SELECT symbol, timeframe, COUNT(*) n, MIN(ts) start, MAX(ts) end "
        "FROM candles GROUP BY symbol, timeframe ORDER BY symbol, timeframe", conn))
    conn.close()
