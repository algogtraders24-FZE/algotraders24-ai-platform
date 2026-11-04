# AT24 NY Opening Range - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Clock / New York conversion (`test/verify_nyor.py`, 8,000 XAUUSD M15 bars across both DST changes) | server -> GMT -> New York local time identical to Python `zoneinfo` America/New_York for all 8,000 bars (Equiti: base GMT+2, US rule detected) |
| MT5 core maths vs independent Python (`mt5/AT24_NYOR_SelfTest.mq5`, 09:30-10:00 range, window to 16:00 New York, 4-bar false-break test) | all 106 days identical (range bars, high/low, break bar and direction, held/fell-back/ran flags); every statistic identical for the main window and for the 11:00 control window |
| MT5 live chart (portable terminal, XAUUSD M15) | opening-range boxes coloured by outcome + extension lines + dashboard with logo, clock state and control comparison: test/mt5_ny_opening_range_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 87 complete days)
Of 87 days the 09:30-10:00 New York range broke up on 44 % and down on 56 % (every day broke at some point before 16:00). The break was still beyond the range at 16:00 on 54 % of days, 56 % of breaks closed back inside within 4 bars, and 51 % ran one box-height. The 11:00-11:30 control window gave: held 59 %, fell back 56 %, ran 53 %. The opening range behaves like any other 30-minute window: no edge, and a coin flip on direction.

## R&D basis
Opening-range breakout concept (MQL5 feed ORB items, e.g. the EA Code Base entries on opening-range breakouts); own code; session time handled with the DST-aware server clock (AT24_ServerClock.mqh) and an explicit New York offset rule, tested against `zoneinfo`.

## Notes / limits
- New York wall-clock times (09:30 ET) are used, so the window moves against the broker clock twice a year; the dashboard shows the detected clock rule. If detection fails it falls back to the constant broker offset.
- Break = bar CLOSE beyond the box (+ optional buffer). Statistics use closed bars only.
- Alerts and dashboard corner options were not exercised beyond the screenshot.
