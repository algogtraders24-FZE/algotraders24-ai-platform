"""Agent 1 - Scout: finds symbols whose volume just spiked while price pushed up. On Binance there are no brand-new pairs every minute
(unlike DEXs), so 'new pairs' is replaced by 'abnormal volume on liquid existing pairs'. It only nominates; it never decides to trade."""
from __future__ import annotations

import math
from dataclasses import dataclass

from ..config import Params


@dataclass(frozen=True)
class Candidate:
    symbol: str
    rel_volume: float


class Scout:
    def __init__(self, p: Params):
        self.p = p

    def scan(self, rows: dict[str, dict]) -> list[Candidate]:
        """rows: {symbol: latest closed-candle feature row}. Returns the strongest `scout_top` volume spikes (up candles only)."""
        out = []
        for sym, r in rows.items():
            rv = r.get("rel_volume")
            if rv is None or (isinstance(rv, float) and math.isnan(rv)):
                continue
            if rv >= self.p.min_rel_volume * 0.75 and r["bullish"]:   # nominate a bit below the Strategy's own threshold
                out.append(Candidate(sym, float(rv)))
        out.sort(key=lambda c: c.rel_volume, reverse=True)
        return out[: self.p.scout_top]
