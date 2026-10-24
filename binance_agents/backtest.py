"""Portfolio backtest that runs the SAME agent classes the live runner uses (Scout -> RiskChecker -> Strategy -> RiskManager -> modelled Execution).

Honest-simulation rules:
  * a signal is computed on a CLOSED candle and filled at the NEXT candle's open, with slippage and fees;
  * stops are checked against the candle's low (a gap through the stop fills at the open, i.e. worse than the stop);
  * the stop/trail level used on candle t was fixed before candle t started;
  * the Sentiment agent needs historical order books, which do not exist, so it is NEUTRAL here (it can only reduce live trades further);
  * RiskChecker applies only the volume floor here (no historical spread / depth);
  * long-only spot cash account, no leverage, no shorting, no funding.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .agents import RiskChecker, RiskManager, Scout, Strategy
from .agents.strategy import Signal
from .config import Config
from .features import compute_features


@dataclass
class Position:
    symbol: str
    qty: float
    entry: float
    stop: float
    initial_stop: float
    highest_high: float
    atr: float
    entry_bar: int
    entry_time: pd.Timestamp
    cost: float          # cash paid including the entry fee
    risk_amount: float


@dataclass
class Result:
    trades: pd.DataFrame
    equity: pd.Series
    stats: dict
    halted: bool = False
    skipped: dict = field(default_factory=dict)


def _row(f: dict[str, np.ndarray], i: int) -> dict:
    return {k: (bool(v[i]) if v.dtype == bool else float(v[i])) for k, v in f.items()}


def run_backtest(frames: dict[str, pd.DataFrame], cfg: Config, start: str | None = None, end: str | None = None, initial_equity: float = 10_000.0,
                 random_entries: tuple[float, int] | None = None) -> Result:
    """random_entries=(probability, seed): replace the Strategy's entry rule by a coin flip (still requires the liquidity + trend filters).
    Used only as a baseline to see whether 'breakout + volume' adds anything beyond the exits and the trend filter."""
    p, costs = cfg.params, cfg.costs
    scout, checker, strat, rm = Scout(p), RiskChecker(p, cfg.live), Strategy(p), RiskManager(cfg.risk, costs)
    rng = np.random.default_rng(random_entries[1]) if random_entries else None

    syms = list(frames)
    feats = {s: compute_features(frames[s], p).set_index("open_time") for s in syms}
    idx = sorted(set().union(*[set(f.index) for f in feats.values()]))
    t0 = pd.Timestamp(start, tz="UTC") if start else idx[0]
    t1 = pd.Timestamp(end, tz="UTC") if end else idx[-1]
    master = pd.DatetimeIndex([t for t in idx if t0 <= t <= t1])
    T = len(master)
    cols = ["open", "high", "low", "close", "atr", "rel_volume", "prior_high", "ema_trend", "quote_vol_24h", "breakout", "bullish", "trend_ok"]
    arr: dict[str, dict[str, np.ndarray]] = {}
    nominate = np.zeros((T, len(syms)), dtype=bool)
    for j, s in enumerate(syms):
        f = feats[s].reindex(master)
        a = {c: (f[c].astype("boolean").fillna(False).astype(bool).to_numpy() if c in ("breakout", "bullish", "trend_ok") else f[c].to_numpy(dtype=float)) for c in cols}
        arr[s] = a
        liquid = a["quote_vol_24h"] >= p.min_quote_vol_24h
        if random_entries:
            nominate[:, j] = a["trend_ok"] & liquid & ~np.isnan(a["atr"])
        else:
            nominate[:, j] = (a["rel_volume"] >= p.min_rel_volume * 0.75) & a["bullish"] & liquid & ~np.isnan(a["atr"])
    # random baseline probability is applied below; for the real strategy `nominate` only skips obviously irrelevant bars

    cash = initial_equity
    positions: dict[str, Position] = {}
    pending: list[Signal] = []
    trades: list[dict] = []
    equity = np.full(T, np.nan)
    st = rm.new_state(initial_equity)
    skipped: dict[str, int] = {}
    last_close = {s: np.nan for s in syms}
    days = master.strftime("%Y-%m-%d")

    def bump(k: str) -> None:
        skipped[k] = skipped.get(k, 0) + 1

    for t in range(T):
        # ---- 1) fill the entries decided on the previous candle, at this candle's open
        if pending:
            mark = cash + sum(pos.qty * (last_close[pos.symbol] if not np.isnan(last_close[pos.symbol]) else pos.entry) for pos in positions.values())
            for sig in pending:
                a = arr[sig.symbol]
                if np.isnan(a["open"][t]) or sig.symbol in positions:
                    bump("no bar / already open")
                    continue
                ok, why = rm.can_enter(st, mark, len(positions), sig.symbol, t)
                if not ok:
                    bump(why.split(" (")[0])
                    continue
                fill = a["open"][t] * (1.0 + costs.slippage)
                stop = strat.initial_stop(fill, sig.atr)
                sz = rm.size(mark, cash, fill, stop)
                if sz.qty <= 0:
                    bump(sz.reason)
                    continue
                fee = sz.qty * fill * costs.fee
                cash -= sz.qty * fill + fee
                positions[sig.symbol] = Position(sig.symbol, sz.qty, fill, stop, stop, a["high"][t], sig.atr, t, master[t], sz.qty * fill + fee, sz.risk_amount)
            pending = []

        # ---- 2) manage open positions with this candle's range
        for s in list(positions):
            pos, a = positions[s], arr[s]
            if np.isnan(a["open"][t]):
                continue
            exit_px, reason = None, ""
            if a["low"][t] <= pos.stop:
                exit_px = min(a["open"][t], pos.stop) * (1.0 - costs.slippage)
                reason = "trail" if pos.stop > pos.initial_stop else "stop"
            else:
                pos.highest_high = max(pos.highest_high, a["high"][t])
                pos.stop = max(pos.stop, strat.trail_stop(pos.highest_high, pos.atr))     # takes effect from the next candle
                if t - pos.entry_bar >= p.max_hold_bars:
                    exit_px, reason = a["close"][t] * (1.0 - costs.slippage), "time"
            if exit_px is not None:
                proceeds = pos.qty * exit_px
                fee = proceeds * costs.fee
                cash += proceeds - fee
                pnl = proceeds - fee - pos.cost
                trades.append({"symbol": s, "entry_time": pos.entry_time, "exit_time": master[t], "entry": pos.entry, "exit": exit_px, "qty": pos.qty,
                               "pnl": pnl, "pnl_pct": pnl / pos.cost, "r_multiple": pnl / pos.risk_amount if pos.risk_amount else np.nan,
                               "bars": t - pos.entry_bar, "reason": reason})
                st.last_exit_bar[s] = t
                del positions[s]

        # ---- 3) mark to market at the close
        for s in syms:
            c = arr[s]["close"][t]
            if not np.isnan(c):
                last_close[s] = c
        eq = cash + sum(pos.qty * (last_close[pos.symbol] if not np.isnan(last_close[pos.symbol]) else pos.entry) for pos in positions.values())
        equity[t] = eq
        rm.on_bar(st, days[t], eq)

        # ---- 4) agents look at the CLOSED candle -> orders for the next open
        cand_idx = np.nonzero(nominate[t])[0]
        if len(cand_idx):
            rows = {}
            for j in cand_idx:
                s = syms[j]
                if s in positions:
                    continue
                r = _row({c: arr[s][c][t:t + 1] for c in arr[s]}, 0)
                ok, _ = checker.check_bar(s, r)
                if ok:
                    rows[s] = r
            if random_entries:
                prob = random_entries[0]
                picks = [s for s in rows if rng.random() < prob]
                for s in picks:
                    pending.append(Signal(s, rows[s]["atr"], rows[s]["rel_volume"] if not np.isnan(rows[s]["rel_volume"]) else 0.0, rows[s]["close"]))
            else:
                for c in scout.scan(rows):
                    sig = strat.evaluate(c.symbol, rows[c.symbol])
                    if sig:
                        pending.append(sig)

    # close anything still open at the last candle (marked at the close, with exit costs) so open P&L is not hidden
    for s, pos in list(positions.items()):
        c = last_close[s] if not np.isnan(last_close[s]) else pos.entry
        proceeds = pos.qty * c * (1.0 - costs.slippage)
        fee = proceeds * costs.fee
        cash += proceeds - fee
        pnl = proceeds - fee - pos.cost
        trades.append({"symbol": s, "entry_time": pos.entry_time, "exit_time": master[-1], "entry": pos.entry, "exit": c, "qty": pos.qty, "pnl": pnl,
                       "pnl_pct": pnl / pos.cost, "r_multiple": pnl / pos.risk_amount if pos.risk_amount else np.nan, "bars": T - 1 - pos.entry_bar, "reason": "end"})
    eq_s = pd.Series(equity, index=master).ffill()
    td = pd.DataFrame(trades)
    return Result(td, eq_s, compute_stats(td, eq_s, initial_equity), st.halted, skipped)


def compute_stats(trades: pd.DataFrame, equity: pd.Series, initial: float) -> dict:
    out: dict = {}
    years = max((equity.index[-1] - equity.index[0]).total_seconds() / (365.25 * 86400), 1e-9)
    final = float(equity.iloc[-1])
    out["start_equity"], out["final_equity"] = initial, final
    out["total_return_pct"] = (final / initial - 1.0) * 100
    out["cagr_pct"] = ((final / initial) ** (1.0 / years) - 1.0) * 100 if final > 0 else -100.0
    peak = equity.cummax()
    dd = equity / peak - 1.0
    out["max_drawdown_pct"] = float(dd.min() * 100)
    daily = equity.resample("1D").last().pct_change().dropna()
    out["sharpe_daily_ann"] = float(daily.mean() / daily.std() * np.sqrt(365)) if daily.std() > 0 else 0.0
    out["calmar"] = out["cagr_pct"] / abs(out["max_drawdown_pct"]) if out["max_drawdown_pct"] < 0 else float("nan")
    out["years"] = years
    n = len(trades)
    out["trades"] = n
    if n:
        w, l = trades[trades.pnl > 0], trades[trades.pnl <= 0]
        out["win_rate_pct"] = len(w) / n * 100
        out["profit_factor"] = float(w.pnl.sum() / abs(l.pnl.sum())) if len(l) and l.pnl.sum() != 0 else float("inf")
        out["expectancy_usdt"] = float(trades.pnl.mean())
        out["avg_r"] = float(trades.r_multiple.mean())
        out["avg_win_pct"] = float(w.pnl_pct.mean() * 100) if len(w) else 0.0
        out["avg_loss_pct"] = float(l.pnl_pct.mean() * 100) if len(l) else 0.0
        out["avg_hold_hours"] = float(trades.bars.mean())
        out["trades_per_year"] = n / years
        out["by_reason"] = trades.groupby("reason").agg(n=("pnl", "size"), pnl=("pnl", "sum")).round(1).to_dict("index")
        top = trades.sort_values("pnl", ascending=False).head(max(1, n // 20))
        out["share_of_profit_from_top5pct_trades"] = float(top.pnl.sum() / trades.pnl.sum()) if trades.pnl.sum() > 0 else float("nan")
    yr = equity.resample("YE").last()
    prev = pd.concat([pd.Series([initial], index=[equity.index[0] - pd.Timedelta(days=1)]), yr]).pct_change().dropna() * 100
    out["by_year_pct"] = {str(k.year): round(float(v), 1) for k, v in prev.items()}
    return out


def buy_and_hold(frames: dict[str, pd.DataFrame], start: str | None, end: str | None, initial: float = 10_000.0) -> dict:
    """Benchmarks over the same window: BTC alone and an equal-weight basket (rebalanced never, symbols that exist at the start)."""
    res = {}
    t0 = pd.Timestamp(start, tz="UTC") if start else None
    t1 = pd.Timestamp(end, tz="UTC") if end else None
    rets = {}
    for s, df in frames.items():
        d = df.set_index("open_time")
        if t0 is not None:
            d = d[d.index >= t0]
        if t1 is not None:
            d = d[d.index <= t1]
        if len(d) > 100:
            rets[s] = float(d["close"].iloc[-1] / d["open"].iloc[0] - 1.0)
    if "BTCUSDT" in rets:
        res["btc_buy_hold_pct"] = rets["BTCUSDT"] * 100
    if rets:
        res["basket_equal_weight_pct"] = float(np.mean(list(rets.values())) * 100)
    return res
