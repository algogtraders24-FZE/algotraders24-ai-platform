# AT24 Round Levels - marketing brief (list item #6)

**Name:** AT24 Round Levels  **Tagline:** Does price really respect round numbers?
**Platforms:** MT5, MT4 (verified); TradingView (written, NOT yet tested: do not claim it until it is). **Type:** context indicator, no signals. Strategy lesson: #6 Round-Number Reaction.
**Assets:** `ea-research/indicators/AT24_Round_Levels/branding/` (logo, banner, screenshot_mt5.png). Own logo (levels with a price path).

## What it solves
Everyone says gold "respects" $10/$50/$100 levels. This indicator draws the round-number grid, shows the nearest levels above and below, and then tests the claim on your own data: how often price bounced at a round level versus at control levels placed half a step away. If the numbers match, round numbers are not special on your symbol.

## Honest claims you MAY make
- Real history on your own broker data. Our XAUUSD M15 test (8,000 bars): bounce rate 50% at $10 levels vs 50% at control levels; $50: 48% vs 50%; $100: 49% vs 47%. In other words, no round-number effect was visible.
- Maths verified against an independent Python scan (all 6 scans identical); MT4 runtime statistics match.
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "round numbers act as support/resistance", "reaction zones" or edge. Our own test says they did not on this data.
- The reaction definition (1 ATR away before 1 ATR through, 20 bars) is one choice; do not present it as the only truth.
- Do not advertise the TradingView version until the Pine script has been compiled and checked.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
