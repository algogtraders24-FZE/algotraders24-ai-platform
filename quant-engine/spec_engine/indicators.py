"""Shared indicator math — same formulas the MQL5/Pine codegen mirror."""
import numpy as np
import pandas as pd


def ema(s: pd.Series, period: int) -> pd.Series:
    return s.ewm(span=period, adjust=False).mean()


def sma(s: pd.Series, period: int) -> pd.Series:
    return s.rolling(period).mean()


def wilder(s: pd.Series, period: int) -> pd.Series:
    return s.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = wilder(gain, period)
    avg_loss = wilder(loss, period)
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def atr(high, low, close, period) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return wilder(tr, period)


def macd(close: pd.Series, fast=12, slow=26, signal=9):
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def bollinger(close: pd.Series, period=20, mult=2.0):
    mid = sma(close, period)
    std = close.rolling(period).std()
    upper = mid + mult * std
    lower = mid - mult * std
    return upper, mid, lower


def stochastic(high, low, close, k_period=14, d_period=3):
    lowest_low = low.rolling(k_period).min()
    highest_high = high.rolling(k_period).max()
    rng = (highest_high - lowest_low).replace(0, np.nan)
    k = 100 * (close - lowest_low) / rng
    d = k.rolling(d_period).mean()
    return k, d


def adx(high, low, close, period=14):
    """Wilder's ADX/+DI/-DI — same smoothing as atr()'s wilder()."""
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    plus_dm = pd.Series(plus_dm, index=high.index)
    minus_dm = pd.Series(minus_dm, index=high.index)

    atr_smooth = atr(high, low, close, period)
    plus_di = 100 * wilder(plus_dm, period) / atr_smooth.replace(0, np.nan)
    minus_di = 100 * wilder(minus_dm, period) / atr_smooth.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx_line = wilder(dx, period)
    return adx_line, plus_di, minus_di


def donchian(high, low, period=20):
    """Highest/lowest of the PRIOR `period` bars, excluding the current bar
    (shift(1) before rolling) — a breakout condition like close > upper
    would be nearly impossible to trigger if today's own high were counted
    in today's channel. This matches the standard Donchian/Turtle breakout
    definition (today's close vs. the range set by bars before today)."""
    upper = high.shift(1).rolling(period).max()
    lower = low.shift(1).rolling(period).min()
    middle = (upper + lower) / 2
    return upper, middle, lower


def supertrend(high, low, close, period=10, mult=3.0):
    """Standard iterative Supertrend (matches TradingView's ta.supertrend
    and the common reference algorithm). Returns (line, trend) where
    trend is +1/-1. Iterative by nature — vectorizing it would change the
    result, so this is a plain Python loop (fine at our data sizes)."""
    atr_line = atr(high, low, close, period)
    hl2 = (high + low) / 2
    basic_upper = hl2 + mult * atr_line
    basic_lower = hl2 - mult * atr_line

    n = len(close)
    final_upper = np.zeros(n)
    final_lower = np.zeros(n)
    line = np.zeros(n)
    trend = np.zeros(n, dtype=int)

    bu, bl, c = basic_upper.values, basic_lower.values, close.values

    final_upper[0] = bu[0]
    final_lower[0] = bl[0]
    line[0] = bu[0]
    trend[0] = 1

    for i in range(1, n):
        final_upper[i] = bu[i] if (bu[i] < final_upper[i - 1] or c[i - 1] > final_upper[i - 1]) else final_upper[i - 1]
        final_lower[i] = bl[i] if (bl[i] > final_lower[i - 1] or c[i - 1] < final_lower[i - 1]) else final_lower[i - 1]

        prev_line = line[i - 1]
        if prev_line == final_upper[i - 1]:
            if c[i] <= final_upper[i]:
                line[i], trend[i] = final_upper[i], -1
            else:
                line[i], trend[i] = final_lower[i], 1
        else:  # prev_line == final_lower[i-1]
            if c[i] >= final_lower[i]:
                line[i], trend[i] = final_lower[i], 1
            else:
                line[i], trend[i] = final_upper[i], -1

    return pd.Series(line, index=close.index), pd.Series(trend, index=close.index)


def compute_all(df: pd.DataFrame, indicator_specs: list) -> pd.DataFrame:
    """Adds one column per indicator (flattened: id_field for multi-output) to df."""
    for ind in indicator_specs:
        t, iid = ind["type"], ind["id"]
        if t == "EMA":
            df[iid] = ema(df["close"], ind["period"])
        elif t == "SMA":
            df[iid] = sma(df["close"], ind["period"])
        elif t == "RSI":
            df[iid] = rsi(df["close"], ind["period"])
        elif t == "ATR":
            df[iid] = atr(df["high"], df["low"], df["close"], ind["period"])
        elif t == "MACD":
            m, s, h = macd(df["close"], ind.get("fast", 12), ind.get("slow", 26), ind.get("signal", 9))
            df[f"{iid}.line"], df[f"{iid}.signal"], df[f"{iid}.hist"] = m, s, h
        elif t == "BB":
            u, mid, l = bollinger(df["close"], ind.get("period", 20), ind.get("mult", 2.0))
            df[f"{iid}.upper"], df[f"{iid}.middle"], df[f"{iid}.lower"] = u, mid, l
        elif t == "STOCH":
            k, d = stochastic(df["high"], df["low"], df["close"],
                               ind.get("k_period", 14), ind.get("d_period", 3))
            df[f"{iid}.k"], df[f"{iid}.d"] = k, d
        elif t == "ADX":
            a, pdi, mdi = adx(df["high"], df["low"], df["close"], ind.get("period", 14))
            df[f"{iid}.adx"], df[f"{iid}.plus_di"], df[f"{iid}.minus_di"] = a, pdi, mdi
        elif t == "DONCHIAN":
            u, mid, l = donchian(df["high"], df["low"], ind.get("period", 20))
            df[f"{iid}.upper"], df[f"{iid}.middle"], df[f"{iid}.lower"] = u, mid, l
        elif t == "SUPERTREND":
            line, trend = supertrend(df["high"], df["low"], df["close"],
                                      ind.get("period", 10), ind.get("mult", 3.0))
            df[f"{iid}.line"], df[f"{iid}.trend"] = line, trend
        else:
            raise ValueError(f"unsupported indicator type {t}")
    return df
