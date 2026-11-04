# AT24 FVG Zones - marketing brief (list item #14)

**Name:** AT24 FVG Zones  **Tagline:** Open fair value gaps - and whether price really comes back.
**Platforms:** MT5 only for now. **Type:** context indicator, no signals. Strategy lesson: #14 Fair value gaps.
**Assets:** `ea-research/indicators/AT24_FVG_Zones/branding/` (logo, screenshot_mt5.png).

## What it solves
FVGs are drawn by eye and rarely checked. The indicator finds every three-bar gap on closed bars (size-filtered by ATR), shows the ones not yet filled, flags those already touched, and measures on YOUR symbol how often and how fast price returned to gaps versus a control level at the same distance.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (693 gaps): revisited within 50 bars 90 % (median 2 bars), filled completely 78 %; a control level at the same distance was revisited 89 %.
- Maths verified against an independent Python calculation (all gaps and statistics identical). No repaint: a gap exists only after its third bar closed.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No "price is drawn to the gap", "gap entry" or any edge/win rate: a gap is no stronger a magnet than any other level at that distance.
- Do not advertise the "bounced 73 %" figure (low bar). Numbers depend on the ATR filter and window.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
