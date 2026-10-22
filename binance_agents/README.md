# binance_agents - a paper-trading desk of six Claude agents (Binance Spot)

**PAPER ONLY.** Nothing here sends an order to Binance. It reads *public* market data (no API key) and simulates fills with fees and slippage.
The real-money broker (`agents/execution.py: BinanceBroker`) exists, is gated behind several explicit switches and has never been run against the
exchange - do not use it before weeks of paper results say there is something worth trading.

## What it is
Three "arms" trade the **same market** with the **same risk rules, fees and slippage** every hour, on closed 1h candles of 30 liquid USDT pairs:

| Arm | Who decides |
|---|---|
| **desk** | six Claude agents + a Reviewer (Scout, Risk Checker, Sentiment, Strategy, Execution, Risk Manager) |
| **rules** | the deterministic breakout + volume rule (no LLM) |
| **random** | coin-flip entries, same trend + liquidity filters, same exits, matched frequency - the honest yardstick |

The point is a clean experiment: *do LLM agents add anything over the plain rule and over a coin flip?* The dashboard scoreboard answers that.

### Guardrails (all enforced in code, see `desk/schemas.py`, `agents/risk_manager.py`, `desk/book.py`)
- Agents only **propose**. Every number is validated and clipped (stop 1-3 ATR, limit offset 0-30 bps, size multiplier 0-1). Unknown symbols are dropped.
- A silent, slow, malformed or over-budget agent means **no trade** (Risk Checker / Risk Manager default to "no", Strategy to "SKIP").
- The Risk Manager agent can only **reduce or veto** the size the rules engine computed. Hard limits that no agent can override: 1% risk per trade, 20% max position,
  5 open positions, 5% daily loss stop, 20% drawdown halt (sticky), per-symbol cooldown, long-only, no leverage, stops always set by code (an agent may only tighten).
- Exits (stop / ATR trail / time) are deterministic code for every arm.
- Claude spend is capped per day (`--budget`, default $3, an estimate); a quiet market costs $0 (the desk only calls Claude when a coin shows unusual volume or a position is open).
- Every call (prompt, answer, tokens, cost) is logged to `state/llm_calls.jsonl`; every decision to `state/activity.jsonl`.

## Run
```
pip install -r binance_agents/requirements.txt anthropic fastapi uvicorn
python -m binance_agents download                  # candles (public data), ~2 min the first time
python -m binance_agents desk --once               # one cycle (needs ANTHROPIC_API_KEY or frontend/.env.local)
python -m binance_agents desk --loop               # every hour, ~20 s after the candle closes
python -m binance_agents dashboard                 # http://127.0.0.1:8800 (standard)  and  /terminal (mission control)
python -m binance_agents desk --once --fake        # no Claude calls (rules + random arms only), for a free dry run
python -m unittest discover -s binance_agents/tests -t .
```

## What the numbers say so far (be honest with yourself)
The deterministic rule (close above the previous 48-candle high, volume >= 2x average, above EMA200, up candle; ATR stop and trail; next-open fill; 0.10% fee + 5 bps
slippage per side) was fixed **before** the first backtest and never tuned. 30 pairs, 1h, 2021-2026:

| Run | trades | win % | profit factor | return |
|---|---|---|---|---|
| rules, 20% DD halt ON (2021-23 / 2024-now) | 73 / 247 | 30 / 34 | 0.66 / 0.81 | -13% / -15% (halted early both times) |
| rules, halt OFF, full | 4,940 | 31.8 | **0.86** | -92% |
| **random entries** (same filters/exits), mean of 8 | ~5,800 | - | **0.90** (0.86-0.95) | - |

Reading: **the breakout + volume rule has no edge over random entries once costs are paid.** Buy-and-hold of BTC (+182%) or an equal-weight basket (+419%) beat it by far.
Caveats that flatter the test, not hurt it: the 30 pairs are today's survivors, and the Sentiment agent / spread / depth checks cannot be backtested. LLM agents cannot be
backtested honestly at all (the model already "knows" the past), which is why the desk is a **forward** paper experiment: it needs weeks and ~100 trades per arm before
any difference means anything. Until the scoreboard shows the desk clearly ahead of both other arms, do not put real money behind it.

## Layout
`config.py` all numbers | `data.py` public Binance data | `features.py` no-look-ahead indicators | `agents/` Scout, RiskChecker, Sentiment, Strategy, RiskManager, brokers |
`backtest.py` rules backtest (+ random baseline) | `desk/` Claude desk: `llm.py`, `prompts.py`, `schemas.py`, `book.py`, `cycle.py`, `dashboard.py`, `static/` | `tests/` 31 tests
