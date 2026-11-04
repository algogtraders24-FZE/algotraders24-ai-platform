# AT24 Hour Bias Map - marketing brief (new indicator)

**Name:** AT24 Hour Bias Map  **Tagline:** Does your market lean up or down at certain hours - or is it chance?
**Platforms:** MT5 only for now. **Type:** context indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Hour_Bias_Map/branding/` (logo, screenshot_mt5.png).

## What it solves
"Gold rises in the Asian session", "never trade the 11 o'clock hour": hour-of-day claims are everywhere and rarely tested. The indicator shows mean return per New York hour (daylight-saving aware) as a histogram with t-statistics, highlights the current hour, and does the check most posts skip: how many of 24 hours look significant versus what chance alone gives, and whether the pattern in the first half of the history held in the second half.

## Honest claims you MAY make
- Real history on your own broker data. XAUUSD H1 test (15,485 bars, 2.6 years): only one of 23 hours (NY 18:00, the first hour after the daily break) is statistically clear (+3.8 bp per hour, 58.7 % up, positive in both halves); all other hours are within chance, and the overall first-half pattern did not predict the second half (correlation -0.04).
- Time conversion verified against the standard time-zone database on all bars; statistics verified against an independent Python calculation (all identical).
- Teaches the multiple-comparisons problem on the user's own data.

## Claims you must NOT make
- No "trade this hour", "best hour to buy" or win rates. The NY 18:00 effect is in-sample on a strongly rising gold market, untested out of sample and possibly a reopening artifact; costs (spread, slippage) were not studied.
- Hours depend on the chosen clock (New York here) and the history length; other symbols differ.

## Footer text
"Descriptive history on your broker's data. Context tool, not a signal or a forecast. Not financial advice. algotraders24.ai"
