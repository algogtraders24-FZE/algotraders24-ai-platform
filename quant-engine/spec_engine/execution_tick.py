"""
True tick-level execution engine: signals still detected on the spec's own
timeframe (e.g. 1h close, using pre-aggregated candles - cheap, unchanged
from the other engines), but fills/SL/TP/position-management are resolved
against REAL Exness ticks streamed directly from the same zip files the
importer reads, in one chronological pass per symbol-year. This is the
same "OHLC M1" idea execution_mtf.py uses, taken one level further: no
1-minute aggregation at all for the execution side, so same-bar SL+TP
ambiguity and the choice of which real bid/ask price a fill happens at are
no longer approximated - they're read directly off the real tick that
crossed the level, using the correct side (a long's SL/TP triggers off
Bid since closing a long means selling; a short's triggers off Ask).

Reuses scripts.import_exness.iter_tick_chunks - the exact same parsing
path already proven against real data during import, so there is no
second, unverified tick-reading implementation to silently drift from the
first.

Cost: one full linear read of the symbol's tick zip(s) per backtest run
(no random seeking - ticks aren't indexed by time), same order of
magnitude as the import itself (a few minutes per symbol-year). Cheap
signal computation still runs once up front on the pre-aggregated 1h data.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from import_exness import iter_tick_chunks  # noqa: E402

from .indicators import compute_all
from .interpreter import evaluate_entry
from .schema import validate_spec

DOWNLOADS = r"C:\Users\om\Downloads"


def run_spec_backtest_tick(df_signal: pd.DataFrame, spec: dict, risk,
                            zip_symbol: str, csv_symbol: str, years, downloads_dir=DOWNLOADS):
    """
    df_signal: OHLC bars at the spec's own timeframe (e.g. 1h) - same shape
        the other engines expect. Used only for signal detection.
    zip_symbol/csv_symbol: e.g. "XAUUSD"/"XAUUSD" - matches
        scripts.import_exness.SYMBOL_MAP's key/csv-token pair.
    years: iterable of year strings whose Exness_<zip_symbol>_<year>.zip
        files (in downloads_dir) cover df_signal's date range.
    """
    errors = validate_spec(spec)
    if errors:
        raise ValueError(f"invalid spec: {errors}")

    sig = compute_all(df_signal.copy(), spec["indicators"]).dropna().reset_index(drop=True)
    if len(sig) < 50:
        return pd.DataFrame(), pd.Series(dtype=float), {"trades_total": 0, "error": "not enough signal bars"}

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
    sig_ptr = 0
    latest_atr = 0.0

    balance = risk.start_balance
    equity_curve, equity_ts = [], []
    trades = []
    position = None
    current_day, day_start_balance, daily_halted = None, balance, False
    account_blown = False  # see runner.py: without this, position sizing floors
    # at the 0.01 min lot once balance goes negative and the loop keeps trading
    # a blown account indefinitely - no real broker allows that.
    same_tick_sl_tp_conflicts = 0
    total_ticks = 0
    last_equity_minute = None  # equity curve sampled per-minute, not per-tick -
    # summarize()'s drawdown calc doesn't need tick-resolution and a 34M-point
    # Python list per symbol-year would be needless memory/time overhead

    for year in years:
        zip_path = os.path.join(downloads_dir, f"Exness_{zip_symbol}_{year}.zip")
        if not os.path.exists(zip_path):
            continue
        for chunk in iter_tick_chunks(zip_path, csv_symbol):
            total_ticks += len(chunk)
            ts_arr = chunk["ts"].tolist()
            bid_arr = chunk["bid"].tolist()
            ask_arr = chunk["ask"].tolist()

            for ts_i, bid_i, ask_i in zip(ts_arr, bid_arr, ask_arr):
                mid_i = (bid_i + ask_i) / 2.0
                spread_i = ask_i - bid_i

                day = ts_i.date()
                if day != current_day:
                    current_day, day_start_balance, daily_halted = day, balance, False

                signal_advanced = False
                while sig_ptr < len(sig_rows) and sig_ts[sig_ptr] <= ts_i:
                    cur_sig = sig_rows[sig_ptr]
                    latest_atr = cur_sig.get(atr_id, latest_atr) if atr_id else latest_atr
                    sig_ptr += 1
                    signal_advanced = True
                prev_sig = sig_rows[sig_ptr - 2] if signal_advanced and sig_ptr >= 2 else None

                if position is not None:
                    direction, entry, sl, tp, vol = (position["dir"], position["entry"],
                                                       position["sl"], position["tp"], position["vol"])
                    # closing a long = selling at Bid; closing a short = buying at Ask
                    close_side = bid_i if direction > 0 else ask_i
                    hit_sl = (close_side <= sl) if direction > 0 else (close_side >= sl)
                    hit_tp = (close_side >= tp) if direction > 0 else (close_side <= tp)

                    if hit_sl and hit_tp:
                        same_tick_sl_tp_conflicts += 1

                    if hit_sl or hit_tp:
                        exit_price = sl if hit_sl else tp
                        reason = "SL" if hit_sl else "TP"
                        pnl = (exit_price - entry) * direction * vol * risk.contract_size - commission_per_lot * vol
                        balance += pnl
                        trades.append(dict(entry_time=position["entry_time"], exit_time=ts_i, direction=direction,
                                            entry_price=entry, exit_price=exit_price, volume=vol, pnl=pnl, reason=reason))
                        position = None
                    else:
                        atr_i = latest_atr
                        profit_atr = ((close_side - entry) * direction / atr_i) if atr_i else 0
                        if risk.use_breakeven and profit_atr >= be_trigger_atr:
                            be = entry + direction * be_lock_atr * atr_i
                            if (direction > 0 and be > sl) or (direction < 0 and be < sl):
                                sl = be
                        if risk.use_trailing and profit_atr >= trail_start_atr:
                            trail = close_side - direction * trail_atr_mult * atr_i
                            if (direction > 0 and trail > sl) or (direction < 0 and trail < sl):
                                sl = trail
                        if risk.use_partial and not position["partial_done"] and profit_atr >= partial_atr:
                            close_vol = round(vol * partial_pct, 2)
                            if 0 < close_vol < vol:
                                pnl = (close_side - entry) * direction * close_vol * risk.contract_size - commission_per_lot * close_vol
                                balance += pnl
                                trades.append(dict(entry_time=position["entry_time"], exit_time=ts_i, direction=direction,
                                                    entry_price=entry, exit_price=close_side, volume=close_vol, pnl=pnl,
                                                    reason="PARTIAL"))
                                vol -= close_vol
                                position["partial_done"] = True
                                position["vol"] = vol
                        position["sl"] = sl

                minute_i = ts_i.replace(second=0, microsecond=0)
                if minute_i != last_equity_minute:
                    floating = 0.0
                    if position is not None:
                        close_side = bid_i if position["dir"] > 0 else ask_i
                        floating = (close_side - position["entry"]) * position["dir"] * position["vol"] * risk.contract_size
                    equity_curve.append(balance + floating)
                    equity_ts.append(ts_i)
                    last_equity_minute = minute_i

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
                    # a buy fills at Ask, a sell fills at Bid - the real tick, not a synthetic spread split
                    entry_price = ask_i if direction > 0 else bid_i
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

    from engine import summarize  # noqa: E402  (quant_engine on sys.path via caller, same convention as runner.py)
    stats = summarize(trades_df, equity, risk)
    stats["same_tick_sl_tp_conflicts"] = same_tick_sl_tp_conflicts
    stats["total_ticks_replayed"] = total_ticks
    stats["account_blown"] = account_blown
    return trades_df, equity, stats
