# AT24 Strategy Fit - test record (2026-11-18)

## Engine checks
| Check | Result |
|---|---|
| MT5 compile (portable terminal and the owner's Exness terminal) | indicator, core, self test, unit test: 0 errors, 0 warnings |
| Hand-worked unit tests (`AT24_SF_UnitTest.mq5`) | 26 passed, 0 failed: xorshift32 sequence (270369, 67634689), signals on a straight line up / down (trend, breakout, RSI 100 / 0), zig-zag gives no reversion or breakout, cell statistics (all wins = FIT with p near 0, all losses = AVOID with p 1, n 29 = no claim, balanced = neutral, empty cell), trade list on a line (6 trades per rule, average R (24 - 0.5) / 2 = 11.75, reversion short -12.25), `from` limit, too-short history, invalid bar skipped without starting the 24-bar wait, flat market |
| Independent Python (`verify_sf.py`, pandas/numpy + own xorshift32 luck test) on 5 symbols x 20000 H1 bars | 0 signal mismatches, 0 state mismatches, 9,387 trades identical, every cell n and class identical, avg / hit / p max difference 5e-11 |
| No look-ahead (cut-history test in `AT24_SF_SelfTest.mq5`) | EURUSD and XAUUSD, 3 cuts each: 0 differing signals |
| Real chart (MT5, XAUUSD H1, iCustom) | dashboard, rule cards, 3 x 5 grid render; buffers readable: test/mt5_strategy_fit_chart.png; example stats `SF_stats_XAUUSD_example.csv` |

## R&D that decided the design (out of sample)
`rnd_strategy_fit.py`, `rnd_strategy_fit_result.json`: last 40 % of the H1 history of 13 symbols, entry next open, 24-bar hold, ATR units after spread, one trade per rule per 24 bars. Breakout by state: NOISY -0.24 (2 of 13 symbols positive), WIDE SWING +0.03, STRONG MOVE -0.10, COMPRESSED **+0.135 (9 of 13)**, STEADY TREND +0.01. Trend: NOISY -0.30, STRONG MOVE -0.25, others about 0 to -0.13. Reversion: COMPRESSED -0.51 (1 of 13), WIDE SWING -0.34, STRONG MOVE -0.30, STEADY TREND +0.03. The state changes the result of the same rule a lot, consistently across symbols; most cells are around zero or negative after costs.

## Honest limits
- The dashboard measures the chart symbol's own last 20,000 H1 bars. On a symbol with a strong drift (for example gold in an uptrend) long-side rules look good because of that drift. n and the luck test are shown; FIT needs n 30+, average above 0 and p below 0.10; with 15 cells some FIT cells appear by chance.
- Cost = the spread at calculation time for every past trade; swap not included (24-hour hold). H1 only.
- Arrows are live only (drawn when a FIT-class rule signals on the last closed bar while the indicator runs); history never gets arrows because the class is measured with the whole history.
- Not verified live: alerts and push, a forward record, other brokers' symbol names, first calculation time on a 100,000-bar chart (InpMaxBars limits it to 30,000).
- No trade, no signal service, no profit claim.

## Strategy Fit Scanner (2026-11-18)
- New code is only the table, the staging and the sort; every number comes from the verified cores (`AT24_SF_Core.mqh`: 26 unit tests, independent Python identical; `AT24_RA_Range.mqh`: 23 unit tests, independent Python identical).
- Compile: 0 errors, 0 warnings.
- Cross-check on the same bars (offline test terminal, XAUUSD H1 chart, 6 symbols, one has no data): the scanner row of XAUUSD equals the single-symbol Strategy Fit panel read back immediately after: STEADY TREND; trend short NEUTRAL +0.20 R n 166 p 0.22; breakout FIT +0.45 R n 106 p 0.09 (no signal now); reversion NEUTRAL +0.28 R n 139 (identical). The typical 24 h range per symbol equals the Regime AI range self test (EURUSD 0.00574, XAUUSD 89.1, GBPUSD 0.00708 vs 0.00709, USDJPY 0.8695 vs 0.8688, USDCHF 0.00494; the small differences are one newer bar).
- Table behaviour: US30 (not in the terminal) is skipped and counted ("5 of 6 symbols read"); FIT row first (USDCHF trend long +0.82 R n 99), NEUTRAL (XAUUSD), then AVOID by average R (EURUSD -0.22 before GBPUSD -0.32); buffer 0 = 1 FIT signal. 93-140 ms per symbol rebuild.
- Bugs found and fixed while building: header summary overlapped the title; two column headers overlapped.
- Not verified live: alerts and push, other brokers' symbol names, many symbols on a slow machine, forward record.
- The measured trade has no stop (stated on the panel); no claim.
