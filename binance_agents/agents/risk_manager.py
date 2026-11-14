"""Agent 6 - Risk Manager: the only agent that can say how much to buy, and the one with the final NO. Hard rules from config.Risk:
risk per trade, position cap, max open positions, daily loss limit, drawdown halt, per-symbol cooldown. It owns no market opinion."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..config import Costs, Risk


@dataclass
class RiskState:
    peak_equity: float
    day: str = ""
    day_start_equity: float = 0.0
    halted: bool = False                       # drawdown halt - stays True until a human resets it
    last_exit_bar: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Sizing:
    qty: float
    notional: float
    risk_amount: float
    reason: str = "ok"


class RiskManager:
    def __init__(self, risk: Risk, costs: Costs):
        self.r = risk
        self.c = costs

    # ---- state bookkeeping ------------------------------------------------------------
    def new_state(self, equity: float) -> RiskState:
        return RiskState(peak_equity=equity)

    def on_bar(self, st: RiskState, day: str, equity: float) -> None:
        """Call once per bar with the mark-to-market equity."""
        if day != st.day:
            st.day = day
            st.day_start_equity = equity
        st.peak_equity = max(st.peak_equity, equity)
        if equity <= st.peak_equity * (1.0 - self.r.max_drawdown_halt):
            st.halted = True

    # ---- gate + sizing ----------------------------------------------------------------
    def can_enter(self, st: RiskState, equity: float, open_count: int, symbol: str, bar_index: int) -> tuple[bool, str]:
        if st.halted:
            return False, f"drawdown halt ({self.r.max_drawdown_halt:.0%} below peak) - human reset needed"
        if st.day_start_equity > 0 and equity <= st.day_start_equity * (1.0 - self.r.daily_loss_limit):
            return False, f"daily loss limit {self.r.daily_loss_limit:.0%} reached"
        if open_count >= self.r.max_open:
            return False, f"already {open_count} open positions"
        last = st.last_exit_bar.get(symbol)
        if last is not None and bar_index - last < self.r.cooldown_bars:
            return False, "cooldown after the last exit in this symbol"
        return True, "ok"

    def size(self, equity: float, cash: float, entry: float, stop: float) -> Sizing:
        """Quantity so that hitting the stop loses `risk_per_trade` of equity (fees and slippage on the exit are inside the buffer below)."""
        dist = entry - stop
        if dist <= 0 or entry <= 0:
            return Sizing(0.0, 0.0, 0.0, "stop is not below entry")
        risk_amount = equity * self.r.risk_per_trade
        # price distance + fee on both legs + slippage on the exit, so the realised loss at the stop is not larger than planned
        per_unit_loss = dist + entry * self.c.fee + stop * self.c.fee + stop * self.c.slippage
        qty = risk_amount / per_unit_loss
        notional = qty * entry
        cap = equity * self.r.max_position_pct
        if notional > cap:
            qty, notional = cap / entry, cap
        afford = cash / (1.0 + self.c.fee)
        if notional > afford:
            qty, notional = afford / entry, afford
        if notional < 10.0:                                 # below any exchange minimum notional
            return Sizing(0.0, 0.0, risk_amount, "position too small")
        return Sizing(qty, notional, risk_amount)
