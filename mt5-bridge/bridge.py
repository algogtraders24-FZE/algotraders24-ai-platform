"""
mt5-bridge/bridge.py

A small, read-only HTTP bridge exposing a locally-running MetaTrader 5
terminal's live quotes and candles over HTTP, so Algotraders24's Next.js
app (running on Vercel, which cannot host a persistent MT5 terminal
connection) can reach it as one more MarketDataProvider.

HARD BOUNDARY, enforced by omission, not just convention: this service
exposes NO order-placement, order-modification, or account-mutating
endpoint. It only ever reads mt5.symbol_info_tick() / mt5.copy_rates_*() -
the exact same read-only calls a human would use to check a price. There
is nothing here that could place, close, or modify a trade.

Every response is a direct, unmodified read from the MT5 terminal. On any
failure (symbol not found, terminal disconnected, MT5 API error) this
returns a real, typed error - never a stale, cached, or invented price.

Run with:  uvicorn bridge:app --host 0.0.0.0 --port 8787
(see README.md for the full Windows deployment runbook, including running
this as a persistent service and putting HTTPS in front of it - this
process itself only speaks plain HTTP; TLS termination is a reverse
proxy's job, not this file's.)
"""

import hmac
import os
from datetime import datetime, timezone
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

app = FastAPI(title="AT24 MT5 Bridge", description="Read-only live market data from a local MT5 terminal.")

# Canonical Algotraders24 symbol -> this account's real MT5 symbol name.
# Deliberately NOT guessed - Exness (and most brokers) suffix symbols
# differently per account type (e.g. "XAGUSD" vs "XAGUSDm"). Confirm the
# real names via GET /symbols once this is actually running against the
# live account, then fill this in - never assume a mapping works before
# it's been checked against a real mt5.symbols_get() call.
SYMBOL_MAP: dict[str, str] = {
    # "XAGUSD": "XAGUSD",   # <- confirm real suffix via /symbols, then uncomment/adjust
    # "XAUUSD": "XAUUSD",
    # "EURUSD": "EURUSD",
    # "BTCUSD": "BTCUSD",
    # "ETHUSD": "ETHUSD",
}

# MT5's own timeframe constants, keyed by the same interval strings the
# rest of the platform already uses (SignalTimeframe in the TS codebase).
TIMEFRAME_MAP = {
    "1m": mt5.TIMEFRAME_M1,
    "5m": mt5.TIMEFRAME_M5,
    "15m": mt5.TIMEFRAME_M15,
    "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1,
    "4h": mt5.TIMEFRAME_H4,
    "1d": mt5.TIMEFRAME_D1,
    "1w": mt5.TIMEFRAME_W1,
}

_mt5_ready = False


def _require_secret(authorization: Optional[str]) -> None:
    """Constant-time Bearer-token check. No configured secret -> refuse
    every request, never 'accept anyone' - mirrors the exact rule
    lib/intelligence/cron-auth.ts's isValidCronSecret() already enforces
    on the TypeScript side of this platform."""
    configured = os.environ.get("MT5_BRIDGE_SECRET", "")
    if not configured:
        raise HTTPException(status_code=503, detail="bridge secret not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    presented = authorization[len("Bearer "):].strip()
    if not presented or not hmac.compare_digest(presented, configured):
        raise HTTPException(status_code=401, detail="invalid bearer token")


def _resolve_symbol(canonical_symbol: str) -> str:
    mt5_symbol = SYMBOL_MAP.get(canonical_symbol.upper())
    if not mt5_symbol:
        raise HTTPException(status_code=404, detail=f"'{canonical_symbol}' is not mapped in SYMBOL_MAP - confirm the real MT5 symbol name via /symbols first")
    return mt5_symbol


@app.on_event("startup")
def startup() -> None:
    global _mt5_ready
    _mt5_ready = bool(mt5.initialize())


@app.on_event("shutdown")
def shutdown() -> None:
    mt5.shutdown()


@app.get("/health")
def health() -> JSONResponse:
    """No auth - safe to hit from an uptime monitor. Reports real
    connection state, never a hardcoded 'ok'."""
    connected = mt5.terminal_info() is not None
    account = mt5.account_info()
    return JSONResponse({
        "status": "ok" if connected else "mt5_disconnected",
        "mt5_connected": connected,
        "account": account.login if account else None,
        "server": account.server if account else None,
    })


@app.get("/symbols")
def symbols(authorization: Optional[str] = Header(None)) -> JSONResponse:
    """Debug/setup endpoint: lists the REAL symbol names this account's
    MT5 terminal actually has, so SYMBOL_MAP above can be filled in
    correctly instead of guessed. Auth-gated like every other real data
    endpoint (this is still account-identifying information)."""
    _require_secret(authorization)
    all_symbols = mt5.symbols_get()
    if all_symbols is None:
        raise HTTPException(status_code=502, detail="mt5.symbols_get() returned nothing - is the terminal connected?")
    return JSONResponse({"count": len(all_symbols), "symbols": [s.name for s in all_symbols]})


@app.get("/quote")
def quote(symbol: str = Query(...), authorization: Optional[str] = Header(None)) -> JSONResponse:
    _require_secret(authorization)
    mt5_symbol = _resolve_symbol(symbol)

    # A symbol not currently in Market Watch has no live tick until
    # selected - select it explicitly rather than silently returning stale
    # data from whatever was last shown in the terminal UI.
    if not mt5.symbol_select(mt5_symbol, True):
        raise HTTPException(status_code=404, detail=f"MT5 could not select symbol '{mt5_symbol}'")

    tick = mt5.symbol_info_tick(mt5_symbol)
    if tick is None:
        raise HTTPException(status_code=502, detail=f"no live tick available for '{mt5_symbol}'")

    return JSONResponse({
        "symbol": symbol.upper(),
        "mt5Symbol": mt5_symbol,
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "volume": tick.volume,
        "time": datetime.fromtimestamp(tick.time, tz=timezone.utc).isoformat(),
    })


@app.get("/candles")
def candles(
    symbol: str = Query(...),
    interval: str = Query("1h"),
    count: int = Query(100, le=5000),
    authorization: Optional[str] = Header(None),
) -> JSONResponse:
    _require_secret(authorization)
    mt5_symbol = _resolve_symbol(symbol)
    timeframe = TIMEFRAME_MAP.get(interval)
    if timeframe is None:
        raise HTTPException(status_code=400, detail=f"unsupported interval '{interval}' - supported: {sorted(TIMEFRAME_MAP.keys())}")

    if not mt5.symbol_select(mt5_symbol, True):
        raise HTTPException(status_code=404, detail=f"MT5 could not select symbol '{mt5_symbol}'")

    rates = mt5.copy_rates_from_pos(mt5_symbol, timeframe, 0, count)
    if rates is None or len(rates) == 0:
        raise HTTPException(status_code=502, detail=f"no candle data available for '{mt5_symbol}' at interval '{interval}'")

    # mt5.copy_rates_from_pos returns newest-last already (oldest-first) -
    # matches this platform's own Candle[] convention exactly, no re-sort
    # needed, but never assumed without the shape being documented here.
    candles_out = [
        {
            "datetime": datetime.fromtimestamp(int(row["time"]), tz=timezone.utc).isoformat(),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["tick_volume"]),
        }
        for row in rates
    ]

    return JSONResponse({"symbol": symbol.upper(), "mt5Symbol": mt5_symbol, "interval": interval, "candles": candles_out})
