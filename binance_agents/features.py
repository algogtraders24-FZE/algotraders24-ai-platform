"""Per-symbol feature frame. Every value on row i uses ONLY candles up to and including candle i (a closed candle), never anything later:
rolling windows that must exclude the current candle are shifted by one. tests/test_no_lookahead.py checks this property directly."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import Params


def compute_features(df: pd.DataFrame, p: Params) -> pd.DataFrame:
    f = pd.DataFrame(index=df.index)
    f["open_time"] = df["open_time"]
    f["open"], f["high"], f["low"], f["close"] = df["open"], df["high"], df["low"], df["close"]
    f["volume"], f["quote_volume"] = df["volume"], df["quote_volume"]

    prev_close = df["close"].shift(1)
    tr = pd.concat([(df["high"] - df["low"]), (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    f["atr"] = tr.ewm(alpha=1.0 / p.atr_n, adjust=False, min_periods=p.atr_n).mean()

    f["prior_high"] = df["high"].rolling(p.breakout_n).max().shift(1)          # highest high of the PREVIOUS n candles
    mean_vol = df["volume"].rolling(p.breakout_n).mean().shift(1)
    f["rel_volume"] = df["volume"] / mean_vol.replace(0, np.nan)
    f["ema_trend"] = df["close"].ewm(span=p.ema_trend, adjust=False, min_periods=p.ema_trend).mean()
    f["quote_vol_24h"] = df["quote_volume"].rolling(24).sum()
    f["breakout"] = df["close"] > f["prior_high"]
    f["bullish"] = df["close"] > df["open"]
    f["trend_ok"] = df["close"] > f["ema_trend"]
    return f
