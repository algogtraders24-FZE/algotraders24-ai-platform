# AT24 Edge Truth Test - marketing brief (own research product)

**Name:** AT24 Edge Truth Test  **Tagline:** Is your result skill or luck? Ask the statistics before you trust the equity curve.
**Platforms:** MT5 only for now (reads the account's closed-trade history). **Type:** analysis tool; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Edge_Truth_Test/branding/` (logo, screenshot_mt5.png; the screenshot uses the labelled SAMPLE list).

## What it solves
A green equity curve feels like proof. It often is not: a handful of lucky trades, or a long losing streak, can come from pure chance. The Edge Truth Test takes your own closed trades (all, one symbol, one magic number, last N days) and shows whether luck alone could plausibly explain them, where the total could end up with the same trades, and whether your drawdown was bad luck or normal.

## Honest claims you MAY make
- It tests the user's own trade list against chance with three methods (sign-flip test, bootstrap range, shuffled-order drawdown) and says plainly when there are too few trades.
- The statistics are verified against an independent Python implementation on four test lists (noise, real edge, too few trades, losing).

## Claims you must NOT make
- A pass is NOT proof of a lasting edge or a prediction; markets change, and many tested ideas produce lucky lists. No profit claims.
- Do not present the sample screenshot as real trading results: it is a labelled demonstration list.
- Not yet verified on a real account history (see the test record); do not claim that until one demo run with trades is done.

## Footer text
"History-only research tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
