# AT24 Divergence Pro - marketing brief (own product)

**Name:** AT24 Divergence Pro  **Tagline:** RSI divergence that cannot repaint - and the record of how past divergences did on your chart.
**Platforms:** MT5 only for now. **Type:** divergence indicator + research scorecard; places no trades.
**Assets:** `ea-research/indicators/AT24_Divergence_Pro/branding/` (logo, screenshot_mt5.png).

## What it solves
Divergence indicators are popular and often repaint: a swing point appears, then moves or vanishes. Divergence Pro uses a swing point only after the bars to its right have closed, draws the divergence line with entry, stop and target levels for a live one, and scores every past divergence in R after cost with a luck test, separately for bullish and bearish. When divergences have shown no edge on your symbol, it says so.

## Honest claims you MAY make
- Non-repainting by construction (confirmed swing points, closed bars); levels shown before the trade; every past divergence is scored on its own trade with a luck test; the whole chain (RSI, swings, divergences, trades, scorecards) is verified against an independent Python calculation (104 divergences, 85 trades, all identical).
- On our XAUUSD H1 test feed no group showed an edge (bullish -0.17 R, bearish +0.13 R, p 0.82 / 0.24): say that the tool is honest, not that divergences win.

## Claims you must NOT make
- No profit, win-rate or accuracy claims; no "reversal signals"; the scorecards are in-sample and past results do not predict future results.
- No divergence-definition details in listing copy (generic wording only); first sentence 70-155 characters; title <= 40 characters.
- The live block and alerts are not yet verified on a live chart (see the test record).

## Footer text
"Research and planning tool, not a signal or a forecast. No trades are placed. Past results do not predict future results. Not financial advice. algotraders24.ai"
