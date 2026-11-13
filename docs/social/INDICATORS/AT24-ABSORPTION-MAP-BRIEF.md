# AT24 Absorption Map - marketing brief (own product)

**Name:** AT24 Absorption Map  **Tagline:** Where heavy volume went nowhere - and how those levels behaved when price came back.
**Platforms:** MT5 only for now. **Type:** volume-effort zone indicator + research scorecard; places no trades.
**Assets:** `ea-research/indicators/AT24_Absorption_Map/branding/` (logo, screenshot_mt5.png; retake the screenshot on a chart with fresh zones so the rectangles are visible).
**MQL5 note:** the owner already sells order-flow style products on MQL5 (DeltaPrint, Gold Footprint Alfa, CMDT Print AI, Oil Pulse); check for near-duplicates before listing. Also overlaps in idea with AT24 Zone Pro (different detection: volume effort versus impulse): do not list both with the same wording.

## What it solves
Traders talk about "absorption" (heavy volume without movement) but rarely see how often such levels held. The Absorption Map marks bars with heavy tick volume and little progress after a push, draws the fresh zones with entry, stop and target levels, and scores the first retest of every past zone in R after cost with a luck test, for sellers absorbed and buyers absorbed separately.

## Honest claims you MAY make
- It uses tick volume per bar (a proxy for effort, not exchange volume); non-repainting; the whole chain (zones, retests, trades, scorecards) is verified against an independent Python calculation (94 zones, 89 trades, all identical).
- On our XAUUSD H1 test feed no group showed an edge (sellers absorbed -0.34 R, buyers absorbed +0.23 R, p 0.94 / 0.13): say that the tool is honest, not that absorption zones win.

## Claims you must NOT make
- No "institutional", "smart money" or "real order flow" wording; no profit or win-rate claims; scorecards are in-sample.
- No definition details in listing copy; first sentence 70-155 characters; title <= 40 characters.
- Touch alerts and the fresh-zone drawing on this indicator are not yet seen live (see the test record).

## Footer text
"Research and planning tool, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice. algotraders24.ai"
