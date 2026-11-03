# AT24 Liquidity Levels - test record (2026-11-03)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT5 core maths vs independent Python (`mt5/AT24_Levels_SelfTest.mq5`, 20,000 XAUUSD M15 bars: 55 days + 22 weeks + 12 months) | 89 periods compared (period high/low/close, previous-period levels, sweep and close-beyond flags, outcomes): 0 mismatches |
| MT5 live chart (portable terminal, XAUUSD M15) | PDH/PDL/PWH/PWL/PMH/PML rays with state labels + dashboard with logo and sweep statistics: test/mt5_liquidity_levels_chart.png |
| MT4 compile | 0 errors, 0 warnings |
| MT4 runtime (portable MT4 copy, test EA reading the 6 level buffers through iCustom) | all six levels equal the independent Python values (PDH 4145.97, PDL 4105.15, PWH 4266.10, PWL 4103.67, PMH 4510.76, PML 4108.33) |
| TradingView Pine v5 | compiled; rays + dashboard render; values within a few points of MT5 (different feed and daily boundary): branding/screenshot_tradingview.jpg |

## Real result on one broker feed (XAUUSD M15, last 60 GMT days, 53 days with a previous-day level)
PDH swept 41.5%, PDL swept 56.6%, either 77.4%, both 20.8%. After a sweep: day closed back inside 57.7%, accepted beyond 42.3% (52 sweeps, so wide uncertainty). TradingView OANDA daily: PDH 43%, PDL 60%, either 90%, back inside 58%. Descriptive only; this is not an edge.

## Bugs found and fixed
1. Self-test found a real bug: the first period of the analysis window could start mid-period, so its partial high/low became the next period's levels. The window now always starts on a period boundary (0 mismatches afterwards).
2. TradingView lines drew vertical (second point only 1 ms after the first); now one day apart.
3. Pine functions must sit at global scope (moved out of the `if`).
4. MQL4 newest-first arrays handled with chronological copies. MT4/MT5 now require M5-H4 charts (M1 would copy too many bars).

## Limits
- The TradingView daily/weekly/monthly boundaries follow the symbol's exchange session (OANDA: 17:00 New York) while MT4/MT5 use GMT days; numbers differ slightly.
- Server-to-GMT uses the current offset (daylight-saving days can be one hour off). Alerts and live ticking of states were not exercised beyond a screenshot.
