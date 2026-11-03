# AT24 Trend Pullback Map - test record (2026-11-03)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_Pullback_SelfTest.mq5`, 8,000 XAUUSD M15 bars) | EMA 20/50/200 and ATR max diff 5e-6; trend state 0 mismatches over 8,000 bars; all 438 pullback events identical (bar, direction, outcome, bars to resolve, depth) |
| MT5 live chart (portable terminal, XAUUSD M15) | EMA ribbon, mid-EMA trend colour, pullback arrows, dashboard with logo and statistics: test/mt5_trend_pullback_map_chart.png |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (portable MT4 copy, test EA reading all 8 buffers through iCustom for 400 bars) | 400 bars, 0 mismatches: fast/slow EMA, mid-EMA up/down/range buffers, trend state, and the 19 pullback arrows |
| TradingView Pine v5 | compiled; ribbon, triangles and dashboard render: branding/screenshot_tradingview.jpg |

## Real result on one broker feed (XAUUSD M15, last 8,000 closed bars, 438 resolved touches of the 20 EMA inside a 20/50/200 trend)
Trend resumed (new 20-bar extreme before a close past the 50 EMA, within 20 bars): 39.5%. Failed (close past the 50 EMA first): 55.5%. Neither: 5.0%. Median depth 3.0 ATR, median 4 bars to resolve. TradingView OANDA 1h: resumed 29%, failed 56%, neither 15% (566 touches). Descriptive only: a plain EMA pullback failed more often than it resumed under this definition, which matches our earlier scan (EMA pullback in a trend had no cost-adjusted edge).

## Bugs found / notes
1. MQL4 rejects a loop variable re-declared in the same function (renamed); MQL4 newest-first array order handled by reading through a chronological index.
2. MT4 has an 8-buffer limit: the mid EMA colour is done with three buffers (up / down / range) instead of a colour-index buffer, and the zone state is shown only on the dashboard.
3. Pine: a `for i = a to b` loop over an empty array runs once (guarded); an open-event array is resolved bar by bar.

## Limits
- The statistics depend on the definition of "resumed" and "failed" (stated on the dashboard); other definitions give other numbers.
- MT4/MT5 analyse the last N closed bars (default 8,000); TradingView uses all loaded bars, so counts differ by timeframe and history.
- Alerts were not exercised beyond a screenshot; the dashboard zone state uses the last closed bar.
