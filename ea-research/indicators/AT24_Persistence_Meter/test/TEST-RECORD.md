# AT24 Persistence Meter - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core maths vs independent Python (`mt5/AT24_PR_SelfTest.mq5` + `test/verify_pr.py`, 8,000 XAUUSD M15 bars, 400-bar window) | Lo-MacKinlay variance ratio VR(q), z-statistic and the Hurst-style exponent identical on 90 spot checks (30 bars x q = 4, 8, 16); the current readings identical; the full study (samples and same-direction % for all / trending / reverting / random) identical for all three q |
| MT5 live chart (portable terminal, XAUUSD M15) | state, three variance ratios, study with sample sizes and 95 % intervals: test/mt5_persistence_meter_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 236 non-overlapping 32-bar windows, q = 8)
The test says "moves tend to continue" (VR > 1, z >= 1.645) in only 3 % of windows (8 windows), "tend to reverse" in 17 % (40) and "random walk" in 80 %. The next 32-bar move went the same way as the previous one 55 % of the time overall (+-6 points). When the meter said "continue" it was 62 % but on 8 windows (+-34 points); when it said "reverse" it was 50 % on 40 windows (+-15). Neither differs from the overall 55 % beyond noise: on this sample the reading did not demonstrably predict the next move. (q = 4 and q = 16 give the same picture: 54.5 % / 70 % on 11 / 10 trending windows.) Descriptive only: no edge.

## R&D basis
MQL5 feed 2026-11: stationarity / unit-root and mean-reversion diagnostics (Stationarity.mqh, code 78807), Hurst exponent trending in the catalogue. Own code: variance-ratio test (Lo-MacKinlay 1988, homoskedastic z) over a rolling window, plus our own out-of-sample style study of the same-direction rate with confidence intervals.

## Notes / limits
- Homoskedastic z can over-reject when volatility changes (it does on most markets); read "continue / reverse" as a hint of the sign of serial correlation, not as a proof.
- Trending windows are rare on this symbol/period, so the study has few samples; the dashboard always shows n and a 95 % interval.
- Windows are non-overlapping (stride = horizon) to keep samples independent. Results change with window, q and horizon.
- Alerts not exercised beyond a compile.
