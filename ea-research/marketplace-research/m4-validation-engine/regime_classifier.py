"""
M4.2 -- Market Regime Classifier. Real, deterministic, stdlib-only (no
pandas/numpy, matching the M2-M7 engines' own "standalone research tool"
convention). Classifies each M15 candle into one of four regimes using two
independent, standard technical measures computed directly from real OHLC
data:

  - TREND axis: Wilder's ADX(14) -- ADX >= 25 is the conventional
    "trending" threshold (Welles Wilder's own original guidance, not an
    invented number); below it is RANGING.
  - VOLATILITY axis: ATR(14) as a percentage of close price, compared
    against its own median across the whole loaded series -- above the
    median is HIGH_VOL, at or below is LOW_VOL. Relative to the dataset's
    own distribution, not an absolute magic number.

Combined: TRENDING_HIGH_VOL | TRENDING_LOW_VOL | RANGING_HIGH_VOL |
RANGING_LOW_VOL. A trade is tagged with whichever regime was active on
the candle at-or-immediately-before its recorded timestamp (nearest prior
bar, never a future bar -- no look-ahead).

Data source: quant_engine/market.db (SQLite, real Exness M15 OHLC,
2024-01-01 to 2026-05-31 as of this writing -- see that project's own
data_import.py for provenance). This is a DIFFERENT broker feed than the
Vantage Markets feed the actual backtest report came from -- gold price
action tracks extremely closely across brokers (shared underlying market),
but this is a real, disclosed data-provenance difference, not treated as
identical. Regime classification is real; the exact regime boundary for
a trade within a few minutes of a shift is inherently approximate given
this cross-broker limitation.

No new invented validation logic -- this module only produces the
`marketRegime` tag M4's own validate_regime_coverage() (validation_engine.py)
already looks for and has looked for since it was written; that function
itself is untouched.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

ADX_PERIOD = 14
ATR_PERIOD = 14
ADX_TREND_THRESHOLD = 25.0  # Wilder's own original convention


@dataclass
class Candle:
    ts: datetime
    open: float
    high: float
    low: float
    close: float


def load_candles(db_path: Path, symbol: str, timeframe: str) -> list[Candle]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
            (symbol, timeframe),
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    candles = []
    for ts_str, o, h, l, c in rows:
        # Candle ts carries an explicit UTC offset ("...+00:00") -- stripped
        # to a naive UTC datetime for direct comparison against trade
        # timestamps, which carry no timezone marker at all (see module
        # docstring's cross-broker/timezone disclosure).
        ts = datetime.fromisoformat(ts_str).replace(tzinfo=None)
        candles.append(Candle(ts=ts, open=o, high=h, low=l, close=c))
    return candles


def _wilder_smooth(values: list[float], period: int) -> list[float]:
    """Wilder's own smoothing (not a simple/exponential moving average) --
    the exact recurrence ADX/ATR are both defined with."""
    smoothed: list[float] = []
    running = sum(values[:period])
    smoothed.extend([float("nan")] * (period - 1))
    smoothed.append(running)
    for v in values[period:]:
        running = running - (running / period) + v
        smoothed.append(running)
    return smoothed


def compute_atr(candles: list[Candle], period: int = ATR_PERIOD) -> list[float]:
    trs = [candles[0].high - candles[0].low]
    for i in range(1, len(candles)):
        h, l, prev_c = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
    smoothed = _wilder_smooth(trs, period)
    return [s / period if s == s else float("nan") for s in smoothed]  # s==s filters NaN


def compute_adx(candles: list[Candle], period: int = ADX_PERIOD) -> list[float]:
    plus_dm = [0.0]
    minus_dm = [0.0]
    trs = [candles[0].high - candles[0].low]
    for i in range(1, len(candles)):
        up_move = candles[i].high - candles[i - 1].high
        down_move = candles[i - 1].low - candles[i].low
        plus_dm.append(up_move if (up_move > down_move and up_move > 0) else 0.0)
        minus_dm.append(down_move if (down_move > up_move and down_move > 0) else 0.0)
        h, l, prev_c = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))

    smoothed_tr = _wilder_smooth(trs, period)
    smoothed_plus_dm = _wilder_smooth(plus_dm, period)
    smoothed_minus_dm = _wilder_smooth(minus_dm, period)

    dx_values: list[float] = []
    for tr, pdm, mdm in zip(smoothed_tr, smoothed_plus_dm, smoothed_minus_dm):
        if tr != tr or tr == 0:  # NaN or zero-guard
            dx_values.append(float("nan"))
            continue
        plus_di = 100 * pdm / tr
        minus_di = 100 * mdm / tr
        di_sum = plus_di + minus_di
        dx_values.append(100 * abs(plus_di - minus_di) / di_sum if di_sum > 0 else 0.0)

    valid_dx = [d for d in dx_values if d == d]
    adx_smoothed = _wilder_smooth(valid_dx, period) if len(valid_dx) > period else []
    # Re-align the ADX series (which starts `period` bars later than DX)
    # back onto the original candle index, padding the warm-up with NaN.
    first_valid_idx = next((i for i, d in enumerate(dx_values) if d == d), len(dx_values))
    adx_full = [float("nan")] * len(candles)
    for i, val in enumerate(adx_smoothed):
        idx = first_valid_idx + period - 1 + i
        if idx < len(adx_full):
            adx_full[idx] = val / period if val == val else float("nan")
    return adx_full


def classify_regimes(candles: list[Candle]) -> dict[datetime, str]:
    atr = compute_atr(candles)
    adx = compute_adx(candles)
    atr_pct = [(a / c.close * 100) if (a == a and c.close) else float("nan") for a, c in zip(atr, candles)]
    valid_atr_pct = sorted(v for v in atr_pct if v == v)
    if not valid_atr_pct:
        return {}
    median_atr_pct = valid_atr_pct[len(valid_atr_pct) // 2]

    regimes: dict[datetime, str] = {}
    for i, c in enumerate(candles):
        if adx[i] != adx[i] or atr_pct[i] != atr_pct[i]:  # warm-up period, not yet computable
            continue
        trend = "TRENDING" if adx[i] >= ADX_TREND_THRESHOLD else "RANGING"
        vol = "HIGH_VOL" if atr_pct[i] > median_atr_pct else "LOW_VOL"
        regimes[c.ts] = f"{trend}_{vol}"
    return regimes


def regime_at_or_before(regimes: dict[datetime, str], candle_timestamps: list[datetime], target: datetime) -> str | None:
    """Nearest prior (or exact) bar's regime -- never looks at a future bar
    relative to `target` (no look-ahead into the trade's own outcome)."""
    import bisect

    idx = bisect.bisect_right(candle_timestamps, target) - 1
    while idx >= 0:
        ts = candle_timestamps[idx]
        if ts in regimes:
            return regimes[ts]
        idx -= 1
    return None
