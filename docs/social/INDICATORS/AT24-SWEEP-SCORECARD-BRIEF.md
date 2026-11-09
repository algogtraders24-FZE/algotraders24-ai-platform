# AT24 Sweep Scorecard - marketing brief (own research product)

**Name:** AT24 Sweep Scorecard  **Tagline:** The Asian-range sweep setup, graded honestly - losers included.
**Platforms:** MT5 only for now (H1 history, DST-aware). **Type:** research tool; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Sweep_Scorecard/branding/` (logo, screenshot_mt5.png).

## What it solves
"Asian range sweep, then trade the reversal" is one of the most shared setups, and most tools show only the winners. The scorecard marks every Asian-range sweep on the chart, shows today's state (range forming / set / swept), and grades EVERY historical sweep in R with costs: the reversal trade, the mirror (continuation) trade and a random-direction control, with the verdict "lost money / made money / not clearly different from zero".

## Honest claims you MAY make
- It reports what the setup really paid on the user's own broker data, losers included. XAUUSD H1 (954 sweeps since 2021-05): the reversal lost 0.24 R per trade net of cost (hit rate 42 %); the mirror trade lost 0.12 R; a random direction lost 0.18 R. Over the latest 14 months the reversal is not distinguishable from a random direction.
- The engine reproduces our pre-registered research test (same 954 events, same numbers) and is verified against an independent Python calculation (all trades identical).
- Stated definition, fixed in advance; cost is an input.

## Claims you must NOT make
- No "profitable sweep strategy", no win rates as promises, no "trade the reversal/continuation". The honest finding is that it lost money on this definition.
- Other definitions (other hours, targets, stops, filters) were not tested; results are for gold on one broker feed.
- Not a signal; do not describe the "today" status as an entry.

## Footer text
"Descriptive history on your broker's data. Research tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
