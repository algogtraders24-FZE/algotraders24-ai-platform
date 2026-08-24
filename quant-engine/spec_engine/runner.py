"""
Runs a validated spec through a backtest loop that reuses quant_engine's
RiskConfig-driven position management (breakeven / ATR trailing /
partial close / daily loss limit) — same risk engine as the gold EA,
just with condition-based entries instead of a multi-phase state machine.
"""
import sys
import os
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))
from engine import RiskConfig, summarize  # noqa: E402
from .indicators import compute_all
from .interpreter import evaluate_entry
from .schema import validate_spec


def run_spec_backtest(df: pd.DataFrame, spec: dict, risk: RiskConfig):
    errors = validate_spec(spec)
    if errors:
        raise ValueError(f"invalid spec: {errors}")

    df = compute_all(df.copy(), spec["indicators"]).dropna().reset_index(drop=True)
    if len(df) < 50:
        return pd.DataFrame(), pd.Series(dtype=float), {"trades_total": 0, "error": "not enough bars"}

    risk_cfg = spec.get("risk", {})
    atr_id = risk_cfg.get("atr_id")

    # Per-spec overrides for position management (breakeven/trailing/partial),
    # falling back to the RiskConfig passed in by the caller. This lets the
    # wizard's risk presets (conservative/standard/aggressive) and library
    # grid vary these thresholds per spec instead of every spec sharing one
    # global setting.
    be_trigger_atr = risk_cfg.get("be_trigger_atr", risk.be_trigger_atr)
    be_lock_atr = risk_cfg.get("be_lock_atr", risk.be_lock_atr)
    trail_start_atr = risk_cfg.get("trail_start_atr", risk.trail_start_atr)
    trail_atr_mult = risk_cfg.get("trail_atr_mult", risk.trail_atr_mult)
    partial_atr = risk_cfg.get("partial_atr", risk.partial_atr)
    partial_pct = risk_cfg.get("partial_pct", risk.partial_pct)

    rows = df.to_dict("records")
    dts = df["ts"].tolist()

    balance = risk.start_balance
    equity_curve = []
    trades = []
    position = None
    current_day, day_start_balance, daily_halted = None, balance, False
    account_blown = False  # no margin model here (no real leverage/broker margin-level
    # data to base one on), but a real account can never trade at a negative/zero
    # balance - a real broker force-stops out well before that. Without this guard,
    # position sizing's risk_money=balance*risk_pct% goes negative once balance does,
    # floors at the 0.01 min lot, and the loop keeps "trading" a blown account
    # indefinitely, producing impossible return/drawdown numbers (found on real
    # Exness XAUUSD data: a spec reporting -141% max drawdown).

    n = len(rows)
    for i in range(1, n):
        cur, prev = rows[i], rows[i - 1]
        day = pd.Timestamp(dts[i]).date()
        if day != current_day:
            current_day, day_start_balance, daily_halted = day, balance, False

        price_now = cur["close"]

        if position is not None:
            atr_i = cur.get(atr_id, 0) if atr_id else 0
            direction, entry, sl, tp, vol = (position["dir"], position["entry"],
                                              position["sl"], position["tp"], position["vol"])
            hit_sl = (cur["low"] <= sl) if direction > 0 else (cur["high"] >= sl)
            hit_tp = (cur["high"] >= tp) if direction > 0 else (cur["low"] <= tp)

            if hit_sl or hit_tp:
                exit_price = sl if hit_sl else tp
                reason = "SL" if hit_sl else "TP"
                pnl = (exit_price - entry) * direction * vol * risk.contract_size
                balance += pnl
                trades.append(dict(entry_time=position["entry_time"], exit_time=dts[i], direction=direction,
                                    entry_price=entry, exit_price=exit_price, volume=vol, pnl=pnl, reason=reason))
                position = None
            else:
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
                        pnl = (price_now - entry) * direction * close_vol * risk.contract_size
                        balance += pnl
                        trades.append(dict(entry_time=position["entry_time"], exit_time=dts[i], direction=direction,
                                            entry_price=entry, exit_price=price_now, volume=close_vol, pnl=pnl,
                                            reason="PARTIAL"))
                        vol -= close_vol
                        position["partial_done"] = True
                        position["vol"] = vol
                position["sl"] = sl

        floating = 0.0 if position is None else (price_now - position["entry"]) * position["dir"] * position["vol"] * risk.contract_size
        equity_curve.append(balance + floating)

        if risk.use_daily_limit:
            day_pl_pct = (balance - day_start_balance) / day_start_balance * 100 if day_start_balance else 0
            if day_pl_pct <= -abs(risk.daily_max_loss_pct):
                daily_halted = True

        if balance <= 0:
            account_blown = True

        if position is not None or daily_halted or account_blown:
            continue

        direction = evaluate_entry(spec, cur, prev)
        if direction != 0:
            entry_price = price_now + (risk.spread_price / 2) * direction
            atr_val = cur.get(atr_id, 0) if atr_id else 0

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
                                 entry_time=dts[i], partial_done=False)

    equity = pd.Series(equity_curve, index=pd.to_datetime(dts[1:1+len(equity_curve)]))
    trades_df = pd.DataFrame(trades)
    stats = summarize(trades_df, equity, risk)
    stats["account_blown"] = account_blown
    return trades_df, equity, stats
