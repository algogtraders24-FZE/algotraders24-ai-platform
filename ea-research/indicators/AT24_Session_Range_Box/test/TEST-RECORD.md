# AT24 Session Range Box - test record (2026-11-03)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_SessionBox_SelfTest.mq5`, 12,000 XAUUSD M15 bars, 60 GMT days) | 43 days compared (box high/low, first-break side, excursion, held flag): 0 mismatches; statistics identical (valid days 42, up 40.476%, down 52.381%) |
| MT5 live chart (portable terminal, XAUUSD M15) | boxes, dotted extension boxes coloured by state, dashboard with logo and statistics: test/mt5_session_range_box_chart.png |
| Broker clock check | server GMT offset detected = +7200 s, matches TimeTradeServer - TimeGMT |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (portable MT4 copy, XAUUSD M15 history, test EA reading the buffers through iCustom) | today's box high/low, break state and size-vs-median ratio match the independent Python calculation (hi 4207.33, lo 4135.56, ratio 1.619) |
| TradingView Pine v5 | compiled in the Pine editor; boxes + dashboard render; stats on OANDA XAUUSD 1h: up 40% / down 48% / none 12%, held 60%, ran 1x 36% (60 days): branding/screenshot_tradingview.jpg |

## Real result on one broker feed (XAUUSD M15, last 60 GMT days, Asia 00:00-07:00 GMT, watching to 21:00)
First break up 40.5%, down 52.4%, none 7.1%. When it broke: held to day end 51.3% (about a coin flip), ran at least 1x the box size 33.3%. Median box 41.08. Descriptive only: it does not show an edge, which matches our earlier scan of 25 entry rules.

## Bugs found and fixed
1. TradingView runtime error: with zero finished days the Pine loop `for i = 0 to n - 1` still ran once (Pine counts downward) and read an empty array. Guarded.
2. MQL4 newest-first array order handled with chronological copies (lesson from indicator #1).
3. Test mistake (not code): a first MT4 "pass" read 0 bars because the history was not loaded yet; discarded and re-run after waiting for history.
4. Test mistake on TradingView: my first paste hit the chart instead of the editor and created a text drawing; it was deleted and the chart restored.

## Limits (be honest in marketing)
- Server-to-GMT conversion uses the current offset; days from the other side of a daylight-saving change can be one hour off.
- Statistics depend on the broker's history and chosen hours; MT4/MT5 use closed bars only (no repaint).
- Alerts and the live dashboard clock were not exercised on a live running chart beyond the screenshot.
