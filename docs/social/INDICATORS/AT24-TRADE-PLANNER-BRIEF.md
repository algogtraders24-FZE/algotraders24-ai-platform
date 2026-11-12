# AT24 Trade Planner - marketing brief (own product)

**Name:** AT24 Trade Planner  **Tagline:** Drag three lines, know your lots, your risk and your reward before you click.
**Platforms:** MT5 only for now. **Type:** planning calculator; places no orders; not a signal.
**Assets:** `ea-research/indicators/AT24_Trade_Planner/branding/` (logo, screenshot_mt5.png).

## What it solves
Most blown accounts start with a wrong lot size or a trade that quietly eats the daily loss limit. The Trade Planner puts Entry, Stop and Target lines on the chart; as the lines move it shows the lots for the chosen risk, the money at the stop and at the target, R:R, margin, spread and commission as a share of the reward, and how much of today's remaining loss allowance the trade would use (useful with prop-firm daily limits).

## Honest claims you MAY make
- It calculates lots and money from the user's own entry, stop, target and risk rule on the chart symbol; the maths is verified against an independent Python calculation (8 scenarios, long and short).
- It places no orders and gives no signals.

## Claims you must NOT make
- No profit or win-rate claims; it does not say whether a trade is a good idea, only what it costs and risks.
- Do not claim exact agreement with every broker's contract specs: the platform cross-check (OrderCalcProfit) still has to be run on a connected terminal, and slippage, gaps and swap are not included.

## Footer text
"Planning calculator, not a signal or advice. No orders are placed. Not financial advice. algotraders24.ai"
