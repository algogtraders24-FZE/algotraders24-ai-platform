# AT24 Effect Tracker - test record (2026-11-10, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_ET_SelfTest.mq5` + `test/verify_et.py`, 33,037 valid XAUUSD H1 bars, 250-day windows) | for all 24 New York hours: bars, mean (bp) and t-statistic in the recent and the previous window, status (alive / newborn / died / none), CUSUM change point (index, bar, mean before and after, statistic) identical; counts of significant / alive / newborn / died hours identical; New York hour identical to Python `zoneinfo` on all 33,037 bars |
| History guard / clock | days with fewer than 20 hourly bars are skipped; clock = DST-aware detection with the FX-pair fallback and manual override (inputs) |
| MT5 live chart (portable terminal, XAUUSD H1) | status summary, the hours that changed status with their change points: test/mt5_effect_tracker_chart.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
For each New York hour: mean hourly return and t-statistic over the last N trading days (default 250) and over the N days before that; status ALIVE (significant in both windows, same sign), NEWBORN (significant now, not before), DIED (significant before, not now), else none; and the most likely change point of that hour's mean over the last three windows (single change point by CUSUM, shown when clear). It also counts how many of the 24 hours are significant against the ~1.1 expected by chance.

## Real result on one broker feed (XAUUSD, 250-day windows ending 2026-11)
- 1 of 24 hours significant now (chance ~1.1): NY 05:00, NEWBORN (-2.9 bp per hour, t -2.2; previous year -0.6 bp, t -0.3).
- Two hours DIED: **NY 18:00** (the first hour after the daily break, the "reopening premium" candidate from the Research Lab): previous year +8.2 bp (t +2.9), last year +1.8 bp (t +0.9); the average changed around 2026-05-26 from +4.8 to -1.6 bp. NY 23:00: previous +2.9 bp (t +2.3), now -0.3 bp.
- Consistent with the Forward Ledger replay (NY 18:00 rule -1.0 bp over the last four months): the only candidate effect found in the research has faded. Hour effects here are mortal.

## Notes / limits
- A significance rule on 24 hours will always flag about one hour by chance; the dashboard shows the expected count. "Alive" means significant in two consecutive windows; it is not a trading claim and it does not predict the next window.
- A change point is the most likely single break of the average (CUSUM); a clear break statistic is required before a date is shown. It is an estimate, not proof.
- Costs, bid-series effects and the first-tick spread are not part of the statistic (see the research report).
- No alerts (descriptive). Dashboard off in the Strategy Tester by default.
