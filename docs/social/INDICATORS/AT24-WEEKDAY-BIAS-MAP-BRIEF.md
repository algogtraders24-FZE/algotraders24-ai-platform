# AT24 Weekday Bias Map - marketing brief (new indicator)

**Name:** AT24 Weekday Bias Map  **Tagline:** "Gold always dips on Mondays" - does it, or is it chance?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Weekday_Bias_Map/branding/` (logo, screenshot_mt5.png).

## What it solves
Weekday folklore ("Monday gap fade", "Friday profit-taking") is rarely tested. The indicator shows the mean daily return per weekday as a histogram with t-statistics, highlights today, and does the checks most posts skip: how many of five weekdays look significant versus chance, and whether the pattern from the first half of the history held in the second half.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD daily test (953 candles, about 190 per weekday): no weekday reached statistical significance (all |t| below 1.3), every weekday was positive because gold rose over the period, and the weekday pattern did not persist between the two halves of the history.
- Weekday and statistics verified against an independent Python calculation (all identical).
- Teaches the multiple-comparisons and in-sample/out-of-sample ideas on the user's own data.

## Claims you must NOT make
- No "best day to buy", "avoid Mondays" or win rates: no weekday effect was found.
- Results depend on the symbol, the history length and the broker's day boundary; 5 weekdays give very few points for any persistence correlation.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
