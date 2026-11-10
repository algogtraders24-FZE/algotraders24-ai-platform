# AT24 Cost Clock - test record (2026-11-10, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_CC_SelfTest.mq5` + `test/verify_cc.py`, 34,997 XAUUSD H1 bars, last 365 days) | for all 24 New York hours: bar count, median spread, median hourly range, median cost/range and the cheapest-to-costliest rank identical (24 of 24); New York hour identical to Python `zoneinfo` on all 34,997 bars |
| Filters | bars with an empty (0) spread field or zero range are skipped; an hour needs 20+ bars; fewer than 8 usable hours shows "SPREAD FIELD EMPTY IN THIS HISTORY" |
| Clock | DST-aware detection with the FX-pair fallback and manual override (inputs) |
| MT5 live chart (portable terminal, XAUUSD H1) | current hour verdict, 24-hour strip, cheapest / costliest hours: test/mt5_cost_clock_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
For each New York hour: the typical (median) spread, the typical (median) hourly range and their ratio, the cost/range, over the last N calendar days (default 365). The current hour is rated CHEAP / AVERAGE / COSTLY by thirds of the available hours; a 24-hour strip and the lists of cheapest and costliest hours are shown.

## Real result on one broker feed (XAUUSD, last 365 days)
Cheapest: NY 09:00 (0.61 % of the typical hour range), 10:00, 08:00, 21:00, 11:00. Costliest: 16:00 (1.78 %), 23:00, 00:00, 05:00. The spread itself is flat (0.17-0.18 USD in every hour); the ranking comes almost entirely from the volatility cycle. Research Lab 04 found the ranking stable between 2025 and 2026 (Spearman +0.88).

## Notes / limits
- Bar-level spread field of the feed, not a live quote: real widening at rollover or around releases is only partly visible. The NY 17:00 hour does not exist on this feed (daily break).
- A cheap hour is not a good trade: it only costs less relative to how far price usually moves. No profit claims.
- Needs a history with a filled spread field (see AT24 History Doctor); not usable on feeds where spread is always 0.
- Dashboard off in the Strategy Tester by default.
