# AT24 Research Lab - Report 05 (2026-11-11): compression breakouts, round numbers, the "coiled spring"

Script: `py/lab05_coiled_spring_and_levels.py` (pre-registration in the header, written before any result was seen). Raw numbers: `reports/lab05_results.json`.
Data: one broker feed, XAUUSD H1 from 2021-05-05. Family of 3, Bonferroni alpha 0.0167. Periods: train 2021-05..2023-12, validation 2024-01..2025-06, final 2025-07..end.

## Results
| # | Belief tested | train | validation | final | Finding |
|---|---|---|---|---|---|
| S1 | compression breakouts run further than other breakouts (ATR(14)/ATR(100) <= 0.75, 12-bar break, 12-bar hold, net of 0.25 cost) | +0.08 ATR (p 0.80, 249 vs 508) | +0.61 (p 0.089, 102 vs 338) | +0.22 (p 0.57, 59 vs 324) | no |
| S2 | round numbers (multiples of 50) reject price (fade over 4 bars) more than 25-offset control levels | -0.04 ATR (p 0.73) | -0.09 (p 0.40) | -0.01 (p 0.88) | no |
| S3 | a quiet London session coils the spring: NY range bigger than usual afterwards | -0.12 (p 0.032) | -0.14 (p 0.083) | -0.40 (p 0.0001) | no (see below) |

## Reading
- **S1:** compression breakouts are not better than other breakouts in the training period (difference +0.08 ATR, p 0.80). Breakouts in general earned more in 2024-26 (validation and final means are positive for both groups, a trending gold market), which is a market-regime effect, not a compression effect.
- **S2:** no sign that round numbers behave differently from arbitrary levels. Fade returns are about zero at both.
- **S3:** the popular belief has the WRONG SIGN. After a quiet London session the New York range is *smaller* than usual (ratio 0.95-1.08 against 1.20-1.35), in all three periods, strongest in the final one. By the pre-registered rule it is not a finding (the training p of 0.032 is above the 0.0167 threshold), but the direction never flipped; the plain reading is volatility persistence, not a coiled spring.
- Same honest outcome as Labs 01-04: no tradable positive edge.

## Product consequence
Nothing new to build as a signal. S3 supports a descriptive "session volatility persistence" line that could go into an existing dashboard (a quiet London session means a quieter than usual New York session, historically); it is not a product by itself.
