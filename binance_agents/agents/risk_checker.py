"""Agent 2 - Risk Checker: is this market safe to trade at all? On a centralised exchange there is no rug-pull / holder-concentration /
contract risk, so the checks that matter are LIQUIDITY and tradability:
  - historical + live: 24h quote volume above a floor, not a leveraged token or stablecoin pair
  - live only: spread, order-book depth versus the order size, symbol status == TRADING
(Spread and depth are not stored historically, so the backtest can only apply the volume check - the README states this.)"""
from __future__ import annotations

import math

from ..config import Live, Params

BAD_SUFFIXES = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")
STABLES = {"USDCUSDT", "TUSDUSDT", "FDUSDUSDT", "USDPUSDT", "BUSDUSDT", "EURUSDT", "DAIUSDT"}


class RiskChecker:
    def __init__(self, p: Params, live: Live):
        self.p = p
        self.live = live

    def tradable_name(self, symbol: str) -> bool:
        return symbol.endswith("USDT") and symbol not in STABLES and not symbol.endswith(BAD_SUFFIXES)

    def check_bar(self, symbol: str, row: dict) -> tuple[bool, str]:
        if not self.tradable_name(symbol):
            return False, "not a normal USDT spot pair"
        qv = row.get("quote_vol_24h")
        if qv is None or (isinstance(qv, float) and math.isnan(qv)) or qv < self.p.min_quote_vol_24h:
            return False, f"24h quote volume below {self.p.min_quote_vol_24h:,.0f}"
        return True, "ok"

    def check_live(self, symbol: str, book: dict, status: str, notional: float) -> tuple[bool, str]:
        """book = Binance /depth payload. Depth is measured within 0.5% of the mid price."""
        if status != "TRADING":
            return False, f"symbol status {status}"
        bids = [(float(p), float(q)) for p, q in book["bids"]]
        asks = [(float(p), float(q)) for p, q in book["asks"]]
        if not bids or not asks:
            return False, "empty order book"
        bid, ask = bids[0][0], asks[0][0]
        mid = (bid + ask) / 2.0
        spread_bps = (ask - bid) / mid * 1e4
        if spread_bps > self.live.max_spread_bps:
            return False, f"spread {spread_bps:.1f} bps"
        depth = sum(p * q for p, q in asks if p <= mid * 1.005)
        if depth < notional * self.live.min_depth_multiple:
            return False, f"ask depth {depth:,.0f} USDT is under {self.live.min_depth_multiple}x the order"
        return True, "ok"
