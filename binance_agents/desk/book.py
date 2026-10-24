"""A paper portfolio ('arm'). Cash account, long only, no leverage. Fills are modelled with the same fees and slippage as the backtest.
Exits (stop / trailing / time) are deterministic code for EVERY arm; the Claude desk may only tighten a stop or exit early, never loosen a stop."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

from ..agents.risk_manager import RiskManager, RiskState
from ..config import Config


@dataclass
class Pos:
    symbol: str
    qty: float
    entry: float
    stop: float
    initial_stop: float
    highest_high: float
    atr: float
    opened: str
    bars: int = 0
    cost: float = 0.0
    risk_amount: float = 0.0
    conviction: float = 0.0
    thesis: str = ""


@dataclass
class Pending:
    symbol: str
    limit_price: float
    qty: float
    atr: float
    stop_atr: float
    created: str
    risk_amount: float
    conviction: float = 0.0
    thesis: str = ""


class PaperBook:
    def __init__(self, name: str, cfg: Config, cash: float = 10_000.0):
        self.name, self.cfg = name, cfg
        self.initial = cash
        self.cash = cash
        self.pos: dict[str, Pos] = {}
        self.pending: list[Pending] = []
        self.trades: list[dict] = []
        self.equity: list[list] = []          # [iso time, equity]
        self.rm = RiskManager(cfg.risk, cfg.costs)
        self.rs: RiskState = self.rm.new_state(cash)
        self.cycle = 0

    # ---- valuation ----------------------------------------------------------------
    def value(self, prices: dict[str, float]) -> float:
        return self.cash + sum(p.qty * prices.get(s, p.entry) for s, p in self.pos.items())

    def exposure(self, prices: dict[str, float]) -> float:
        eq = self.value(prices)
        return sum(p.qty * prices.get(s, p.entry) for s, p in self.pos.items()) / eq if eq > 0 else 0.0

    # ---- entries ------------------------------------------------------------------
    def can_enter(self, symbol: str, prices: dict[str, float]) -> tuple[bool, str]:
        if symbol in self.pos or any(x.symbol == symbol for x in self.pending):
            return False, "already holding / pending"
        return self.rm.can_enter(self.rs, self.value(prices), len(self.pos) + len(self.pending), symbol, self.cycle)

    def plan(self, symbol: str, ref_price: float, atr: float, stop_atr: float, prices: dict[str, float], size_mult: float = 1.0) -> tuple[float, float, float] | None:
        """(qty, stop, risk_amount) for a market buy at `ref_price`, or None if the rules say the position is too small."""
        fill = ref_price * (1.0 + self.cfg.costs.slippage)
        stop = fill - stop_atr * atr
        sz = self.rm.size(self.value(prices), self.cash, fill, stop)
        if sz.qty <= 0:
            return None
        qty = sz.qty * max(0.0, min(1.0, size_mult))
        if qty * fill < 10.0:
            return None
        return qty, stop, sz.risk_amount * max(0.0, min(1.0, size_mult))

    def buy_market(self, symbol: str, ref_price: float, atr: float, stop_atr: float, now: str, prices: dict[str, float], size_mult: float = 1.0,
                   conviction: float = 0.0, thesis: str = "") -> Pos | None:
        pl = self.plan(symbol, ref_price, atr, stop_atr, prices, size_mult)
        if not pl:
            return None
        qty, stop, risk = pl
        fill = ref_price * (1.0 + self.cfg.costs.slippage)
        fee = qty * fill * self.cfg.costs.fee
        self.cash -= qty * fill + fee
        p = Pos(symbol, qty, fill, stop, stop, ref_price, atr, now, 0, qty * fill + fee, risk, conviction, thesis)
        self.pos[symbol] = p
        return p

    def place_limit(self, symbol: str, limit_price: float, atr: float, stop_atr: float, now: str, prices: dict[str, float], size_mult: float = 1.0,
                    conviction: float = 0.0, thesis: str = "") -> bool:
        pl = self.plan(symbol, limit_price, atr, stop_atr, prices, size_mult)
        if not pl:
            return False
        qty, _, risk = pl
        self.pending.append(Pending(symbol, limit_price, qty, atr, stop_atr, now, risk, conviction, thesis))
        return True

    # ---- candle processing (deterministic) ---------------------------------------------
    def process_candle(self, candles: dict[str, dict], now_iso: str) -> list[dict]:
        """candles: {symbol: {open,high,low,close}} for ONE newly closed hour. Resolves limit orders, then stops / trail / time. Returns closed trades."""
        closed: list[dict] = []
        c = self.cfg
        # limit orders rest for exactly one hour: filled if the hour traded down to the limit, otherwise expired
        keep: list[Pending] = []
        for o in self.pending:
            k = candles.get(o.symbol)
            if k and k["low"] < o.limit_price and o.symbol not in self.pos:
                fee = o.qty * o.limit_price * c.costs.fee
                if self.cash >= o.qty * o.limit_price + fee:
                    stop = o.limit_price - o.stop_atr * o.atr
                    self.cash -= o.qty * o.limit_price + fee
                    self.pos[o.symbol] = Pos(o.symbol, o.qty, o.limit_price, stop, stop, k["high"], o.atr, now_iso, 0, o.qty * o.limit_price + fee, o.risk_amount, o.conviction, o.thesis)
        self.pending = keep
        for s in list(self.pos):
            p, k = self.pos[s], candles.get(s)
            if not k:
                continue
            p.bars += 1
            exit_px, reason = None, ""
            if k["low"] <= p.stop:
                exit_px, reason = min(k["open"], p.stop) * (1.0 - c.costs.slippage), ("trail" if p.stop > p.initial_stop else "stop")
            else:
                p.highest_high = max(p.highest_high, k["high"])
                p.stop = max(p.stop, p.highest_high - c.params.trail_atr * p.atr)
                if p.bars >= c.params.max_hold_bars:
                    exit_px, reason = k["close"] * (1.0 - c.costs.slippage), "time"
            if exit_px is not None:
                closed.append(self._close(s, exit_px, reason, now_iso))
        return closed

    def exit_now(self, symbol: str, ref_price: float, reason: str, now_iso: str) -> dict | None:
        if symbol not in self.pos:
            return None
        return self._close(symbol, ref_price * (1.0 - self.cfg.costs.slippage), reason, now_iso)

    def tighten(self, symbol: str, ref_price: float, stop_atr: float) -> bool:
        """The desk may only move a stop UP and never above the current price."""
        p = self.pos.get(symbol)
        if not p:
            return False
        new = min(ref_price * 0.999, ref_price - stop_atr * p.atr)
        if new > p.stop:
            p.stop = new
            return True
        return False

    def _close(self, symbol: str, exit_px: float, reason: str, now_iso: str) -> dict:
        p = self.pos.pop(symbol)
        proceeds = p.qty * exit_px
        fee = proceeds * self.cfg.costs.fee
        self.cash += proceeds - fee
        pnl = proceeds - fee - p.cost
        t = {"arm": self.name, "symbol": symbol, "opened": p.opened, "closed": now_iso, "entry": p.entry, "exit": exit_px, "qty": p.qty, "pnl": pnl,
             "pnl_pct": pnl / p.cost if p.cost else 0.0, "r": pnl / p.risk_amount if p.risk_amount else 0.0, "bars": p.bars, "reason": reason,
             "conviction": p.conviction, "thesis": p.thesis}
        self.trades.append(t)
        self.rs.last_exit_bar[symbol] = self.cycle
        return t

    # ---- persistence ---------------------------------------------------------------
    def to_dict(self) -> dict:
        return {"name": self.name, "initial": self.initial, "cash": self.cash, "pos": {k: asdict(v) for k, v in self.pos.items()}, "pending": [asdict(x) for x in self.pending],
                "trades": self.trades, "equity": self.equity, "cycle": self.cycle,
                "risk": {"peak_equity": self.rs.peak_equity, "day": self.rs.day, "day_start_equity": self.rs.day_start_equity, "halted": self.rs.halted, "last_exit_bar": self.rs.last_exit_bar}}

    @classmethod
    def from_dict(cls, d: dict, cfg: Config) -> "PaperBook":
        b = cls(d["name"], cfg, d["initial"])
        b.cash, b.trades, b.equity, b.cycle = d["cash"], d["trades"], d["equity"], d.get("cycle", 0)
        b.pos = {k: Pos(**v) for k, v in d["pos"].items()}
        b.pending = [Pending(**x) for x in d["pending"]]
        r = d["risk"]
        b.rs = RiskState(r["peak_equity"], r["day"], r["day_start_equity"], r["halted"], r["last_exit_bar"])
        return b
