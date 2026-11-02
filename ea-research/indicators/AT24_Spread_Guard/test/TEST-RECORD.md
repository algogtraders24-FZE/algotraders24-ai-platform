# AT24 Spread Guard - test record (2026-11-02)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings |
| MT4 compile (Vantage MetaEditor) | 0 errors, 0 warnings. Same newest-first array bug as Regime Pulse found/fixed in the source; MT4 RUNTIME of Spread Guard not verified (the test read no values; the history spread of that feed may be 0) - needs a manual look on a chart |
| Hourly profile maths vs independent Python (6,000 XAUUSD M15 bars, 20 days) | mean per hour max diff 4e-7, bar counts identical (1,289 bars) |
| Live MT5 chart (terminal A, XAUUSD M15) | dashboard + logo + 24h mini chart + coloured spread histogram + typical-hour line: test/mt5_spread_guard_chart.png |
| TradingView Pine v5 | compiled in the Pine editor, dashboard renders (this hour 16:00 UTC normal cost 1.7%, cheapest 14:00 1.2%, costliest 04:00 2.9% with a 0.30 spread on 1h gold): branding/screenshot_tradingview.jpg. Edition measures bar range per UTC hour (TradingView has no historical spread) |

## Findings and fixes during the audit
1. MT4 has no TimeTradeServer() -> uses TimeCurrent().
2. IMPORTANT data finding: on the IC Markets Raw demo feed, the spread stored on historical bars is flat (17-18 points at every hour), so a history-only hourly profile is not informative. Fix: the indicator now learns the profile from live spread samples (every 2 s, stored in terminal global variables, survives restarts); it switches to the live profile once 12 hours have 20+ samples, and the panel says which source it uses ("LIVE ticks" / "history is FLAT ... learning live"). The mini chart goes grey while the profile is flat, so it never shows a fake pattern.
3. Server-time to GMT uses the current server offset; bars from the other half of a daylight-saving year can be off by one hour.
