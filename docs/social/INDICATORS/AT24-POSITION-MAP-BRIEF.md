# AT24 Position Map - marketing brief (own product, positional price action)

**Name:** AT24 Position Map  **Tagline:** Weekly structure for direction - an H4 turn for the entry - and the receipts for every setup.
**Platforms:** MT5 only for now. **Type:** planning indicator + research scorecard; places no trades. **Price:** 33 USD (new-products price).
**Assets:** `ea-research/indicators/AT24_Position_Map/branding/` (logo, screenshot_mt5.png).

## What it solves
Positional traders are told to "trade with the trend" without a precise definition of the trend, a precise entry or a precise stop. Position Map writes the rules down: weekly higher highs plus higher lows (or lower highs plus lower lows) are the only direction, anything else is no trade; it plans entry, a structural stop and three targets (1:3, 1:4, 1:5) before the trade, and scores every setup the same rules would have produced on the symbol's own history, per target, next to a control and a luck test. A trend-life block shows how long weekly legs last and how deep pullbacks go on that symbol.

## Honest claims you MAY make
- Non-repainting: swings are used only after they are confirmed, a trend break needs a close, closed bars only.
- Levels (entry, stop, three targets) are shown before the trade; every historical setup is walked forward on the user's own bars and scored in R after cost (spread and broker swap) with a luck test and a control.
- The engine is verified against an independent Python rebuild (all swings, every trend bar, every setup field, the scores) and by 29 hand-worked unit tests; a cut-history test shows no look-ahead.
- On our XAUUSD test feed the scorecard had fewer than 30 setups: the indicator says "too few setups" and makes no claim. Say that the tool is honest and exact, not that the plans win.

## Claims you must NOT make
- No profit, win-rate or "accuracy" claims, no "signals", no "high probability" language; a scorecard is in-sample history and past results do not predict future results.
- Do not describe the exact entry or stop logic in listing copy (generic wording only: "weekly structure for direction, a lower-timeframe turn for the entry, structural stop"); title <= 40 characters, first sentence 70-155 characters.
- Alerts, lot size and swap on a live account are not yet verified (see the test record). The weekly stop can be wide; say that position sizing shrinks with it.

## Footer text
"Research and planning tool, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice. algotraders24.ai"
