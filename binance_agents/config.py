"""All tunable numbers in one place. The strategy parameters were fixed BEFORE the first backtest (no optimisation); change them only
with a new, documented experiment."""
from __future__ import annotations

from dataclasses import dataclass, field

# Long-lived liquid USDT pairs (listed well before 2021). Picked from today's survivors, which flatters results a little
# (survivorship bias) - the README says so and the report repeats it.
DEFAULT_UNIVERSE = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
    "LTCUSDT", "TRXUSDT", "ATOMUSDT", "UNIUSDT", "ETCUSDT", "NEARUSDT", "FILUSDT", "AAVEUSDT", "ALGOUSDT", "XLMUSDT",
    "BCHUSDT", "VETUSDT", "SANDUSDT", "MANAUSDT", "AXSUSDT", "GRTUSDT", "SHIBUSDT", "ICPUSDT", "HBARUSDT", "EGLDUSDT",
]


@dataclass(frozen=True)
class Params:
    """Strategy + scout + liquidity parameters (agents 1, 2, 4)."""
    interval: str = "1h"
    breakout_n: int = 48            # close must exceed the highest high of the previous N bars
    min_rel_volume: float = 2.0     # bar volume >= k x the mean volume of the previous N bars
    ema_trend: int = 200            # only buy when close is above this EMA
    atr_n: int = 14
    stop_atr: float = 2.0           # initial stop = entry - stop_atr x ATR
    trail_atr: float = 3.0          # chandelier trail = highest high - trail_atr x ATR (ratchets up only)
    max_hold_bars: int = 72         # time stop
    min_quote_vol_24h: float = 20_000_000.0  # RiskChecker: 24h quote volume floor (USDT)
    scout_top: int = 5              # Scout hands the Strategy at most this many symbols per bar (strongest relative volume first)


@dataclass(frozen=True)
class Risk:
    """Hard rules (agent 6). Defaults are deliberately conservative."""
    risk_per_trade: float = 0.01        # equity risked per trade (distance to the stop)
    max_position_pct: float = 0.20      # one position never exceeds this share of equity
    max_open: int = 5
    daily_loss_limit: float = 0.05      # equity down 5% on the UTC day -> no new entries until tomorrow
    max_drawdown_halt: float = 0.20     # equity 20% below its peak -> no new entries at all (needs a human to reset)
    cooldown_bars: int = 6              # no re-entry in the same symbol for N bars after an exit


@dataclass(frozen=True)
class Costs:
    fee: float = 0.001          # Binance spot taker 0.10% per side (0.075% with BNB discount - not assumed)
    slippage: float = 0.0005    # 5 bps per side on liquid majors


@dataclass(frozen=True)
class Live:
    """Paper-forward / testnet / live runner settings (agents 3 and 5)."""
    max_spread_bps: float = 10.0
    min_book_imbalance: float = 0.40    # bid share of the depth within 0.5% of mid; below this the Sentiment agent vetoes
    min_depth_multiple: float = 5.0     # depth within 0.5% must be >= this x the order notional
    max_order_notional: float = 100.0   # hard cap per order in live/testnet mode (USDT)
    require_no_withdraw_permission: bool = True


@dataclass(frozen=True)
class Config:
    params: Params = field(default_factory=Params)
    risk: Risk = field(default_factory=Risk)
    costs: Costs = field(default_factory=Costs)
    live: Live = field(default_factory=Live)
    universe: tuple = tuple(DEFAULT_UNIVERSE)
