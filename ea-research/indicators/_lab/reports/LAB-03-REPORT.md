# AT24 Research Lab - Report 03 (2026-11-10): session sweeps, breakout entries, session relay, extreme timing

XAUUSD H1 from the first full-coverage day (2021-05) to 2026-11, Equiti server feed (data audit: see Report 01-02). Inspired by what the MQL5 community published in Oct/Nov 2026: self-grading sweep scorecards, Donchian breakout "exit labs", session killzones. Code: `py/lab03_sessions_and_exits.py` (pre-registered), `py/lab03b_sweep_followup.py` (exploratory follow-up). Results: `reports/lab03_results.json`, `reports/lab03b_results.json`.

Pre-registration, periods and rule were written in the script header before results were seen: TRAIN 2021-05..2022-12, VALIDATION 2023-01..2024-12, FINAL 2025-01..2026-11; Bonferroni 0.0083 over 6 tests; a FINDING needs p < 0.0083 in the train period, the same sign with p < 0.05 in validation and the same sign in the final period.

## Results (6 tests)
| # | Test | Train | Validation | Final | Result |
|---|---|---|---|---|---|
| **S1** | Asian-range sweep REVERSAL (stop at the sweep extreme, 1R target, 0.25 USD cost) | **-0.32 R** per trade (n = 324, t = -5.95) | **-0.25 R** (n = 345, t = -4.7) | **-0.13 R** (n = 285, t = -2.3) | **FINDING - NEGATIVE: the setup loses money in all three periods** |
| B1 | Donchian-20 breakout entries (EMA200 filter, 2 ATR stop, 2R target, H4) versus random entries with the same exits | -0.34 R vs random (p = 0.018) | -0.08 R (p = 0.42) | +0.11 R (p = 0.22) | no |
| R1a | session relay Asia -> London | corr +0.07 (p = 0.15) | -0.00 (p = 0.92) | -0.11 (p = 0.022) | no |
| R1b | London -> New York | -0.01 | -0.00 | -0.04 | no |
| R1c | New York -> next Asia | -0.03 | +0.00 | +0.12 (p = 0.008) | no (only the final period) |
| X1 | the day's highest and lowest hourly closes occur in the first half of the trading day as often as a shuffled day predicts | 40.2 % vs 44.0 % (p = 0.001) | 39.2 % vs 43.7 % (p = 0.001) | 43.6 % vs 44.0 % (p = 0.60) | no (train and validation say "extremes come later than random", the final period does not) |

## S1 in detail (the one finding)
- 954 sweeps. Net result per trade: reversal -0.24 R (hit rate 42 %). Typical R is only about 3.8 USD, so a 0.25 USD cost is already 0.07 R.
- Exploratory follow-up (same events, not pre-registered): the mirror trade (CONTINUATION in the sweep direction with the same distance) earns -0.12 R, and a random-direction trade of the same size earns -0.16 R. So about -0.15 R of the loss is the mechanics of the structure (costs, stop wins a same-bar tie, time exit); the reversal is a further **-0.08 R worse than random** (paired t = -2.04, p = 0.04), the continuation is +0.03 R better than random (p = 0.47, not different).
- By year the reversal result improves but stays negative: 2021 -0.30, 2022 -0.33, 2023 -0.28, 2024 -0.22, 2025 -0.13, 2026 -0.14.
- Conclusion for traders: on gold H1 the popular "Asian range sweep, then trade the reversal" does not make money on this definition; "going with the sweep" is not a profitable alternative either. Both directions lose to costs on a typical 3.8 USD risk.
- Limits: definition-specific (Asia = GMT 00-07, sweep window GMT 07-13, close back inside required, 1R target, GMT 16:00 time exit, fixed 0.25 USD cost); other targets, stops and filters were not tested. The hit rate and R depend strongly on the stop being at the sweep extreme.

## What it means
1. A self-grading "sweep scorecard" built honestly would show NEGATIVE net R on gold. That is a more useful product than one that shows hindsight-picked winners: it tells the user what the setup really paid.
2. Session relay (Asia -> London -> New York -> Asia) shows no predictability that survives three periods; the NY -> next-Asia correlation of +0.12 appears only in 2025-26 and is a candidate for the Forward Ledger, not a finding.
3. The day's extremes form LATER than a random order of the same hourly moves would put them in 2021-24 (the classic "trend days" signature) but not in 2025-26: another effect with a changing sign over time.
4. Breakout entries are no better than random entries in a bull-market filter (EMA200): gold's drift, not the Donchian trigger, supplied the returns.

## Next steps
- Build the honest **AT24 Sweep Scorecard** (engine verified against this Python): grades every sweep in R with costs, shows reversal vs continuation vs random, and does not hide losers.
- Register the NY -> next-Asia relay as rule R4 in the Forward Ledger (later registration date).
- Next research (Lab 04): spread/slippage-aware "tradability map" by hour, overnight-gap behaviour after high-impact news, and cross-asset checks as soon as other symbols' history is available.
