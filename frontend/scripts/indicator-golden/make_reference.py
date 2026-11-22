"""Builds the golden files for the chart-indicator accuracy test.

Real candles come from a MetaTrader 5 terminal (python MetaTrader5 package); the reference values come from implementations that do NOT share code
with lib/market-data/indicators.ts: the `ta` library where its definition matches, and plain pandas / loops where it does not (Stochastic 5-3-3 slow,
ADX, Parabolic SAR). Run (venv with `ta` and MetaTrader5):
    python scripts/indicator-golden/make_reference.py EURUSD 900 out.json
Then check with:  npx tsx scripts/validate-indicator-golden.ts out.json
"""
import json
import sys

import MetaTrader5 as mt5
import numpy as np
import pandas as pd
from ta.momentum import AwesomeOscillatorIndicator, RSIIndicator, WilliamsRIndicator
from ta.trend import CCIIndicator, EMAIndicator, MACD, SMAIndicator, IchimokuIndicator
from ta.volatility import AverageTrueRange, BollingerBands

symbol, bars, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
assert mt5.initialize(), mt5.last_error()
rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 1, bars)  # start at 1: skip the forming candle
mt5.shutdown()
df = pd.DataFrame(rates)
df["time"] = df["time"].astype("int64") * 1000
o, h, l, c = df["open"], df["high"], df["low"], df["close"]


def series(s):
    return [None if (v is None or (isinstance(v, float) and np.isnan(v))) else round(float(v), 10) for v in s]


ref = {}
ref["sma20"] = series(SMAIndicator(c, 20).sma_indicator())
ref["ema20"] = series(EMAIndicator(c, 20).ema_indicator())
ref["ema50"] = series(EMAIndicator(c, 50).ema_indicator())
ref["rsi14"] = series(RSIIndicator(c, 14).rsi())
ref["atr14"] = series(AverageTrueRange(h, l, c, 14).average_true_range())
m = MACD(c, window_slow=26, window_fast=12, window_sign=9)
ref["macd"], ref["macd_signal"], ref["macd_hist"] = series(m.macd()), series(m.macd_signal()), series(m.macd_diff())
bb = BollingerBands(c, 20, 2)  # population std (ddof=0)
ref["bb_upper"], ref["bb_mid"], ref["bb_lower"] = series(bb.bollinger_hband()), series(bb.bollinger_mavg()), series(bb.bollinger_lband())
ref["cci14"] = series(CCIIndicator(h, l, c, 14, 0.015).cci())
ref["willr14"] = series(WilliamsRIndicator(h, l, c, 14).williams_r())
ref["ao"] = series(AwesomeOscillatorIndicator(h, l, 5, 34).awesome_oscillator())
ich = IchimokuIndicator(h, l, 9, 26, 52, visual=False)
ref["ichi_tenkan"], ref["ichi_kijun"] = series(ich.ichimoku_conversion_line()), series(ich.ichimoku_base_line())

# MT5's default Stochastic (5, 3, 3, slow): raw %K over 5 bars, slowed by an SMA(3), %D = SMA(3) of that
hh, ll = h.rolling(5).max(), l.rolling(5).min()
raw_k = ((c - ll) / (hh - ll) * 100).where(hh != ll, 50.0)
k = raw_k.rolling(3).mean()
ref["stoch_k"], ref["stoch_d"] = series(k), series(k.rolling(3).mean())

# MT5 conventions (MQL5\\Indicators\\Examples\\ATR.mq5 and MACD.mq5): ATR = simple average of the true range, MACD signal = simple average of the MACD line
tr_s = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
tr_s.iloc[0] = np.nan  # MT5 starts the true range at the second bar
ref["atr14_mt5"] = series(tr_s.rolling(14).mean())
macd_line = pd.Series(ref["macd"], dtype=float)
sig_sma = macd_line.rolling(9).mean()
ref["macd_signal_mt5"], ref["macd_hist_mt5"] = series(sig_sma), series(macd_line - sig_sma)

