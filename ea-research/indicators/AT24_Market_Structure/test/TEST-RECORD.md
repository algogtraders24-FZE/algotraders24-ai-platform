# AT24 Market Structure - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| MT5 core maths vs independent Python (`mt5/AT24_MS_SelfTest.mq5` + `test/verify_ms.py`, 8,000 XAUUSD M15 bars, swing = 5 bars each side, 20-bar follow-through) | all 364 events identical (break bar, swing bar, level, direction, BOS/CHoCH), final trend identical; statistics identical (161 BOS, 203 CHoCH, BOS kept going 45.6 %, CHoCH 51.2 %, any-bar baseline 48.3 %) |
| MT5 live chart (portable terminal, XAUUSD M15) | BOS / CHoCH lines + open swing levels + dashboard with logo: test/mt5_market_structure_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars)
364 breaks: 161 BOS (with the trend) and 203 CHoCH (against it). 20 bars later price was in the break direction after 45.6 % of BOS and 51.2 % of CHoCH, versus 48.3 % for an ordinary bar. In other words no better than any other bar: structure labels describe, they do not predict. Descriptive only: no edge.

## R&D basis
MQL5 feed 2026-11: market-structure quantification HH/HL (post 4539), ICT model tracker (4574), FVG aligned with confirmed structure (4514). Own code: a pivot is used only k bars after it formed; a break needs a bar close beyond the latest unbroken pivot; a break against the current structure is CHoCH, with it is BOS.

## Notes / limits
- Break = CLOSE beyond the level (wicks do not count); other swing sizes give other events.
- The first break in the history has no prior trend and is labelled BOS.
- Alerts and dashboard corner options were not exercised beyond the screenshot.
