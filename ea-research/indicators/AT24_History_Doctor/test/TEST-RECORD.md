# AT24 History Doctor - test record (2026-11-10, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_HD_SelfTest.mq5` + `test/verify_hd.py`, 34,997 real XAUUSD H1 bars) | bars, first hourly day, broken bars, order errors, missing-hour breaks and hours, spread-usable-from index and every per-year row (bars, days, hourly days, zero-spread bars, flat bars) identical |
| Fault injection (same bars, deliberately corrupted copy) | 401 broken bars (invalid OHLC and 400 flat+zero-spread), 1 duplicated timestamp, one extra 6-hour hole: all found, numbers identical to Python |
| MT5 live chart (portable terminal, XAUUSD H1) | verdict, usable-from date, spread coverage, yearly table: test/mt5_history_doctor_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Audits the hourly history your terminal holds for the chart symbol, before you trust any statistic: the first day with real hourly data (20+ bars), per-year bars, hourly days and share of bars with an empty (0) spread field, broken bars (high below low, open/close outside the bar, non-positive prices), time-order errors, and missing hours inside trading weeks. Verdict: CLEAN / PARTLY USABLE / BROKEN BARS FOUND / NO HOURLY HISTORY.

## Real result on one broker feed (XAUUSD, 34,997 H1 bars)
- 2017-2020: two bars per day (not hourly); hourly data usable only from 2021-05-05.
- Spread field is 0 on 97-98 % of bars in 2021-22, 86 % in 2023, 15 % in 2024; >95 % filled from 2025-01-02.
- No broken bars, no order errors; 35 breaks with 220 missing hours in total (inside trading weeks).
- Why it matters: this is the data problem that invalidated our first Research Lab runs (hour-of-day and spread statistics on sparse / zero-spread history).

## Notes / limits
- The audit covers the bars the terminal holds (default last 40,000 H1 bars); it does not know whether prices are "right", only whether the data is complete and internally consistent.
- The spread rule is simple (first year with under 5 % zero-spread bars). Brokers can fill spread with a constant; this tool cannot see that.
- No alerts (descriptive). Dashboard off in the Strategy Tester by default.
