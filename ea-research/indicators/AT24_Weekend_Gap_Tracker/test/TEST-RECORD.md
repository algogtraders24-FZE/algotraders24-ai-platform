# AT24 Weekend Gap Tracker - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_WG_SelfTest.mq5` + `test/verify_wg.py`, 20,000 XAUUSD H1 bars, gap = more than 12 h without bars, minimum 0.1 ATR) | all 137 gaps identical (reopening bar, Friday close, open, size, ATR, bar where the gap was filled, bar where the mirrored control level was reached); every statistic identical |
| MT5 live chart (portable terminal, XAUUSD H1) | the latest gap (Friday close 3,875.68 -> open 3,885.88, +10.20 = 0.57 ATR, not filled) drawn as a zone with the Friday-close line, dashboard with logo and statistics: test/mt5_weekend_gap_tracker_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD H1, 20,000 bars, 136 gaps with a full 5-day follow-up)
Gaps were small (median 0.39 ATR), 43 % up. Price came back to Friday's close within 1 / 4 / 24 / 120 hours in 51 / 66 / 82 / 90 % of cases. The control level (the same distance on the other side of the open) was reached in 54 / 74 / 87 / 92 %: **a weekend gap "fills" no more often than any level the same distance away** (in fact slightly less often than the mirrored one). The indicator's own 900-day run (150 gaps) shows the same picture (53 / 67 / 82 / 90 % vs 52 / 71 / 85 / 92 %). Descriptive only: no edge.

## Notes / limits
- A "gap" is any break of more than 12 hours between hourly bars (weekends, and holidays with a long closure); gaps below 0.1 ATR (H1) are ignored. Other thresholds change counts.
- Fill = a bar's range reaches the old close; control = the level mirrored through the reopening price. Fill windows count bars (hours) from the reopening bar.
- The latest gap is evaluated on closed H1 bars; the indicator rebuilds once per hour (and retries every few seconds until the H1 history is available). Alert (gap filled) not exercised beyond a compile.
