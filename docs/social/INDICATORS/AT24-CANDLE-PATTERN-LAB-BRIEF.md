# AT24 Candle Pattern Lab - marketing brief (new indicator)

**Name:** AT24 Candle Pattern Lab  **Tagline:** Engulfing and pin bars - do they really work on your chart?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Candle_Pattern_Lab/branding/` (logo, screenshot_mt5.png).

## What it solves
Candlestick patterns are taught as signals but rarely measured. The indicator marks bullish/bearish engulfing and pin-bar candles on closed bars (tiny candles filtered out by ATR) and shows, on YOUR symbol and timeframe, how often price moved the pattern's way afterwards compared with the same measure on any random bar, with sample size and a 95 % interval.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (about 500 occurrences of each pattern): after 6 bars price moved the pattern's way 49-55 % of the time versus 48-52 % for any bar: no demonstrable edge.
- Pattern flags and statistics verified against an independent Python calculation (all 8,000 bars and all four studies identical). No repaint: patterns only on closed bars.
- Shows n and the confidence interval so users judge the evidence themselves.

## Claims you must NOT make
- No "reversal signal", "high-probability pattern" or win rate. We did not test pattern + location/trend filters.
- Definitions are ours (stated in the test record); other definitions give other counts.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
