# AT24 Range Detector - marketing brief (list item #9)

**Name:** AT24 Range Detector  **Tagline:** When the trend fades, how do ranges end?
**Platforms:** MT5 only for now (MT4 / TradingView to be done by another agent). **Type:** context indicator, no signals. Strategy lesson: #9 Range Mean Reversion.
**Assets:** `ea-research/indicators/AT24_Range_Detector/branding/` (logo, banner, screenshot_mt5.png). Own logo (trend, consolidation box, fading ADX bars).

## What it solves
Range trading advice ("fade the edges") fails when the range is really a pause in a trend. The indicator draws consolidation boxes when ADX fades from a strong trend, shows whether you are in one now and where price sits inside it, and measures real history: how long ranges last, how tall they are, which way they ended, whether breakouts continued the prior move, and how often a breakout fell back inside within a few bars.

## Honest claims you MAY make
- Real history on your own broker data. Our XAUUSD M15 test (153 ranges): median 19 bars, 2.9 ATR tall; ended up 52% / down 48%; breakouts followed the prior move 47% of the time; 46% of breakouts closed back inside within 5 bars.
- Maths verified against an independent Python calculation (ADX 5e-6, all 153 ranges and every statistic identical).
- Concept inspired by an MQL5 Code Base ADX-fade indicator; this is our own code and statistics.
- It never prints buy/sell arrows.

## Claims you must NOT make
- No "range strategy that works", "fade the breakout" or edge: the numbers are a coin flip.
- Ranges depend on the chosen ADX settings; other settings give other boxes and numbers.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
