# AT24 Correlation Shift Monitor - test record (2026-11-13, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_CS_SelfTest.mq5` + `test/verify_cs.py`) | XAUUSD (real daily bars, 1,500) matched by calendar day with BTCUSD_T (custom symbol from Binance, 3,000 daily bars; crypto weekends drop out): 1,498 matched days, 1,497 returns; 20-day correlation, 120-day correlation, their difference and the percentile of the 20-day value among its rolling values over the last 750 returns identical to Python; known-answer check (a series against itself gives correlation 1 and change 0) passes |
| MT5 live chart (portable terminal) | pair table with 20d / 120d correlation, change, percentile and status, a missing symbol flagged: test/mt5_correlation_shift_chart.png (only one pair has history in the offline terminal; BTCUSD_T is test data) |
| Alerts (shifted pair) | not fired in the test (the pair was normal); needs a look on a live connected terminal. One alert per pair per daily bar. |
| Load | the rebuild is staged (two pairs per timer call, one cycle per new daily bar) so the indicator does not block the terminal; up to 20 pairs; not stress-tested with 20 pairs on a connected terminal |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
For pairs the user chooses (A:B, symbols exactly as the broker names them): the correlation of daily returns over a short (20) and a long (120) window, the change between them, the percentile of the short value in its own history (750 returns), and a status: normal, AT AN EXTREME (percentile above 95 or below 5), SHIFTED UP / DOWN (change of at least 0.40 by default). Optional alert and push for newly shifted pairs. Descriptive only: it shows that a relationship has changed, not what will happen.

## Notes / limits
- Correlation of daily returns is noisy: with a 20-day window a value can move a lot by chance; the percentile and the long window are there to put it in context. Daily bars are matched by calendar day, so assets with different holidays use the common days only.
- Default pairs use common broker names (XAUUSD, EURUSD, USOIL, US500, BTCUSD, USDJPY); users edit the list to match their broker. Dashboard off in the Strategy Tester by default.
