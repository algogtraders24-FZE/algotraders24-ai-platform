"""Live tick (every ~15 s): fresh prices, 24h change, rolling 1-hour volume, mark-to-market equity of the three arms and the P&L of open positions.
Cheap (two public Binance calls), paper only. The hourly cycle still owns every decision; the live tick only makes the picture current."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .cycle import Desk, iso, r4
import pandas as pd


def _symbols_param(symbols: list[str]) -> str:
    return json.dumps(symbols, separators=(",", ":"))


def build_live(desk: Desk) -> dict | None:
    syms = list(desk.universe)
    try:
        t24 = {t["symbol"]: t for t in desk.data._get("/api/v3/ticker/24hr", {"symbols": _symbols_param(syms)})}
    except Exception:
        return None
    prices = {s: float(t["lastPrice"]) for s, t in t24.items()}
    chg24 = {s: float(t["priceChangePercent"]) for s, t in t24.items()}
    rel_live: dict[str, float] = {}
    try:
        t1h = desk.data._get("/api/v3/ticker", {"symbols": _symbols_param(syms), "windowSize": "1h"})
        avg = {r["symbol"]: r.get("avg_qv48") for r in desk.state.get("radar", [])}
        for t in t1h:
            a = avg.get(t["symbol"])
            if a:
                rel_live[t["symbol"]] = round(float(t["quoteVolume"]) / a, 2)
    except Exception:
        pass  # the rolling-volume view is a bonus; prices alone are enough
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    arms = {}
    for name, book in desk.arms.items():
        eq = book.value(prices)
        start = book.rs.day_start_equity or book.initial
        arms[name] = {"equity": round(eq, 2), "return_pct": round((eq / book.initial - 1) * 100, 3), "day_pnl": round(eq - start, 2) if book.rs.day == today else 0.0, "open": len(book.pos)}
    positions = [{"symbol": s, "price": prices.get(s, p.entry), "pnl_pct": round((prices.get(s, p.entry) / p.entry - 1) * 100, 3)} for s, p in desk.arms["desk"].pos.items()]
    return {"ts": iso(pd.Timestamp.now(tz="UTC")), "prices": {s: r4(v, 6) for s, v in prices.items()}, "chg24": {s: round(v, 2) for s, v in chg24.items()}, "rel_live": rel_live, "arms": arms, "positions": positions}


def write_live(desk: Desk, live: dict) -> None:
    tmp = Path(desk.dir) / "live.json.tmp"
    tmp.write_text(json.dumps(live), encoding="utf-8")
    tmp.replace(Path(desk.dir) / "live.json")
