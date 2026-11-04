# AT24 Position Size - marketing brief (risk tool R1)

**Name:** AT24 Position Size  **Tagline:** Risk the money you chose, not a guess.
**Platforms:** MT5 only for now. **Type:** risk calculator on the chart; places NO trades. Risk lesson: R1 position sizing.
**Assets:** `ea-research/indicators/AT24_Position_Size/branding/` (logo, screenshot_mt5.png).

## What it does
You set risk % (of live balance or a chosen account size) and a stop distance (fixed price units or ATR multiple). It shows lots rounded down to the symbol's real volume step and limits, the loss per lot, actual money and % at risk, margin needed, targets in R, and draws a ladder of stop/target levels around the last close. Works for gold, forex and indices because it uses the platform's own tick size and tick value.

## Honest claims you MAY make
- Formula verified against an independent exact-decimal calculation on 10 test cases plus the real gold symbol (all identical).
- Rounds lots DOWN so real risk never exceeds your target; warns when the minimum lot is too big or the risk % is above your own limit.
- Never places, modifies or closes trades.

## Claims you must NOT make
- No "guarantees your loss is limited": spread, slippage and gaps can make a real loss larger than the calculated stop loss.
- Not validated against the platform's own loss calculation in our test terminal (no broker connection); the formula uses the same symbol data. Always check the lot size in your platform before trading.
- No profit or win-rate claims; not financial advice.

## Footer text
"Calculator, not a signal. It never places trades. Spread, slippage and gaps can increase a real loss. Not financial advice. algotraders24.ai"
