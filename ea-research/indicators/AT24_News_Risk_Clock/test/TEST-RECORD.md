# AT24 News Risk Clock - test record (2026-11-04, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot scripts) |
| Calendar access | MT5 built-in economic calendar (`CalendarValueHistory`) returns events inside the portable test terminal (1,210 USD events over 88 days, 159 high impact) - no WebRequest needed, so it works as a plain indicator |
| MT5 core maths vs independent Python (`mt5/AT24_NW_SelfTest.mq5` + `test/verify_nw.py`, 8,000 XAUUSD M15 bars, 30-min window = 2 bars, quiet-day exclusion +-60 min) | all 159 per-event ratios identical; every statistic identical (median event range 21.09, median quiet-day range at the same clock time 13.50, median ratio 1.412, >= 1.5x 47.2 %, >= 2x 34.0 %, quieter than usual 23.9 %, 8,708 control windows) |
| Indicator vs self-test | the indicator on a chart (85 days, 163 events) shows 1.43x / 48 % / 38 % / 23 %, consistent with the self-test (different start date) |
| MT5 live chart (portable terminal, XAUUSD M15) | countdown + next events + statistics + event lines: test/mt5_news_risk_clock_chart.png; RISK WINDOW state verified with widened windows: test/mt5_news_risk_clock_riskwindow.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## Real result on one broker feed (XAUUSD M15, 159 high-impact USD releases)
In the 30 minutes after a high-impact USD release the high-low range was a median 1.41x the range at the same clock time on days without news; 47 % of releases gave at least 1.5x and 34 % at least 2x, while 24 % were quieter than a normal quiet-day window. This is the SIZE of the move, not its direction: no edge, but a real volatility effect worth knowing before you hold a position through news.

## R&D basis
Uses MetaTrader's own economic calendar API (documented, no web requests). Statistic is own code: event window range divided by the median range of the same clock window on quiet days (no other event within +-60 min), so time-of-day effects are removed.

## Notes / limits
- Needs a live terminal (the calendar does not exist in the Strategy Tester; the indicator says so). Calendar data come from MetaQuotes via the terminal and can be late or revised; check important events yourself.
- Event times are in the chart's broker server clock. When the terminal is not connected to the broker (as in our test terminal) set "Clock of the calendar times" to the terminal clock option so events line up with the bars (done in the screenshots).
- Dashboard states CLEAR / NEWS SOON / RISK WINDOW were exercised (CLEAR and RISK WINDOW on screen); JUST RELEASED was not captured. Alerts not triggered.
