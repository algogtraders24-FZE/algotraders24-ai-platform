# AT24 Flow Meter - marketing brief (own product)

**Name:** AT24 Flow Meter  **Tagline:** Delta and cumulative delta that tell you what kind of delta they are.
**Platforms:** MT5 only for now. **Type:** order-flow context indicator; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Flow_Meter/branding/` (logo, screenshot_mt5.png).
**Related MQL5 note:** the owner already sells order-flow style products on MQL5 (DeltaPrint, Gold Footprint Alfa, CMDT Print AI, Oil Pulse): a Flow Meter listing there must be clearly different and checked against them (near-duplicate rule).

## What it solves
Many footprint and delta tools on forex and CFDs present an estimate as if it were real order flow. The Flow Meter shows per-bar delta and daily cumulative delta together with a badge that says REAL (the feed flags buyer and seller trades), TICK-RULE ESTIMATE or BAR PROXY, so the user knows what they are looking at. Delta divergences are marked on closed bars.

## Honest claims you MAY make
- It labels the kind of delta (real, tick-rule estimate, bar proxy); the calculations are verified against an independent Python calculation on real exchange trades and on real gold bars.
- On a liquid market the tick-rule estimate followed true delta closely in our test (about 0.93-0.94 correlation on short samples); say "in our test", not as a general promise.

## Claims you must NOT make
- No "institutional order flow", "smart money" or profit/win-rate wording; on most forex and CFD feeds the delta is an estimate and the badge says so. Delta divergence is context, not a signal.
- Do not claim real order flow for CFD feeds (the IC Markets demo carries no buy/sell flags, no volume, no depth).
- The tick modes are not yet verified on a connected terminal (see the test record).

## Footer text
"Descriptive order-flow context tool, not a signal or a forecast. Delta is an estimate unless the badge says REAL. No trades are placed. Not financial advice. algotraders24.ai"
