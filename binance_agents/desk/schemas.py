"""Validation + clipping of every agent's JSON. Nothing an agent says reaches the order logic without passing through here: unknown symbols are
dropped, numbers are clipped to hard limits, anything missing or malformed falls back to the CONSERVATIVE default (no trade)."""
from __future__ import annotations

from typing import Any

STOP_ATR_MIN, STOP_ATR_MAX = 1.0, 3.0
LIMIT_OFFSET_MAX_BPS = 30.0


def num(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if x != x:  # NaN
        return default
    return max(lo, min(hi, x))


def text(v: Any, n: int = 200) -> str:
    return str(v).strip()[:n] if v is not None else ""


def _items(d: dict | None, key: str) -> list[dict]:
    v = (d or {}).get(key)
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def parse_scout(d: dict | None, allowed: set[str], max_picks: int = 3) -> list[dict]:
    out, seen = [], set()
    for x in _items(d, "picks"):
        s = text(x.get("symbol"), 20).upper()
        if s in allowed and s not in seen:
            seen.add(s)
            out.append({"symbol": s, "why": text(x.get("why")), "invalidation": text(x.get("invalidation"))})
        if len(out) >= max_picks:
            break
    return out


def parse_risk_checker(d: dict | None, symbols: set[str]) -> dict[str, dict]:
    res = {s: {"pass": False, "concern": "no answer from Risk Checker"} for s in symbols}     # conservative default
    for x in _items(d, "checks"):
        s = text(x.get("symbol"), 20).upper()
        if s in res:
            res[s] = {"pass": x.get("pass") is True, "concern": text(x.get("concern"), 120)}
    return res


def parse_sentiment(d: dict | None, symbols: set[str]) -> tuple[dict[str, dict], str]:
    res = {s: {"bias": "neutral", "strength": 0.0, "why": "no answer from Sentiment"} for s in symbols}
    for x in _items(d, "views"):
        s = text(x.get("symbol"), 20).upper()
        if s in res:
            bias = text(x.get("bias"), 10).lower()
            res[s] = {"bias": bias if bias in ("bullish", "neutral", "bearish") else "neutral", "strength": num(x.get("strength"), 0.0, 1.0, 0.0), "why": text(x.get("why"), 120)}
    regime = text((d or {}).get("regime"), 12).lower()
    return res, regime if regime in ("risk_on", "neutral", "risk_off") else "neutral"


def parse_strategy(d: dict | None, pick_symbols: set[str], open_symbols: set[str]) -> tuple[dict[str, dict], dict[str, dict]]:
    dec = {s: {"action": "SKIP", "conviction": 0.0, "stop_atr": 2.0, "thesis": "no answer from Strategy", "invalidation": ""} for s in pick_symbols}   # default SKIP
    for x in _items(d, "decisions"):
        s = text(x.get("symbol"), 20).upper()
        if s in dec:
            action = text(x.get("action"), 6).upper()
            dec[s] = {"action": "BUY" if action == "BUY" else "SKIP", "conviction": num(x.get("conviction"), 0.0, 1.0, 0.0),
                      "stop_atr": num(x.get("stop_atr"), STOP_ATR_MIN, STOP_ATR_MAX, 2.0), "thesis": text(x.get("thesis"), 260), "invalidation": text(x.get("invalidation"), 120)}
    pos = {}
    for x in _items(d, "positions"):
        s = text(x.get("symbol"), 20).upper()
        if s in open_symbols:
            action = text(x.get("action"), 8).upper()
            pos[s] = {"action": action if action in ("HOLD", "TIGHTEN", "EXIT") else "HOLD", "stop_atr": num(x.get("stop_atr"), 0.5, STOP_ATR_MAX, 1.5), "why": text(x.get("why"), 160)}
    return dec, pos


def parse_execution(d: dict | None, symbols: set[str]) -> dict[str, dict]:
    res = {s: {"type": "MARKET", "limit_offset_bps": 0.0, "why": "default"} for s in symbols}
    for x in _items(d, "orders"):
        s = text(x.get("symbol"), 20).upper()
        if s in res:
            t = text(x.get("type"), 8).upper()
            off = num(x.get("limit_offset_bps"), 0.0, LIMIT_OFFSET_MAX_BPS, 0.0)
            res[s] = {"type": "LIMIT" if (t == "LIMIT" and off > 0) else "MARKET", "limit_offset_bps": off if t == "LIMIT" else 0.0, "why": text(x.get("why"), 120)}
    return res


def parse_execution_direct(d: dict | None, symbols: set[str]) -> dict[str, dict]:
    """Direct desk: MARKET (buy now) or WAIT (skip this hour). Silence or garbage means WAIT - no order without an explicit MARKET."""
    res = {s: {"type": "WAIT", "why": "no answer from Execution"} for s in symbols}
    for x in _items(d, "orders"):
        s = text(x.get("symbol"), 20).upper()
        if s in res and text(x.get("type"), 8).upper() == "MARKET":
            res[s] = {"type": "MARKET", "why": text(x.get("why"), 120)}
        elif s in res:
            res[s] = {"type": "WAIT", "why": text(x.get("why"), 120)}
    return res


def parse_manager(d: dict | None, symbols: set[str]) -> tuple[dict[str, dict], str]:
    res = {s: {"approve": False, "size_multiplier": 0.0, "why": "no answer from Risk Manager"} for s in symbols}                    # default VETO
    for x in _items(d, "approvals"):
        s = text(x.get("symbol"), 20).upper()
        if s in res:
            ok = x.get("approve") is True
            res[s] = {"approve": ok, "size_multiplier": num(x.get("size_multiplier"), 0.0, 1.0, 0.0) if ok else 0.0, "why": text(x.get("why"), 160)}
    return res, text((d or {}).get("portfolio_note"), 200)


def parse_reviewer(d: dict | None) -> dict:
    causes = {"good_setup", "bad_setup", "bad_luck", "market_regime", "stop_too_tight", "stop_too_loose", "execution"}
    cause = text((d or {}).get("cause"), 20)
    return {"lesson": text((d or {}).get("lesson"), 300), "cause": cause if cause in causes else "unknown", "confidence_was_justified": (d or {}).get("confidence_was_justified") is True}
