# AT24 Correlation Shift Monitor - marketing brief (own product)

**Name:** AT24 Correlation Shift Monitor  **Tagline:** Which relationships are breaking right now? Gold and the dollar, bitcoin and the Nasdaq, gold and oil.
**Platforms:** MT5 only for now. **Type:** market relationship monitor; places no trades; not a signal.
**Assets:** `ea-research/indicators/AT24_Correlation_Shift/branding/` (logo, screenshot_mt5.png; retake the screenshot with broker symbols, mine includes the test symbol BTCUSD_T).

## What it solves
In stressed markets the usual relationships between assets change: gold stops following the dollar, bitcoin trades like a tech stock, oil drives everything. The Monitor shows, for pairs you choose, the daily-return correlation over 20 and 120 days, how far it has moved, and how unusual today's short-term value is in its own history, with an optional alert when a pair shifts.

## Honest claims you MAY make
- A descriptive view of how correlations between the user's own broker symbols are changing; the maths is verified against an independent Python calculation including a known-answer check.
- It does not predict anything and places no trades.

## Claims you must NOT make
- No profit, win-rate or signal wording; a shifted correlation is information, not a trade idea. Short-window correlations are noisy.
- Alerts and the 20-pair load are not yet verified on a live terminal (see the test record).

## Footer text
"Descriptive market tool, not a signal or a forecast. No trades are placed. Not financial advice. algotraders24.ai"
