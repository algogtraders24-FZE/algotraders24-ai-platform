"""
Multi-timeframe execution engine: signals detected on the spec's own
timeframe (e.g. 1h close), fills/SL/TP/position-management resolved
minute-by-minute against real 1-minute bars - the same idea as MT5's
"OHLC M1" Strategy Tester modeling quality (replay through finer control
points instead of trusting the signal bar's own coarse High/Low), except
built from real Exness ticks resampled to 1m rather than MT5's synthetic
M1 generation.

This exists alongside runner.py's original single-timeframe engine
(spec_engine.runner.run_spec_backtest), which stays untouched - demo.py
and the strategy library depend on its exact numbers. Use THIS engine
when real minute data is available and execution realism matters more
than matching the original quick-prototype numbers.

What this fixes vs. the single-timeframe engine:
  1. Same-bar SL+TP ambiguity: the coarse engine checks the signal bar's
     own high/low, so if a 1h bar's range touches both SL and TP there is
     no way to know which happened first. Replaying real 1-minute bars
     resolves this chronologically for the vast majority of cases (still
     ambiguous only in the rare case both are touched inside the SAME
     minute - handled explicitly below, not silently).
  2. Static assumed spread -> real, time-varying spread per minute
     (candle_spread.avg_spread from the importer), applied at both entry
     and exit like a real broker fills against bid/ask.
  3. Position management (breakeven/trailing/partial) re-evaluated every
     minute instead of once per signal bar, matching how a live EA's
     OnTick actually runs.

What this does NOT add (still a simplification vs. a true tick replay):
  - Intra-minute ordering when a single minute's range touches both SL
    and TP: resolved as SL-first (pessimistic, matches MT5's own
    conservative default for OHLC-based modeling) - and counted, so the
    frequency of this edge case is visible rather than hidden.
  - Commission/swap: still zero unless the caller adds it externally: the
    schema doesn't carry broker-specific commission tables, so inventing
    a number here would be exactly the kind of fabricated assumption this
    project's own report warns against. Pass a per-lot commission via
    risk.commission_per_lot if/when that becomes a real, sourced number.
"""
import pandas as pd

from .indicators import compute_all
from .interpreter import evaluate_entry
from .schema import validate_spec


