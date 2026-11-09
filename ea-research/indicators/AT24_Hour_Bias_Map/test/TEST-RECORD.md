# AT24 Hour Bias Map - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| New York hour / DST-aware clock (`test/verify_hb.py`, 15,485 XAUUSD H1 bars, 2024-03-25 to 2026-11-04) | server time -> GMT -> New York hour identical to Python `zoneinfo` America/New_York for all 15,485 bars (Equiti feed: GMT+2, US daylight rule) |
| Core maths vs independent Python (`mt5/AT24_HB_SelfTest.mq5`) | per-hour count, mean (bp), t-statistic, % up, first-half and second-half means, std identical for all 24 hours; counts of hours with |t| >= 1.96 and |t| >= 3, the first-half/second-half correlation and the same-sign count identical |
| MT5 live chart (portable terminal, XAUUSD M15 chart, 900 days of H1) | histogram of mean return by New York hour, current hour highlighted, chance check and persistence line: test/mt5_hour_bias_map_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD H1, 15,485 hourly bars, about 670 per New York hour)
- Of 23 hours with data (NY 17:00 has no bars: the daily break), exactly **one** hour is statistically clear: **NY 18:00** (the first hour after the daily break), mean +3.84 bp per hour, t = +3.67, price up in 58.7 % of those hours, and positive in both halves of the history (+2.49 bp then +5.20 bp). It passes a Bonferroni check for 24 hours (|t| >= 3.0).
- Every other hour has |t| < 1.96 (chance alone would give about one hour above 1.96).
- Across all hours the first-half pattern does not predict the second half: correlation -0.04 between the 24 first-half and second-half means; only 9 of 24 hours have the same sign in both halves and overall.
- Context that matters: gold rose strongly over 2024-2026, so the average hour is positive; the NY 18:00 effect has not been tested out of sample, may reflect the market reopening (liquidity, spread, feed handling) rather than a tradable bias, and a mean of ~3.8 bp is about 1.5 USD on gold before spread and slippage. We make no trading claim. Descriptive only.

## R&D basis
Hour-of-day effects are a common request in the MQL5 library (seasonality, session statistics). Own code: grouping of hourly log returns by DST-aware New York hour, t-tests per hour, a count of "significant" hours against chance and against a Bonferroni threshold, and a first-half / second-half persistence check.

## Notes / limits
- Needs the symbol's H1 history (the indicator retries until the terminal has built it; first display can take a few seconds). 900 days by default; changes in length change the numbers.
- Hours use the New York clock, so the pattern moves against broker time twice a year (handled by the DST-aware clock); if clock detection fails the indicator waits (it never falls back to a fixed offset silently).
- Alerts: none (descriptive map).

## History guard (2026-11-10)
The indicator now skips any history before the first server day with at least 20 hourly bars (this broker stores H1 before 2021-05 as two bars per day, which would otherwise create false data). Checked on this feed with the history set to 3,000 days: 33,009 valid hourly bars (2021-05 onwards) instead of 34,967, all 24 New York hours present; statistics code unchanged.
