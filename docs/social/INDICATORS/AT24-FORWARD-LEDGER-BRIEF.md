# AT24 Forward Ledger - marketing brief (own research product)

**Name:** AT24 Forward Ledger  **Tagline:** Ideas registered before they are traded. No hindsight.
**Platforms:** MT5 only for now. **Type:** research ledger; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Forward_Ledger/branding/` (logo, screenshot_mt5.png; test/ has the REPLAY-mode screenshot).

## What makes it different
Almost every "edge" online is found by looking at history and then tested on the same history. The ledger does the opposite: a candidate rule is written down with a date, and only what happens AFTER that date counts. It shows, live, how many trades each rule has made, the average return, the average net of the market's own drift, a t-statistic, and a verdict that only turns green when the result beats chance after correcting for the number of rules registered (three). Our own research ideas go first, including ones that looked good in the past.

## Honest claims you MAY make
- It is a transparency tool: results are out-of-sample by construction and recomputable from the user's own broker history; the engine was verified against an independent Python calculation (all numbers identical on three start dates, and on the New York hour for 34,967 bars).
- It shows the real status of our own research candidates, whatever happens. On the first day all rules read "collecting".
- It replays history in a clearly labelled REPLAY mode so users can see how misleading in-sample numbers are (replay from mid-2025 shows the NY 18:00 rule at +5 bp; the last four months show -1 bp).

## Claims you must NOT make
- No claim that any of the three registered rules has an edge. The research found no pre-registered finding; the NY 18:00 rule is an unconfirmed candidate and may be a bid/spread artifact.
- Nothing about future results; nothing about profitability of the ledger rules; no costs are subtracted in the ledger.
- Do not call it a signal or a strategy.

## Footer text
"Research ledger, not a signal. It replays closed bars and places no trades. Past results do not predict future results. Not financial advice. algotraders24.ai"
