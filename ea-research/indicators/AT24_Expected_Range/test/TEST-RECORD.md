# AT24 Expected Range - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| MT5 core maths vs independent Python (`mt5/AT24_ER_SelfTest.mq5` + `test/verify_er.py`, 8,000 XAUUSD M15 bars = 88 server days, 14-day average) | all 88 days identical (first/last bar, expected range, bar where the 100 % level was first reached); every statistic identical (72 measured days, median 89.5 %, over 100 % 37.5 %, over 150 % 9.7 %, reached-100 % days 27, of those ended >= 125 % 40.7 %, median 119.8 %, close >= half range from open 38.9 %) |
| MT5 live chart (portable terminal, XAUUSD M15) | day open + projected high/low lines with labels + dashboard with logo: test/mt5_expected_range_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 72 complete days)
Usual range = mean high-low of the previous 14 complete server days (no look-ahead). The median day used 89 % of it; 37.5 % of days went past 100 % and 9.7 % past 150 %. Of the 27 days that reached 100 %, 41 % ended at 125 % or more (median 120 %): reaching the usual range is not a ceiling. Descriptive only: no edge.

## R&D basis
Classic average-daily-range projection (today's low + range = projected high; today's high - range = projected low) re-implemented in own code with a strict no-look-ahead rule and a statistics layer that tests how often the "usual" range really was exceeded.

## Notes / limits
- Days are server-time calendar days (broker day), built from the chart's intraday bars; use an H4 or lower chart. 12-hour windows are not included (daily only).
- Needs 14+ previous complete days of history; the first day in the data is partial and ignored.
- Dashboard, alerts and the corner options were exercised only through the screenshot; alerts not triggered.
