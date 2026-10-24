"""Binance public market data (no API key needed): klines with caching, 24h tickers, order-book depth, exchange filters."""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests

BASES = ["https://api.binance.com", "https://data-api.binance.vision"]
CACHE_DIR = Path(__file__).parent / "data_cache"
INTERVAL_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}
COLS = ["open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume", "trades", "tb_base", "tb_quote", "ignore"]


class BinanceData:
    def __init__(self, session: requests.Session | None = None, pause: float = 0.08):
        self.s = session or requests.Session()
        self.pause = pause

    def _get(self, path: str, params: dict | None = None):
        last = None
        for base in BASES:
            try:
                r = self.s.get(base + path, params=params, timeout=15)
                if r.status_code == 429 or r.status_code == 418:
                    time.sleep(int(r.headers.get("Retry-After", "5")))
                    r = self.s.get(base + path, params=params, timeout=15)
                if r.status_code == 200:
                    return r.json()
                last = f"{r.status_code} {r.text[:120]}"
            except requests.RequestException as e:  # try the mirror
                last = str(e)
        raise RuntimeError(f"Binance GET {path} failed: {last}")

    # ------------------------------------------------------------------ klines
    def _fetch_klines(self, symbol: str, interval: str, start_ms: int, end_ms: int | None) -> pd.DataFrame:
        rows: list = []
        cur = start_ms
        while True:
            params = {"symbol": symbol, "interval": interval, "startTime": cur, "limit": 1000}
            if end_ms:
                params["endTime"] = end_ms
            batch = self._get("/api/v3/klines", params)
            if not batch:
                break
            rows.extend(batch)
            nxt = batch[-1][0] + INTERVAL_MS[interval]
            if len(batch) < 1000 or nxt <= cur:
                break
            cur = nxt
            time.sleep(self.pause)
        return self._frame(rows)

    @staticmethod
    def _frame(rows: Iterable) -> pd.DataFrame:
        df = pd.DataFrame(list(rows), columns=COLS)
        if df.empty:
            return pd.DataFrame(columns=["open_time", "open", "high", "low", "close", "volume", "quote_volume", "trades"])
        for c in ["open", "high", "low", "close", "volume", "quote_volume"]:
            df[c] = df[c].astype(float)
        df["trades"] = df["trades"].astype(int)
        df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        return df[["open_time", "open", "high", "low", "close", "volume", "quote_volume", "trades"]].drop_duplicates("open_time").reset_index(drop=True)

    def klines(self, symbol: str, interval: str = "1h", start: str = "2021-01-01", use_cache: bool = True) -> pd.DataFrame:
        """Closed candles from `start` until now. Cached on disk; later calls only download what is new. The last (still open) candle is dropped."""
        CACHE_DIR.mkdir(exist_ok=True)
        f = CACHE_DIR / f"{symbol}_{interval}.csv"
        cached = pd.DataFrame()
        start_ms = int(pd.Timestamp(start, tz="UTC").timestamp() * 1000)
        if use_cache and f.exists():
            cached = pd.read_csv(f, parse_dates=["open_time"])
            cached["open_time"] = pd.to_datetime(cached["open_time"], utc=True)
            if len(cached):
                start_ms = int(cached["open_time"].iloc[-1].timestamp() * 1000) + INTERVAL_MS[interval]
        fresh = self._fetch_klines(symbol, interval, start_ms, None)
        df = pd.concat([cached, fresh], ignore_index=True) if len(cached) else fresh
        if df.empty:
            return df
        df = df.drop_duplicates("open_time").sort_values("open_time").reset_index(drop=True)
        now = pd.Timestamp.now(tz="UTC")
        df = df[df["open_time"] + pd.Timedelta(milliseconds=INTERVAL_MS[interval]) <= now].reset_index(drop=True)  # closed candles only
        df.to_csv(f, index=False)
        return df

    # ------------------------------------------------------------------ live snapshots
    def tickers_24h(self) -> dict[str, dict]:
        return {t["symbol"]: t for t in self._get("/api/v3/ticker/24hr")}

    def book(self, symbol: str, limit: int = 100) -> dict:
        return self._get("/api/v3/depth", {"symbol": symbol, "limit": limit})

    def exchange_filters(self, symbol: str) -> dict:
        info = self._get("/api/v3/exchangeInfo", {"symbol": symbol})["symbols"][0]
        out = {"status": info["status"], "tickSize": 0.0, "stepSize": 0.0, "minNotional": 0.0, "minQty": 0.0}
        for f in info["filters"]:
            if f["filterType"] == "PRICE_FILTER":
                out["tickSize"] = float(f["tickSize"])
            elif f["filterType"] == "LOT_SIZE":
                out["stepSize"] = float(f["stepSize"])
                out["minQty"] = float(f["minQty"])
            elif f["filterType"] in ("NOTIONAL", "MIN_NOTIONAL"):
                out["minNotional"] = float(f.get("minNotional", 0.0))
        return out


def load_universe(symbols: Iterable[str], interval: str = "1h", start: str = "2021-01-01", data: BinanceData | None = None, verbose: bool = True) -> dict[str, pd.DataFrame]:
    d = data or BinanceData()
    out: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        try:
            df = d.klines(sym, interval, start)
        except Exception as e:  # a delisted / renamed symbol must not stop the run
            if verbose:
                print(f"  skip {sym}: {e}")
            continue
        if len(df) > 500:
            out[sym] = df
            if verbose:
                print(f"  {sym}: {len(df)} candles {df['open_time'].iloc[0].date()} -> {df['open_time'].iloc[-1].date()}")
    return out
