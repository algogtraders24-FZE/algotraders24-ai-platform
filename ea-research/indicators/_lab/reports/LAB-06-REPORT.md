# AT24 Research Lab - Report 06 (2026-11-11): turn of the month, data surprises, the weekend gap

Script: `py/lab06_calendar_and_surprises.py` (pre-registration in the header, written before any result was seen). Raw numbers: `reports/lab06_results.json`.
Data: one broker feed, XAUUSD D1 from 2017-10, H1 from 2021-05-05, USD calendar from 2023. Family of 3, Bonferroni alpha 0.0167.

## Results
| # | Belief tested | train | validation | final | Finding |
|---|---|---|---|---|---|
| T1 | turn of the month (last + first 3 trading days) beats other days | +10.3 bp/day (p 0.079; 203 vs 1,170 days) | +4.1 (p 0.65) | +11.5 (p 0.44) | no |
| T2 | a hawkish data surprise hurts gold (Spearman, surprise z vs 2-hour reaction, 10 releases) | -0.11 (p 0.29, n 102) | -0.21 (p 0.011, n 151) | -0.26 (p 0.0044, n 113) | no (see below) |
| T3 | the weekend gap is faded (Monday bar after a Friday bar) | not testable (n 0) | -11.2 bp (p 0.15, n 96) | -17.8 bp (p 0.15, n 120) | no |

## Reading
- **T1:** turn days average more than other days in all three periods (same sign), but the difference is never significant. Not a finding.
- **T2:** the sign is negative in all three periods and gets stronger and significant in the last two (p 0.011 and 0.0044), but the pre-registered rule requires the training period to pass at 0.0167, and it does not (p 0.29). Plain reading: gold has reacted against hawkish surprises in 2024-26; this is **not established** as a stable relationship, and it is only a 2-hour descriptive reaction, not a trading rule (no costs, slippage at the release or direction rule tested). It is a candidate for the Forward Ledger (a surprise-direction rule registered with a later date), not a finding.
- **T3:** by the pre-registered definition the training period cannot be tested: this broker stored a Sunday D1 bar until mid-2022, so no Monday bar follows a Friday bar there. In validation and final the "fade" return is negative (the gap tends to continue, -11 and -18 bp, not significant). A post-hoc variant (first bar after the weekend, whatever its weekday) is reported in the JSON as `T3x_posthoc` and is NOT counted: -1.8 / -7.9 / -17.8 bp, p 0.74 / 0.19 / 0.14. Nothing there.
- Same honest outcome as Labs 01-05: no established tradable edge. One recent-regime candidate (T2).

## Next
If a surprise rule is wanted, register it in the Forward Ledger with a later date (sign of the surprise of the high-impact release, hold 2 hours) and let it earn a verdict out of sample; do not describe T2 as an edge.
