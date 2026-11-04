# AT24 Streak Meter - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_SK_SelfTest.mq5` + `test/verify_sk.py`, XAUUSD D1 953 candles and H4 5,719 candles) | streak length per candle and every continuation count and percentage (streak lengths 1 to 6+, plus the baseline) identical on both series |
| MT5 live chart (portable terminal, XAUUSD H1 chart showing D1 streaks) | current streak, continuation table with n and 95 % intervals: test/mt5_streak_meter_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed
Definition: candle colour = close above/below open; a streak is consecutive candles of the same colour; "continued" = the next candle has the same colour (flat candles are skipped).

| Candles | baseline (next same colour as current) | after 1 | after 2 | after 3 | after 4 | after 5 | after 6+ |
|---|---|---|---|---|---|---|---|
| D1, 953 candles | 46.6 % | 47.0 % (n=508) | 47.3 % (239) | 45.1 % (113) | 47.1 % (51) | 37.5 % (24) | 47.1 % (17) |
| H4, 5,719 candles | 49.8 % | 50.3 % (2,867) | 48.4 % (1,442) | 50.4 % (697) | 48.4 % (349) | 56.0 % (168) | 48.6 % (183) |

On daily gold the next candle had the same colour as the last only 46.6 % of the time (slightly more alternation than continuation), and that rate does not depend on streak length: 3 or 4 days in a row is no more "due for a reversal" than 1. The 5-day value (37.5 %) has n = 24 (+-19 points) and is noise, as are the H4 figures around 50 %. Descriptive only: no edge.

## Notes / limits
- Small samples at long streaks: the dashboard always shows n and the 95 % interval.
- D1 candles use the broker's server-day boundary; other symbols and periods can differ.
- Alerts: none (descriptive).
