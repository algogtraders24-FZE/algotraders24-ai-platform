"""
mt5-bridge/bridge.py

Read-only HTTP bridge exposing live market data from the specifically
configured MetaTrader 5 terminal.

IMPORTANT:
- This service has NO trading endpoint.
- It cannot place, modify, or close orders.
- It only reads quotes/candles from MT5.
- The MT5 terminal is explicitly selected because multiple MT5 terminals
  are installed on this VPS.
"""

import hmac
import os
from datetime import datetime, timezone
from typing import Optional

import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

app = FastAPI(
    title="AT24 MT5 Bridge",
    description="Read-only live market data from the configured MT5 terminal.",
)

# ---------------------------------------------------------------------------
# MT5 TERMINAL
# ---------------------------------------------------------------------------
# IMPORTANT: This VPS has multiple MT5 terminals.
# This executable was independently verified to connect to:
#   Login:  127726651
#   Server: Exness-MT5Real7
#   Company: Exness Technologies Ltd
#
# Do NOT change this path unless the live Exness terminal installation changes.
MT5_TERMINAL_PATH = r"C:\Program Files\JustMarkets MetaTrader 5\terminal64.exe"


# ---------------------------------------------------------------------------
# SYMBOL MAP
# ---------------------------------------------------------------------------
# Canonical Algotraders24 symbol -> real MT5 symbol.
#
# These mappings have been confirmed against the live Exness account.
SYMBOL_MAP: dict[str, str] = {
    "XAGUSD": "XAGUSD",
    "XAUUSD": "XAUUSD",
    "EURUSD": "EURUSD",
    "GBPUSD": "GBPUSD",
    "USDJPY": "USDJPY",
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
}


# ---------------------------------------------------------------------------
# TIMEFRAME MAP
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# AUTHENTICATION
# ---------------------------------------------------------------------------
def _require_secret(authorization: Optional[str]) -> None:
    """
    Constant-time Bearer-token authentication.

    No configured secret means authenticated endpoints are completely
    disabled. There is no fail-open behavior.
    """
    configured = os.environ.get("MT5_BRIDGE_SECRET", "")

    if not configured:
        raise HTTPException(
            status_code=503,
            detail="bridge secret not configured",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="missing bearer token",
        )

    presented = authorization[len("Bearer "):].strip()

    if not presented or not hmac.compare_digest(presented, configured):
        raise HTTPException(
            status_code=401,
            detail="invalid bearer token",
        )


# ---------------------------------------------------------------------------
# SYMBOL RESOLUTION
# ---------------------------------------------------------------------------
def _resolve_symbol(canonical_symbol: str) -> str:
    canonical = canonical_symbol.upper()
    mt5_symbol = SYMBOL_MAP.get(canonical)

    if not mt5_symbol:
        raise HTTPException(
            status_code=404,
            detail=(
                f"'{canonical}' is not mapped in SYMBOL_MAP"
            ),
        )

    return mt5_symbol


# ---------------------------------------------------------------------------
# MT5 LIFECYCLE
# ---------------------------------------------------------------------------
@app.on_event("startup")
def startup() -> None:
    global _mt5_ready

    _mt5_ready = bool(
        mt5.initialize(
            path=MT5_TERMINAL_PATH,
        )
    )


@app.on_event("shutdown")
def shutdown() -> None:
    mt5.shutdown()


# ---------------------------------------------------------------------------
# HEALTH
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> JSONResponse:
    """
    Unauthenticated health endpoint.

    Reports the actual MT5 connection/account state.
    Never returns a fabricated 'healthy' state.
    """
    connected = mt5.terminal_info() is not None
    account = mt5.account_info()

    return JSONResponse(
        {
            "status": "ok" if connected else "mt5_disconnected",
            "mt5_connected": connected,
            "account": account.login if account else None,
            "server": account.server if account else None,
        }
    )


# ---------------------------------------------------------------------------
# SYMBOL DISCOVERY
# ---------------------------------------------------------------------------
@app.get("/symbols")
def symbols(
    authorization: Optional[str] = Header(None),
) -> JSONResponse:
    """
    Returns the actual symbols exposed by the configured MT5 terminal.
    """
    _require_secret(authorization)

    all_symbols = mt5.symbols_get()

    if all_symbols is None:
        raise HTTPException(
            status_code=502,
            detail=(
                "mt5.symbols_get() returned nothing - "
                "is the terminal connected?"
            ),
        )

    return JSONResponse(
        {
            "count": len(all_symbols),
            "symbols": [symbol.name for symbol in all_symbols],
        }
    )


# ---------------------------------------------------------------------------
# LIVE QUOTE
# ---------------------------------------------------------------------------
@app.get("/quote")
def quote(
    symbol: str = Query(...),
    authorization: Optional[str] = Header(None),
) -> JSONResponse:
    """
    Returns the current live MT5 tick.

    No cached or synthetic value is returned.
    """
    _require_secret(authorization)

    mt5_symbol = _resolve_symbol(symbol)

    if not mt5.symbol_select(mt5_symbol, True):
        raise HTTPException(
            status_code=404,
            detail=f"MT5 could not select symbol '{mt5_symbol}'",
        )

    tick = mt5.symbol_info_tick(mt5_symbol)

    if tick is None:
        raise HTTPException(
            status_code=502,
            detail=f"no live tick available for '{mt5_symbol}'",
        )

    return JSONResponse(
        {
            "symbol": symbol.upper(),
            "mt5Symbol": mt5_symbol,
            "bid": tick.bid,
            "ask": tick.ask,
            "last": tick.last,
            "volume": tick.volume,
            "time": datetime.fromtimestamp(
                tick.time,
                tz=timezone.utc,
            ).isoformat(),
        }
    )


# ---------------------------------------------------------------------------
# CANDLES
# ---------------------------------------------------------------------------
@app.get("/candles")
def candles(
    symbol: str = Query(...),
    interval: str = Query("1h"),
    count: int = Query(100, ge=1, le=5000),
    authorization: Optional[str] = Header(None),
) -> JSONResponse:
    """
    Returns OHLCV candles directly from MT5.

    MT5 copy_rates_from_pos() returns the requested bars in chronological
    order, oldest first.
    """
    _require_secret(authorization)

    mt5_symbol = _resolve_symbol(symbol)

    timeframe = TIMEFRAME_MAP.get(interval)

    if timeframe is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported interval '{interval}' - "
                f"supported: {sorted(TIMEFRAME_MAP.keys())}"
            ),
        )

    if not mt5.symbol_select(mt5_symbol, True):
        raise HTTPException(
            status_code=404,
            detail=f"MT5 could not select symbol '{mt5_symbol}'",
        )

    rates = mt5.copy_rates_from_pos(
        mt5_symbol,
        timeframe,
        0,
        count,
    )

    if rates is None or len(rates) == 0:
        raise HTTPException(
            status_code=502,
            detail=(
                f"no candle data available for "
                f"'{mt5_symbol}' at interval '{interval}'"
            ),
        )

    candles_out = [
        {
            "datetime": datetime.fromtimestamp(
                int(row["time"]),
                tz=timezone.utc,
            ).isoformat(),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["tick_volume"]),
        }
        for row in rates
    ]

    return JSONResponse(
        {
            "symbol": symbol.upper(),
            "mt5Symbol": mt5_symbol,
            "interval": interval,
            "candles": candles_out,
        }
    )