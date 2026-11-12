# AT24 Zone Pro - marketing brief (own product)

**Name:** AT24 Zone Pro  **Tagline:** Supply and demand zones with the receipts: how did the first retest of past zones really turn out on your chart?
**Platforms:** MT5 only for now. **Type:** zone indicator + research scorecard; places no trades.
**Assets:** `ea-research/indicators/AT24_Zone_Pro/branding/` (logo, screenshot_mt5.png).

## What it solves
Supply/demand and order-block tools are everywhere (many free), but none tells you how often the zones it draws actually held on the symbol you trade. Zone Pro draws the fresh zones with ready entry, stop and target levels and scores every past zone's first retest in R after cost with a luck test, separately for demand and supply. When zones have not shown an edge on your symbol, it says so.

## Honest claims you MAY make
- Non-repainting (zones appear only after the impulse bar has closed); levels shown before the trade; every past zone is scored on its first retest with a luck test; the whole chain (zone detection, retests, trades, scorecards) is verified against an independent Python calculation (187 zones, 303 test trades, all identical).
- On our XAUUSD H1 test feed no zone group showed an edge (demand +0.09 R, supply -0.19 R): say that the tool is honest, not that the zones win.

## Claims you must NOT make
- No profit, win-rate or accuracy claims; no "high-probability zones"; the scorecards are in-sample and past results do not predict future results.
- No zone-definition details in listing copy (generic wording only); first sentence 70-155 characters; title <= 40 characters.
- Touch alerts are not yet verified on a live chart (see the test record).

## Footer text
"Research and planning tool, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice. algotraders24.ai"
