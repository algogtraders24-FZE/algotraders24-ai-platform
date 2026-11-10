# AT24 Research Lab - Report 04 (2026-11-10): when gold is cheap to trade, and the daily break after news

Script: `py/lab04_tradability_and_gaps.py` (pre-registration is in the script header, written before any result was seen). Raw numbers: `reports/lab04_results.json`.
Data: one broker feed, XAUUSD H1 (from the first full hourly day, 2021-05-05), spread statistics from 2025-01-02 (History Doctor: spread field filled >95 % from then), USD calendar. Cross-asset checks were planned as "if available": they are NOT possible offline (the portable terminal holds only XAUUSD), so none were run. Spread unit assumed 1 point = 0.01 price units.

## Results (family of 5, Bonferroni alpha 0.01)
| # | Hypothesis | Result | Finding |
|---|---|---|---|
| A1 | cost (spread / hourly range) differs by New York hour | Kruskal-Wallis p ~ 1e-135 (2025) and ~ 1e-165 (2026) | yes |
| A2 | the ranking of hours by cost is stable between 2025 and 2026 | Spearman rho +0.88 (23 hours), p = 1e-4 | yes |
| B1 | gap at the daily break (NY 16:00 close -> 18:00 open) is bigger on high-impact USD news days | train +0.1 bp (p 0.76), validation +1.1 bp (p 0.095), final +1.2 bp (p 0.44) | no |
| B2 | on news days the gap sign agrees with the day's move | corr -0.06 / -0.04 / -0.05 (p 0.5-0.6) | no |
| B3 | on news days the gap is filled within 6 h more often than on quiet days | 95.8 vs 97.2 % / 94.8 vs 94.7 % / 94.3 vs 100 % (p 0.74 / 1.0 / 0.38) | no |

## What A really says (read this before quoting it)
- The **spread itself is flat**: the median is 0.18-0.19 USD in every hour. The cost/range ratio varies by hour almost only because the **range** varies (the well-known volatility cycle), not because the spread changes. A1/A2 are real but unsurprising: the cheapest hours are the ones where gold moves most.
- Cheapest (cost as a share of the typical hourly range), New York time: **09:00 (0.8 %), 10:00, 08:00, 21:00, 11:00, 20:00**. Most expensive: **16:00 (2.4 %), 00:00, 19:00, 06:00, 14:00**. The ordering is stable across 2025 and 2026.
- This is the typical bar-level spread field of the feed, not a live quote. Real widening at rollover or around releases is only partly visible in bar data; the 17:00 hour does not exist on this feed (daily break). It says nothing about whether a trade in a cheap hour wins, only what a round trip costs relative to how far price usually moves.

## What B says
- The daily-break gap is tiny (mean |gap| 2.4-5.9 bp, rising over the years) and **does not depend on news days** in any period; it does not carry the day's direction and it is closed within six hours about 95 % of the time on both kinds of days (because the gap is small relative to a typical hour).
- Power is limited: "quiet days" (no calendar event at all between NY 08:00 and 16:59) are rare after 2024 (20 and 24 days), so a small news effect cannot be excluded; none was found.
- Overnight behaviour AFTER the break is untested here beyond the six-hour fill; the Forward Ledger R4 covers the Asian session separately.

## Verdict
One descriptive product candidate (a cost-by-hour clock built on the stable ranking), no trading finding. As in Labs 01-03, no positive edge.
