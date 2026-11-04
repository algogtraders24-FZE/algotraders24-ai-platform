# AT24 Weekend Gap Tracker - marketing brief (new indicator)

**Name:** AT24 Weekend Gap Tracker  **Tagline:** "The gap always fills" - does it, on your market?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Weekend_Gap_Tracker/branding/` (logo, screenshot_mt5.png).

## What it solves
"Gaps always fill" is repeated everywhere and rarely checked. The indicator finds the latest weekend (market-closed) gap, draws the zone and Friday's closing price while it is open, shows whether it has been filled, and measures on YOUR symbol how often gaps were filled within 1 hour, 4 hours, 1 day and 5 days - against a control level at the same distance on the other side.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD H1 test (136 gaps, median 0.39 ATR): gaps were filled within 1 / 4 / 24 / 120 hours in 51 / 66 / 82 / 90 % of cases; a control level at the same distance on the other side was reached in 54 / 74 / 87 / 92 %: gaps fill no more often than any level that near.
- Gaps and statistics verified against an independent Python calculation (all 137 gaps identical).
- Shows the live status of the current weekend gap.

## Claims you must NOT make
- No "trade the gap fill" or any edge/win rate: the numbers match the control level.
- Results depend on the gap-size threshold and the market; other symbols (e.g. indices) differ.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
