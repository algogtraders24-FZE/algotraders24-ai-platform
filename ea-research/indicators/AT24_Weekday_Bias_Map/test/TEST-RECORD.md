# AT24 Weekday Bias Map - test record (2026-11-09, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_WD_SelfTest.mq5` + `test/verify_wd.py`, 953 XAUUSD D1 candles, 2023-02-23 to 2026-11-03) | weekday of every candle matches Python `datetime`; per-weekday count, mean (bp), t-statistic, % up, first-half and second-half means, std identical; significance counts, half-to-half correlation and same-sign count identical |
| MT5 live chart (portable terminal, XAUUSD H1 chart, 2,653 D1 candles) | histogram of mean daily return per weekday, current weekday highlighted, t-stats and chance line: test/mt5_weekday_bias_map_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed
- Self-test (953 candles, about 190 per weekday): mean daily return Monday +8.1 bp (t 0.97), Tuesday +7.2 (0.82), Wednesday +7.2 (0.83), Thursday +10.1 (1.21), Friday +7.1 (0.69). No weekday reaches |t| = 1.96 (chance alone gives about 0.25 of 5 weekdays). All five are positive because gold rose strongly in 2023-2026.
- Persistence: only 1 of 5 weekdays has the same sign in both halves and overall; the correlation between first-half and second-half weekday means is -0.98 over just five points (a weekday that looked best in the first half looked worst in the second). With five points this number is extremely unstable and is shown only as a warning, not a finding.
- The indicator's own run on the full 2,653 candles in the test terminal gives the same picture (no weekday |t| above 1.6). Descriptive only: no weekday effect.

## Notes / limits
- Weekday = the broker's server day of the daily candle (Equiti: Monday candle = Monday server day). Sunday/Saturday candles (if any) are ignored; only weekdays with at least 30 candles are evaluated.
- The indicator needs the symbol's D1 history (it retries until the terminal has built it; the first display can take a few seconds to a minute).
- Alerts: none (descriptive map).
