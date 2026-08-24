"""
M4.3 -- Standalone, faithful Python port of AT24_GOLD_PDHPDL_RangeBreaker_
v2.10.mq5's real strategy logic (PDH/PDL breakout + EMA/ADX filter +
ATR-based SL/TP + pyramid + breakeven), built specifically for real M4
PARAMETER_SENSITIVITY testing (baseline vs perturbed-input comparison).

Deliberately NOT built on quant_engine/engine.py's run_backtest(), which
only tracks one open position at a time -- this EA pyramids into up to 3
concurrent positions with independent SL/TP each, and engine.py is the
user's own actively-developed shared file; this stays a separate module so
nothing there needs touching for this one-off use. Reuses this program's
own already-verified Wilder ATR/ADX implementations from regime_
classifier.py (same formulas, not reimplemented) plus a new EMA helper.

Every entry/exit/filter/pyramid/breakeven rule below is transcribed
directly from the real .mq5 source (see the file path in main()) --
compare line-by-line against OnTick()/ManagePositions()/CalculateLotSize()
if verifying. Real, documented simplifications versus the actual MT5
execution model:
  - Evaluated once per M15 bar CLOSE, not tick-by-tick (MT5 checks every
    tick) -- an intrabar breakout/exit can be missed or timed slightly
    differently.
  - Spread is a fixed per-trade cost (engine.py's own convention), not a
    per-bar spread-filter gate (InpMaxSpreadPoints is not modeled).
  - Position sizing uses a risk% formula the same size as the real
    tick-value-based one for a standard gold CFD contract, not the
    broker's exact live tick spec.
  - Intrabar SL/TP-both-hit ambiguity resolves conservatively: SL wins.
  - Data source is a different broker feed (Exness, via quant_engine/
    market.db) than the real MT5 report's own broker (Vantage Markets).

This is a SEPARATE backtest engine from the real MT5 Strategy Tester run
that produced the actual PDHPDL-GOLD-v2x Evidence. It is used ONLY for an
internal, apples-to-apples PARAMETER_SENSITIVITY comparison -- baseline
and every perturbed variant run through this exact same engine -- never
presented as equivalent to, or a replacement for, the real MT5-verified
Evidence.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path

from regime_classifier import Candle, _wilder_smooth  # noqa: E402


@dataclass
class Params:
    magic: int = 100002
    max_trades_per_day: int = 1
    risk_percent: float = 1.0
    use_pyramid: bool = True
    max_pyramid_levels: int = 3
    pyramid_lot_multiplier: float = 0.5
    pyramid_trigger_r: float = 1.0
    use_ema_filter: bool = True
    ema_period: int = 100
    use_adx_filter: bool = True
    adx_period: int = 14
    adx_min_level: float = 20.0
    use_time_filter: bool = True
    start_hour: int = 8
    end_hour: int = 17
    atr_period: int = 14
    sl_atr_mult: float = 1.5
    tp_atr_mult: float = 3.0
    use_breakeven: bool = True
    be_trigger_r: float = 1.0
    contract_size: float = 100.0
    spread_price: float = 0.20
    start_balance: float = 10000.0


@dataclass
class Position:
    direction: int  # 1 long, -1 short
    entry: float
    sl: float
    tp: float
    volume: float
    entry_time: datetime
    is_initial: bool
    breakeven_done: bool = False


def load_candles(db_path: Path, symbol: str, timeframe: str) -> list[Candle]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        cur.execute("SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts", (symbol, timeframe))
        rows = cur.fetchall()
    finally:
        conn.close()
    return [Candle(ts=datetime.fromisoformat(r[0]).replace(tzinfo=None), open=r[1], high=r[2], low=r[3], close=r[4]) for r in rows]


def compute_ema(closes: list[float], period: int) -> list[float]:
    k = 2 / (period + 1)
    ema = [float("nan")] * len(closes)
    if len(closes) < period:
        return ema
    seed = sum(closes[:period]) / period
    ema[period - 1] = seed
    for i in range(period, len(closes)):
        ema[i] = closes[i] * k + ema[i - 1] * (1 - k)
    return ema


def compute_atr_series(candles: list[Candle], period: int) -> list[float]:
    trs = [candles[0].high - candles[0].low]
    for i in range(1, len(candles)):
        h, l, prev_c = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
    smoothed = _wilder_smooth(trs, period)
    return [s / period if s == s else float("nan") for s in smoothed]


def compute_adx_series(candles: list[Candle], period: int) -> list[float]:
    from regime_classifier import compute_adx
    return compute_adx(candles, period)


def compute_prev_day_high_low(candles: list[Candle]) -> dict[date, tuple[float, float]]:
    daily: dict[date, tuple[float, float]] = {}
    for c in candles:
        d = c.ts.date()
        if d not in daily:
            daily[d] = (c.high, c.low)
        else:
            hi, lo = daily[d]
            daily[d] = (max(hi, c.high), min(lo, c.low))
    days_sorted = sorted(daily.keys())
    prev_day_levels: dict[date, tuple[float, float]] = {}
    for i in range(1, len(days_sorted)):
        prev_day_levels[days_sorted[i]] = daily[days_sorted[i - 1]]
    return prev_day_levels


def run_pdhpdl_backtest(candles: list[Candle], p: Params) -> tuple[list[dict], dict]:
    closes = [c.close for c in candles]
    ema = compute_ema(closes, p.ema_period) if p.use_ema_filter else [float("nan")] * len(candles)
    adx = compute_adx_series(candles, p.adx_period) if p.use_adx_filter else [float("nan")] * len(candles)
    atr = compute_atr_series(candles, p.atr_period)
    prev_day_levels = compute_prev_day_high_low(candles)

    balance = p.start_balance
    equity_curve: list[float] = []
    trades: list[dict] = []
    positions: list[Position] = []
    trades_today = 0
    last_day: date | None = None

    warmup = max(p.ema_period if p.use_ema_filter else 0, p.adx_period if p.use_adx_filter else 0, p.atr_period) + 1

    for i in range(warmup, len(candles)):
        c = candles[i]
        day = c.ts.date()
        if day != last_day:
            trades_today = 0
            last_day = day

        current_atr = atr[i]
        if current_atr != current_atr or current_atr <= 0:
            floating = sum((c.close - pos.entry) * pos.direction * pos.volume * p.contract_size for pos in positions)
            equity_curve.append(balance + floating)
            continue

        # ---- manage existing positions: SL/TP, breakeven, pyramid (mirrors ManagePositions()) ----
        still_open: list[Position] = []
        for pos in positions:
            hit_sl = (c.low <= pos.sl) if pos.direction > 0 else (c.high >= pos.sl)
            hit_tp = (c.high >= pos.tp) if pos.direction > 0 else (c.low <= pos.tp)
            if hit_sl or hit_tp:
                exit_price = pos.sl if hit_sl else pos.tp  # conservative: SL wins on an ambiguous bar
                reason = "SL" if hit_sl else "TP"
                pnl = (exit_price - pos.entry) * pos.direction * pos.volume * p.contract_size
                balance += pnl
                trades.append(dict(
                    entry_time=pos.entry_time.isoformat(), exit_time=c.ts.isoformat(), direction=pos.direction,
                    entry_price=pos.entry, exit_price=exit_price, volume=pos.volume, profit=round(pnl, 2),
                    reason=reason, is_initial=pos.is_initial,
                ))
                continue  # closed, drop from still_open
            still_open.append(pos)
        positions = still_open

        for pos in positions:
            # 1. breakeven (applies to every open position, matching ManagePositions())
            if p.use_breakeven and not pos.breakeven_done:
                trigger_dist = current_atr * p.sl_atr_mult * p.be_trigger_r
                if pos.direction > 0 and (c.close - pos.entry) >= trigger_dist and pos.sl < pos.entry:
                    pos.sl = pos.entry + 0.001  # ~10 points lock, negligible for gold price scale
                    pos.breakeven_done = True
                elif pos.direction < 0 and (pos.entry - c.close) >= trigger_dist and (pos.sl > pos.entry or pos.sl == 0):
                    pos.sl = pos.entry - 0.001
                    pos.breakeven_done = True

            # 2. pyramid (only from the initial position, matching ManagePositions()'s "Initial" filter)
            if p.use_pyramid and pos.is_initial:
                pyramid_count = len(positions) - 1  # positions minus the initial one
                if pyramid_count < p.max_pyramid_levels - 1:
                    profit_dist = current_atr * p.sl_atr_mult * p.pyramid_trigger_r
                    triggered = (c.close - pos.entry) >= profit_dist if pos.direction > 0 else (pos.entry - c.close) >= profit_dist
                    if triggered:
                        pyramid_lot = round(pos.volume * p.pyramid_lot_multiplier, 2)
                        if pyramid_lot > 0:
                            entry_px = c.close + (p.spread_price / 2) * pos.direction
                            new_sl = entry_px - p.sl_atr_mult * current_atr * pos.direction
                            new_tp = entry_px + p.tp_atr_mult * current_atr * pos.direction
                            positions.append(Position(direction=pos.direction, entry=entry_px, sl=new_sl, tp=new_tp,
                                                       volume=pyramid_lot, entry_time=c.ts, is_initial=False))

        # ---- new initial entry (mirrors OnTick() sections 3-11) ----
        if trades_today < p.max_trades_per_day and not any(pos.is_initial for pos in positions):
            if p.use_time_filter and not (p.start_hour <= c.ts.hour < p.end_hour):
                pass
            elif p.use_adx_filter and (adx[i] != adx[i] or adx[i] < p.adx_min_level):
                pass
            else:
                trend = 0
                if p.use_ema_filter:
                    if ema[i] == ema[i]:
                        trend = 1 if c.close > ema[i] else (-1 if c.close < ema[i] else 0)
                levels = prev_day_levels.get(day)
                if levels:
                    pdh, pdl = levels
                    sl_dist = current_atr * p.sl_atr_mult
                    tp_dist = current_atr * p.tp_atr_mult
                    risk_amount = balance * (p.risk_percent / 100.0)
                    lot = round(risk_amount / (sl_dist * p.contract_size), 2) if sl_dist > 0 else 0
                    if lot > 0:
                        if c.close > pdh and trend in (0, 1):
                            entry_px = c.close + p.spread_price / 2
                            positions.append(Position(direction=1, entry=entry_px, sl=entry_px - sl_dist, tp=entry_px + tp_dist,
                                                       volume=lot, entry_time=c.ts, is_initial=True))
                            trades_today += 1
                        elif c.close < pdl and trend in (0, -1):
                            entry_px = c.close - p.spread_price / 2
                            positions.append(Position(direction=-1, entry=entry_px, sl=entry_px + sl_dist, tp=entry_px - tp_dist,
                                                       volume=lot, entry_time=c.ts, is_initial=True))
                            trades_today += 1

        floating = sum((c.close - pos.entry) * pos.direction * pos.volume * p.contract_size for pos in positions)
        equity_curve.append(balance + floating)

    return trades, summarize(trades, equity_curve, p)


def summarize(trades: list[dict], equity_curve: list[float], p: Params) -> dict:
    if not trades:
        return {"tradeCount": 0, "netProfit": 0.0, "profitFactor": None, "winRate": None, "maxDrawdownPercent": 0.0, "finalBalance": p.start_balance}
    profits = [t["profit"] for t in trades]
    wins = [x for x in profits if x > 0]
    losses = [x for x in profits if x <= 0]
    gross_win = sum(wins)
    gross_loss = -sum(losses)
    pf = gross_win / gross_loss if gross_loss > 0 else None
    net_profit = sum(profits)
    final_balance = p.start_balance + net_profit

    peak = equity_curve[0] if equity_curve else p.start_balance
    max_dd_pct = 0.0
    for e in equity_curve:
        peak = max(peak, e)
        if peak > 0:
            max_dd_pct = max(max_dd_pct, (peak - e) / peak * 100)

    return {
        "tradeCount": len(trades),
        "netProfit": round(net_profit, 2),
        "profitFactor": round(pf, 4) if pf is not None else None,
        "winRate": round(len(wins) / len(trades), 4),
        "maxDrawdownPercent": round(max_dd_pct, 2),
        "finalBalance": round(final_balance, 2),
    }
