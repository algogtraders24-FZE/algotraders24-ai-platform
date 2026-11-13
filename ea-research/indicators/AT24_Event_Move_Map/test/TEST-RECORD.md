# AT24 Event Move Map - test record (2026-11-13, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Core vs independent Python (`mt5/AT24_EM_SelfTest.mq5` + `test/verify_em.py`) | 40,000 real XAUUSD M15 bars and the terminal's own USD high-importance calendar history (831 releases, 819 measurable): the 60-minute move (open of the release bar to the close of the 4th bar), the window range in basis points and in ATR(14) of the bar before, the baseline window range, and the grouping by release name (37 release types: n, mean absolute move, mean range, mean range versus a normal window, largest range) identical to Python on every release |
| MT5 chart (portable terminal) | upcoming-releases table, the typical reaction next to each, the biggest past reactions, thin-sample marking: test/mt5_event_move_map_chart.png. **Do not use this screenshot for numbers or listing:** the offline terminal's calendar does not keep one consistent time basis (history and upcoming values, and repeat runs, came out one or two hours apart; with a UTC conversion the history aligned and the upcoming times were two hours late, without it the reverse), so the figures in the screenshot are not meaningful. The measurement itself is verified (above); the clock handling needs a connected terminal, where the calendar uses server time (default, `InpCalUtc` off). |
| Live checks | NOT done: upcoming list on a connected terminal, alignment of past releases with the real reaction bars (e.g. the biggest reactions should be the Fed decision, payrolls and CPI), alert before a release (`InpAlertMinutes`). |
| MT4 / TradingView | not built (MT5 calendar API only) |

## What it does
For the chart symbol (M15 bars measured regardless of the chart timeframe) and the chosen calendar currencies (default USD): the size of the move in the 60 minutes after every past high-importance release, grouped by release name: average absolute move, average range (basis points) and the range compared with a normal 60-minute window of the same bars; the same numbers shown next to the releases coming up in the next days; the next release with a countdown and its usual reaction; optional alert N minutes before a release. Window 15 to 120 minutes. Size only, not direction.

## Notes / limits
- Needs the terminal's economic calendar (live terminal); release names come from the terminal language (English assumed). A release type with fewer than 8 past occurrences is a thin sample (shown grey; types with fewer than 3 are hidden).
- History reaches back as far as the terminal keeps M15 bars (about 1.5 years on the test feed) and calendar values, so most release types have 12 to 20 samples.
- Averages of a few releases are noisy; a big average move does not say which way the next one goes. Past reactions do not predict future ones.
- Dashboard off in the Strategy Tester by default.