# Wilder ADX 14: plain loops, SMA seed then Wilder smoothing (deliberately not the same code path as the TypeScript)
n = 14
H, L, C = h.values, l.values, c.values
tr = np.zeros(len(C)); pdm = np.zeros(len(C)); mdm = np.zeros(len(C))
for i in range(1, len(C)):
    tr[i] = max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    up, dn = H[i] - H[i - 1], L[i - 1] - L[i]
    pdm[i] = up if (up > dn and up > 0) else 0.0
    mdm[i] = dn if (dn > up and dn > 0) else 0.0


def wilder(x, start):
    out_ = np.full(len(x), np.nan)
    out_[start + n - 1] = x[start:start + n].mean()
    for i in range(start + n, len(x)):
        out_[i] = (out_[i - 1] * (n - 1) + x[i]) / n
    return out_


s_tr, s_p, s_m = wilder(tr, 1), wilder(pdm, 1), wilder(mdm, 1)
pdi, mdi = 100 * s_p / s_tr, 100 * s_m / s_tr
dx = 100 * np.abs(pdi - mdi) / (pdi + mdi)
adx = np.full(len(C), np.nan)
first = n  # first valid dx index is n (1 + n - 1)
adx[first + n - 1] = np.nanmean(dx[first:first + n])
for i in range(first + n, len(C)):
    adx[i] = (adx[i - 1] * (n - 1) + dx[i]) / n
ref["adx14"], ref["plus_di14"], ref["minus_di14"] = series(adx), series(pdi), series(mdi)

# Parabolic SAR: a line-by-line port of MetaQuotes' own MQL5\Indicators\Examples\ParabolicSAR.mq5 (step 0.02, maximum 0.2), so the reference IS MT5's algorithm
def mt5_sar(hi, lo, step=0.02, maximum=0.2):
    n_ = len(hi)
    sar = [0.0] * n_; ep = [0.0] * n_; af = [0.0] * n_
    af[0] = af[1] = step
    sar[0] = hi[0]
    last = 0
    is_long = False
    sar[1] = max(hi[last:2])
    ep[0] = ep[1] = lo[1]
    for i in range(1, n_ - 1):
        if is_long:
            if sar[i] > lo[i]:
                is_long = False
                sar[i] = max(hi[last:i + 1]); ep[i] = lo[i]; last = i; af[i] = step
        else:
            if sar[i] < hi[i]:
                is_long = True
                sar[i] = min(lo[last:i + 1]); ep[i] = hi[i]; last = i; af[i] = step
        if is_long:
            if hi[i] > ep[i - 1] and i != last:
                ep[i] = hi[i]; af[i] = min(af[i - 1] + step, maximum)
            elif i != last:
                af[i] = af[i - 1]; ep[i] = ep[i - 1]
            sar[i + 1] = sar[i] + af[i] * (ep[i] - sar[i])
            if sar[i + 1] > lo[i] or sar[i + 1] > lo[i - 1]:
                sar[i + 1] = min(lo[i], lo[i - 1])
        else:
            if lo[i] < ep[i - 1] and i != last:
                ep[i] = lo[i]; af[i] = min(af[i - 1] + step, maximum)
            elif i != last:
                af[i] = af[i - 1]; ep[i] = ep[i - 1]
            sar[i + 1] = sar[i] + af[i] * (ep[i] - sar[i])
            if sar[i + 1] < hi[i] or sar[i + 1] < hi[i - 1]:
                sar[i + 1] = max(hi[i], hi[i - 1])
    return sar


ref["psar"] = series(mt5_sar(list(h.values), list(l.values)))

json.dump({"symbol": symbol, "candles": [{"time": int(t), "open": float(a), "high": float(b), "low": float(d), "close": float(e)} for t, a, b, d, e in zip(df["time"], o, h, l, c)], "ref": ref}, open(out, "w"))
print(symbol, len(df), "candles,", len(ref), "reference series ->", out)
