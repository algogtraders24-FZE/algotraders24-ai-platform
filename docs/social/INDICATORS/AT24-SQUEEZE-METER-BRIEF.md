# AT24 Squeeze Meter - marketing brief (list item #4)

**Name:** AT24 Squeeze Meter  **Tagline:** Compression first - but what came after?
**Platforms:** MT5, MT4 (verified); TradingView (written, NOT yet tested: do not claim it until it is). **Type:** context indicator, no signals. Strategy lesson: #4 Volatility Breakout / Squeeze.
**Assets:** `ea-research/indicators/AT24_Squeeze_Meter/branding/` (logo, banner, screenshot_mt5.png). Own logo (converging bands + breakout).

## What it solves
"A squeeze means a big move is coming" is repeated everywhere. The indicator marks Bollinger-inside-Keltner squeezes (red dots), shows momentum, and measures what actually followed squeezes on your own symbol: how long they last, how wide the next 20 bars were compared with the usual range, and how often the momentum sign matched the bigger side.

## Features
Squeeze dots + momentum histogram, state on the dashboard (squeeze on / released / none), band ratio, real post-squeeze statistics, alert when a squeeze releases (bar close, no repaint), branded dashboard (off in the Strategy Tester by default).

## Honest claims you MAY make
- Real history on your own broker data. Our XAUUSD M15 test (137 squeezes): next-20-bar range 4.27 ATR vs 4.49 ATR usual; wider than usual only 44.5% of the time; momentum matched the bigger side 46.7%.
- Maths verified against an independent Python calculation (0 squeeze mismatches, all 137 releases identical); MT4 runtime buffers match over 400 bars.
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "squeezes lead to explosive moves", "breakout strategy that works", win rates or edge. On this data a squeeze did not signal a bigger-than-usual move.
- Do not advertise the TradingView version until the Pine script has been compiled and checked.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
