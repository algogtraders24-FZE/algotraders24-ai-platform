"""
Generic backtest engine (the "broker" simulation). Any strategy that
implements the small interface in strategies/base.py can be run through
this against any symbol/timeframe pulled from the database. Risk
management (breakeven, ATR trailing, partial close, money SL/TP, daily
loss circuit-breaker) lives HERE, not per-strategy, mirroring how the
MQL5 EA splits "entry signal" from "position management".
"""
import numpy as np
import pandas as pd


class RiskConfig:
    def __init__(self, **kw):
        self.risk_pct        = kw.get("risk_pct", 1.0)
        self.spread_price    = kw.get("spread_price", 0.20)
        self.contract_size   = kw.get("contract_size", 100)
        self.start_balance   = kw.get("start_balance", 10000)

        self.use_breakeven   = kw.get("use_breakeven", True)
        self.be_trigger_atr  = kw.get("be_trigger_atr", 1.0)
        self.be_lock_atr     = kw.get("be_lock_atr", 0.1)

        self.use_trailing    = kw.get("use_trailing", True)
        self.trail_start_atr = kw.get("trail_start_atr", 2.0)
        self.trail_atr_mult  = kw.get("trail_atr_mult", 3.0)

        self.use_partial     = kw.get("use_partial", True)
        self.partial_atr     = kw.get("partial_atr", 2.0)
        self.partial_pct     = kw.get("partial_pct", 0.5)

        self.use_daily_limit = kw.get("use_daily_limit", True)
        self.daily_max_loss_pct = kw.get("daily_max_loss_pct", 3.0)  # % of day-start balance

        self.session_start   = kw.get("session_start", 7)
        self.session_end     = kw.get("session_end", 19)


def in_session(hour, start, end):
    if start <= end:
        return start <= hour < end
    return hour >= start or hour < end


def run_backtest(df, strategy, risk: RiskConfig):
    df = strategy.compute_indicators(df.copy())
    df = df.dropna().reset_index(drop=True)
    if len(df) < 50:
        return pd.DataFrame(), pd.Series(dtype=float), {"trades": 0, "error": "not enough bars after indicator warmup"}

    arrays = {c: df[c].values for c in df.columns if c != "ts"}
    arrays["hour"] = pd.to_datetime(df["ts"]).dt.hour.values
    dts = df["ts"].values

    state = strategy.init_state()
    balance = risk.start_balance
    equity_curve = []
    trades = []
    position = None
    current_day, day_start_balance, daily_halted = None, balance, False

    n = len(df)
    for i in range(2, n):
        day = pd.Timestamp(dts[i]).date()
        if day != current_day:
            current_day, day_start_balance, daily_halted = day, balance, False

        price_now = arrays["close"][i]

        # ---------- manage open position (generic, strategy-agnostic) ----------
        if position is not None:
            atr_i = arrays["atr"][i]
            direction, entry, sl, tp, vol = (position["dir"], position["entry"],
                                              position["sl"], position["tp"], position["vol"])
            bar_high, bar_low = arrays["high"][i], arrays["low"][i]

            hit_sl = (bar_low <= sl) if direction > 0 else (bar_high >= sl)
            hit_tp = (bar_high >= tp) if direction > 0 else (bar_low <= tp)

            if hit_sl or hit_tp:
                exit_price = sl if hit_sl else tp  # conservative: SL wins on ambiguous bar
                reason = "SL" if hit_sl else "TP"
                pnl = (exit_price - entry) * direction * vol * risk.contract_size
                balance += pnl
                trades.append(dict(entry_time=position["entry_time"], exit_time=dts[i], direction=direction,
                                    entry_price=entry, exit_price=exit_price, volume=vol, pnl=pnl, reason=reason))
                position = None
            else:
                profit_atr = ((price_now - entry) * direction / atr_i) if atr_i > 0 else 0

                if risk.use_breakeven and profit_atr >= risk.be_trigger_atr:
                    be = entry + direction * risk.be_lock_atr * atr_i
                    if (direction > 0 and be > sl) or (direction < 0 and be < sl):
                        sl = be

                if risk.use_trailing and profit_atr >= risk.trail_start_atr:
                    trail = price_now - direction * risk.trail_atr_mult * atr_i
                    if (direction > 0 and trail > sl) or (direction < 0 and trail < sl):
                        sl = trail

                if risk.use_partial and not position["partial_done"] and profit_atr >= risk.partial_atr:
                    close_vol = round(vol * risk.partial_pct, 2)
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

        if position is not None:
            continue

        if daily_halted or not in_session(arrays["hour"][i], risk.session_start, risk.session_end):
            strategy.reset_state(state)
            continue

        sig = strategy.next_signal(i, arrays, state, risk.spread_price)
        if sig is not None:
            direction, sl, tp = sig["direction"], sig["sl"], sig["tp"]
            entry_price = arrays["close"][i] + (risk.spread_price / 2) * direction
            sl_dist = abs(entry_price - sl)
            if sl_dist > 0:
                risk_money = balance * (risk.risk_pct / 100.0)
                vol = max(0.01, round(risk_money / (sl_dist * risk.contract_size), 2))
                position = dict(dir=direction, entry=entry_price, sl=sl, tp=tp, vol=vol,
                                 entry_time=dts[i], partial_done=False)

    equity = pd.Series(equity_curve, index=pd.to_datetime(dts[2:2+len(equity_curve)]))
    return pd.DataFrame(trades), equity, summarize(pd.DataFrame(trades), equity, risk)


def summarize(trades, equity, risk: RiskConfig):
    if len(trades) == 0 or len(equity) == 0:
        return {"trades_total": 0, "win_rate_pct": None, "profit_factor": None,
                "total_return_pct": 0, "max_drawdown_pct": 0, "final_balance": risk.start_balance}

    closes_only = trades[trades["reason"].isin(["SL", "TP"])]
    wins = trades[trades["pnl"] > 0]
    losses = trades[trades["pnl"] <= 0]
    gross_win, gross_loss = wins["pnl"].sum(), -losses["pnl"].sum()
    pf = gross_win / gross_loss if gross_loss > 0 else np.nan

    roll_max = equity.cummax()
    max_dd_pct = ((equity - roll_max) / roll_max).min() * 100

    final_balance = risk.start_balance + trades["pnl"].sum()
    total_return_pct = (final_balance - risk.start_balance) / risk.start_balance * 100
    win_rate = (closes_only["pnl"] > 0).mean() * 100 if len(closes_only) else np.nan

    return {
        "trades_total": len(trades),
        "trade_cycles": len(closes_only),
        "win_rate_pct": round(win_rate, 2),
        "profit_factor": round(pf, 2) if pd.notna(pf) else None,
        "total_return_pct": round(total_return_pct, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "final_balance": round(final_balance, 2),
    }