def run_spec_backtest_mtf(df_signal: pd.DataFrame, df_exec: pd.DataFrame, spec: dict, risk):
    """
    df_signal: OHLC bars at the spec's own timeframe (e.g. 1h), columns
        ts/open/high/low/close - same shape run_spec_backtest expects.
    df_exec: OHLC bars at finer (typically 1m) granularity spanning the
        same period, columns ts/open/high/low/close, optionally 'spread'
        (real avg bid-ask spread for that bar). Falls back to
        risk.spread_price if 'spread' is absent.
    """
    errors = validate_spec(spec)
    if errors:
        raise ValueError(f"invalid spec: {errors}")

    sig = compute_all(df_signal.copy(), spec["indicators"]).dropna().reset_index(drop=True)
    if len(sig) < 50:
        return pd.DataFrame(), pd.Series(dtype=float), {"trades_total": 0, "error": "not enough signal bars"}

    ex = df_exec.sort_values("ts").reset_index(drop=True)
    if "spread" not in ex.columns:
        ex = ex.assign(spread=risk.spread_price)
    ex_ts = pd.to_datetime(ex["ts"]).tolist()
    ex_rows = ex.to_dict("records")

    risk_cfg = spec.get("risk", {})
    atr_id = risk_cfg.get("atr_id")
    be_trigger_atr = risk_cfg.get("be_trigger_atr", risk.be_trigger_atr)
    be_lock_atr = risk_cfg.get("be_lock_atr", risk.be_lock_atr)
    trail_start_atr = risk_cfg.get("trail_start_atr", risk.trail_start_atr)
    trail_atr_mult = risk_cfg.get("trail_atr_mult", risk.trail_atr_mult)
    partial_atr = risk_cfg.get("partial_atr", risk.partial_atr)
    partial_pct = risk_cfg.get("partial_pct", risk.partial_pct)
    commission_per_lot = getattr(risk, "commission_per_lot", 0.0)

    sig_rows = sig.to_dict("records")
    sig_ts = pd.to_datetime(sig["ts"]).tolist()

    balance = risk.start_balance
    equity_curve, equity_ts = [], []
    trades = []
    position = None
    current_day, day_start_balance, daily_halted = None, balance, False
    account_blown = False  # see runner.py: without this, position sizing floors
    # at the 0.01 min lot once balance goes negative and the loop keeps trading
    # a blown account indefinitely - no real broker allows that.
    same_minute_sl_tp_conflicts = 0

    # latest CLOSED signal bar's ATR value, held constant between signal-bar
    # closes - mirrors a live EA reading a higher-timeframe indicator once
    # per new bar rather than recomputing it every tick.
    latest_atr = 0.0
    sig_ptr = 0  # index of the next signal bar not yet "closed" as of current minute

    for i, cur in enumerate(ex_rows):
        ts_i = ex_ts[i]
        day = ts_i.date()
        if day != current_day:
            current_day, day_start_balance, daily_halted = day, balance, False

        # advance signal pointer: fold in every signal bar that has
        # ACTUALLY closed as of this minute's timestamp. sig_ts holds each
        # bar's own START time (left-labeled, per scripts/import_exness.py's
        # resample(..., label="left")) - a bar at sig_ts[k] is not closed
        # until sig_ts[k+1] (the next bar's start), not at sig_ts[k] itself.
        # Q0.6 fix: comparing against sig_ts[k] (as before) let a signal
        # fire using a bar's already-known close value up to one full
        # bar-period before that close time was real - a genuine look-ahead
        # bug (Q0.5 finding), not merely an approximation. Comparing against
        # the NEXT bar's start instead means the current (last, still-open)
        # signal bar can never be marked closed - correct, since its real
        # close time isn't in the data at all until the next bar appears.
        #
        # cur_sig/prev_sig track the two most recently closed signal bars
        # (evaluate_entry needs both, e.g. for cross_above/cross_below) -
        # only the LAST bar closed this minute is evaluated for a fresh
        # entry (if more than one closed in the same minute, e.g. a data
        # gap, the earlier one(s) are folded past without a separate entry
        # check, same simplification class as the SL/TP tie).
        signal_advanced = False
        while sig_ptr < len(sig_rows) - 1 and sig_ts[sig_ptr + 1] <= ts_i:
            cur_sig = sig_rows[sig_ptr]
            latest_atr = cur_sig.get(atr_id, latest_atr) if atr_id else latest_atr
            sig_ptr += 1
            signal_advanced = True
        prev_sig = sig_rows[sig_ptr - 2] if signal_advanced and sig_ptr >= 2 else None

        price_now = cur["close"]
        spread_now = cur.get("spread", risk.spread_price) or 0.0

        if position is not None:
            direction, entry, sl, tp, vol = (position["dir"], position["entry"],
                                              position["sl"], position["tp"], position["vol"])
            hit_sl = (cur["low"] <= sl) if direction > 0 else (cur["high"] >= sl)
            hit_tp = (cur["high"] >= tp) if direction > 0 else (cur["low"] <= tp)

            if hit_sl and hit_tp:
                same_minute_sl_tp_conflicts += 1

            if hit_sl or hit_tp:
                # SL takes priority when both land in the same minute bar -
                # pessimistic assumption, counted above rather than hidden.
                exit_price = sl if hit_sl else tp
                reason = "SL" if hit_sl else "TP"
                pnl = (exit_price - entry) * direction * vol * risk.contract_size - commission_per_lot * vol
                balance += pnl
                trades.append(dict(entry_time=position["entry_time"], exit_time=ts_i, direction=direction,
                                    entry_price=entry, exit_price=exit_price, volume=vol, pnl=pnl, reason=reason))
                position = None
            else:
                atr_i = latest_atr
                profit_atr = ((price_now - entry) * direction / atr_i) if atr_i else 0
                if risk.use_breakeven and profit_atr >= be_trigger_atr:
                    be = entry + direction * be_lock_atr * atr_i
                    if (direction > 0 and be > sl) or (direction < 0 and be < sl):
                        sl = be
                if risk.use_trailing and profit_atr >= trail_start_atr:
                    trail = price_now - direction * trail_atr_mult * atr_i
                    if (direction > 0 and trail > sl) or (direction < 0 and trail < sl):
                        sl = trail
                if risk.use_partial and not position["partial_done"] and profit_atr >= partial_atr:
                    close_vol = round(vol * partial_pct, 2)
                    if 0 < close_vol < vol:
                        pnl = (price_now - entry) * direction * close_vol * risk.contract_size - commission_per_lot * close_vol
                        balance += pnl
                        trades.append(dict(entry_time=position["entry_time"], exit_time=ts_i, direction=direction,
                                            entry_price=entry, exit_price=price_now, volume=close_vol, pnl=pnl,
                                            reason="PARTIAL"))
                        vol -= close_vol
                        position["partial_done"] = True
                        position["vol"] = vol
                position["sl"] = sl

        floating = 0.0 if position is None else (price_now - position["entry"]) * position["dir"] * position["vol"] * risk.contract_size
        equity_curve.append(balance + floating)
        equity_ts.append(ts_i)

        if risk.use_daily_limit:
            day_pl_pct = (balance - day_start_balance) / day_start_balance * 100 if day_start_balance else 0
            if day_pl_pct <= -abs(risk.daily_max_loss_pct):
                daily_halted = True

        if balance <= 0:
            account_blown = True

        if position is not None or daily_halted or account_blown or not signal_advanced or prev_sig is None:
            continue

        direction = evaluate_entry(spec, cur_sig, prev_sig)
        if direction != 0:
            entry_price = price_now + (spread_now / 2) * direction
            atr_val = latest_atr

            if risk_cfg.get("sl_mode") == "ATR":
                sl_dist = atr_val * risk_cfg.get("sl_atr_mult", 2.0)
            else:
                sl_dist = risk_cfg.get("sl_points", 3.0)
            sl = entry_price - direction * sl_dist

            if risk_cfg.get("tp_mode") == "ATR":
                tp_dist = atr_val * risk_cfg.get("tp_atr_mult", 4.0)
            else:
                tp_dist = risk_cfg.get("tp_points", 6.0)
            tp = entry_price + direction * tp_dist

            if sl_dist > 0:
                risk_money = balance * (risk.risk_pct / 100.0)
                vol = max(0.01, round(risk_money / (sl_dist * risk.contract_size), 2))
                position = dict(dir=direction, entry=entry_price, sl=sl, tp=tp, vol=vol,
                                 entry_time=ts_i, partial_done=False)

    equity = pd.Series(equity_curve, index=pd.to_datetime(equity_ts))
    trades_df = pd.DataFrame(trades)

    from engine import summarize  # local import: same sys.path convention as runner.py's caller
    stats = summarize(trades_df, equity, risk)
    stats["same_minute_sl_tp_conflicts"] = same_minute_sl_tp_conflicts
    stats["account_blown"] = account_blown
    return trades_df, equity, stats
