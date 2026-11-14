"""Agent 4 - Strategy: the entry rule. Long only. A signal exists on a CLOSED candle when ALL of these hold:
  1. breakout     - the close is above the highest high of the previous N candles
  2. volume       - the candle's volume is at least k x the average of the previous N candles
  3. trend        - the close is above the long EMA (no breakouts against the trend)
  4. conviction   - the candle closed up (close > open)
The order is filled at the NEXT candle's open (never at a price that was already gone). Exits: ATR stop, ATR chandelier trail, time stop."""
from __future__ import annotations

import math
from dataclasses import dataclass

from ..config import Params


@dataclass(frozen=True)
class Signal:
    symbol: str
    atr: float
    rel_volume: float
    signal_close: float


class Strategy:
    def __init__(self, p: Params):
        self.p = p

    def evaluate(self, symbol: str, row: dict) -> Signal | None:
        for k in ("atr", "rel_volume", "prior_high", "ema_trend"):
            v = row.get(k)
            if v is None or (isinstance(v, float) and math.isnan(v)):
                return None
        if not (row["breakout"] and row["trend_ok"] and row["bullish"] and row["rel_volume"] >= self.p.min_rel_volume):
            return None
        if row["atr"] <= 0:
            return None
        return Signal(symbol, float(row["atr"]), float(row["rel_volume"]), float(row["close"]))

    def initial_stop(self, entry: float, atr: float) -> float:
        return entry - self.p.stop_atr * atr

    def trail_stop(self, highest_high: float, atr: float) -> float:
        return highest_high - self.p.trail_atr * atr
