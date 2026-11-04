# AT24 Persistence Meter - marketing brief (new indicator, from the MQL5 feed)

**Name:** AT24 Persistence Meter  **Tagline:** Do moves continue or reverse here - and did that ever help?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Persistence_Meter/branding/` (logo, screenshot_mt5.png).

## What it solves
Traders choose "trend" or "mean reversion" by feel. The indicator runs a standard statistical test (variance ratio) on the last bars at three move lengths and states plainly whether moves tend to continue, reverse or look random, with the exponent and z-score. Then it checks the claim on YOUR symbol: how often the reading was each state, and whether the next move really went the same way as the last one - always with sample sizes and 95 % intervals.

## Honest claims you MAY make
- A real statistical test, verified against an independent Python calculation (90 spot checks and the full study identical).
- Real history on your own broker data. XAUUSD M15 test (236 windows): the meter said "continue" in 3 % of windows, "reverse" in 17 %, "random" in 80 %; the next move followed the last one 55 % overall; after "continue" 62 % (8 windows, +-34), after "reverse" 50 % (40 windows, +-15): not distinguishable from noise.
- Shows its own uncertainty (n and confidence interval on screen).

## Claims you must NOT make
- No "trend filter that works" or "mean-reversion signal": on our data the reading did not demonstrably predict the next move.
- A variance-ratio reading says something about serial correlation in the recent window only; it can flip quickly and changes with window and move length.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
