# AT24 Volatility Forecast - marketing brief (new indicator, from the MQL5 feed)

**Name:** AT24 Volatility Forecast  **Tagline:** How big a move is normal in the next hours - and how well that estimate really worked.
**Platforms:** MT5 only for now (H1 or lower chart). **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Volatility_Forecast/branding/` (logo, screenshot_mt5.png).

## What it solves
Traders set stops and targets without knowing whether the market is quiet or wild for this time of day. The indicator estimates volatility from open/high/low/close, removes gold's time-of-day pattern, and shows the expected 1-sigma and 2-sigma move for the next hours (band on the chart), a volatility regime with a percentile, and a calibration table: how well the forecast tracked the volatility that really followed versus a plain average and versus ATR.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD M15 test (243 eight-hour windows): the time-of-day-aware forecast tracked realized volatility with correlation 0.39 and 71 % of windows within +-30 %, versus 0.09 / 61 % for a plain average and 0.10 / 35 % for ATR(14), which ran 37 % low.
- Maths verified against an independent Python calculation (all forecasts and statistics identical). No look-ahead: the time-of-day profile uses only past bars.
- Shows SIZE of moves only.

## Claims you must NOT make
- No direction, no signals, no "volatility breakout edge". Volatility is partly forecastable (correlation 0.39 is moderate, not strong); real moves have fatter tails than +-sigma bands suggest.
- Numbers are for one symbol and period; other markets differ. Not a guarantee a stop will survive.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast of direction. Not financial advice. algotraders24.ai"
