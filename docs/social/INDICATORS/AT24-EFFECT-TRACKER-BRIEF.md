# AT24 Effect Tracker - marketing brief (own research product)

**Name:** AT24 Effect Tracker  **Tagline:** Trading "effects" are born and they die. Which hours are alive right now?
**Platforms:** MT5 only for now (H1 history, DST-aware). **Type:** research tool; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Effect_Tracker/branding/` (logo, screenshot_mt5.png).

## What it solves
"Gold rallies after the New York reopening", "the London open always moves": most such claims were true in some years and quietly stopped being true. The tracker tests every New York hour over the last year and the year before, tells you if it is ALIVE (significant in both), NEWBORN (just appeared) or DIED (used to be significant), and estimates the date when each hour's average changed. It also counts how many of the 24 hours are significant against what chance alone gives (about one).

## Honest claims you MAY make
- It shows the lifecycle of statistical effects on the user's own broker data. On our XAUUSD test the one candidate our research found (the NY 18:00 reopening hour: +8.2 bp per hour in the year before, +1.8 bp in the latest year, change around May 2026) has faded.
- The engine is verified against an independent Python calculation (all 24 hours, statuses and change points identical; New York hour checked on 33,037 bars against the standard time-zone database).
- It pairs with the AT24 Forward Ledger (pre-registered rules, live out-of-sample tally).

## Claims you must NOT make
- No "alive effect = trade it": a significant hour in two windows says nothing certain about the next one, and about one hour in 24 looks significant by chance. No profit or win-rate claims.
- Costs, spread at the first tick and bid-series artifacts are not included; change points are estimates.

## Footer text
"Descriptive history on your broker's data. Research tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
