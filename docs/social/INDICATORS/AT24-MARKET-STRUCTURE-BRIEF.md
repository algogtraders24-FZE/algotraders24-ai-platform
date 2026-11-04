# AT24 Market Structure - marketing brief (list item #13)

**Name:** AT24 Market Structure  **Tagline:** BOS and CHoCH on confirmed swings - and what price did next.
**Platforms:** MT5 only for now. **Type:** context indicator, no signals. Strategy lesson: #13 Market structure (BOS / CHoCH).
**Assets:** `ea-research/indicators/AT24_Market_Structure/branding/` (logo, screenshot_mt5.png).

## What it solves
"Break of structure" and "change of character" are drawn differently by every trader. The indicator applies one fixed rule: swings are confirmed after k bars, a break needs a bar CLOSE beyond the latest swing, a break with the current structure is BOS, the first one against it is CHoCH. It draws them, shows the structure state and the open swing levels, and measures on YOUR symbol what price did after each kind of break.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (364 breaks): 20 bars after a BOS price kept going 46 %, after a CHoCH 51 %, versus 48 % for any bar.
- Maths verified against an independent Python calculation (all events and statistics identical). No repaint: closed bars only, swings used only after confirmation.
- Never prints buy/sell arrows.

## Claims you must NOT make
- No "CHoCH reversal entry", "BOS continuation" or any edge/win rate: the numbers are no different from a random bar.
- Events depend on the swing size; other settings give other breaks and numbers.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
