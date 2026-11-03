# AT24 Round Levels - test record (2026-11-03)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_Round_SelfTest.mq5`, 8,000 XAUUSD M15 bars, steps 10/50/100, real and control levels) | ATR 5e-6; all 6 scans (events, bounce, break, neither) identical: step 10 real 2386/1186/1148/52 vs control 2372/1190/1139/43; step 50 real 471/226/237/8 vs control 494/245/237/12; step 100 real 222/109/110/3 vs control 249/117/127/5 |
| MT5 live chart (portable terminal, XAUUSD M15) | round-number grid, nearest levels, statistics table with logo: test/mt5_round_levels_chart.png |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (portable MT4 copy, test EA runs the indicator with its dashboard on and reads the level buffers and statistic labels) | statistics identical to the independent Python scan (n=2750 / 517 / 255 with the same bounce and break percentages, real and control); nearest levels correct |
| TradingView Pine v5 | written, **NOT compiled or tested** (Claude in Chrome was disconnected). Must be pasted into the Pine editor and checked before release |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars)
Bounce rate at round levels vs control levels half a step away: step 10: 49.7% vs 50.2%; step 50: 48.0% vs 49.6%; step 100: 49.1% vs 47.0%. Break-through rates are equally alike. So price did NOT react differently at $10/$50/$100 round numbers than at arbitrary levels. Descriptive only; this matches our earlier scan ("$50 round-number rejection" had no edge).

## Bugs found and fixed
1. MT4 cuts object-label text at 63 characters: the first MT4 run lost the closing ")" of a statistics line. Statistic and note labels were shortened. A static audit of all MT4 dashboards found three more over-long lines, now shortened: Liquidity Levels ("After a sweep" line), Session Range Box (hours note), Round Levels (bounce note). The merged files for Liquidity Levels and Session Range Box are fixed in this PR.
2. Number formats made compact (price digits adapt to the symbol; steps without trailing zeros).
3. MQL4 newest-first array order: read through a chronological index.

## Limits
- The reaction definition (1 ATR away before 1 ATR through, within 20 bars) is one of many; other definitions give other numbers. Default steps suit Gold; set them for other symbols.
- Control levels are one choice of "random" levels (half a step away).
- Alerts were not exercised beyond a screenshot.
