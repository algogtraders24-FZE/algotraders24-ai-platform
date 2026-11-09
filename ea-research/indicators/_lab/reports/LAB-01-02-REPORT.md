# AT24 Research Lab - Reports 01 and 02 (2026-11-09/10)

Symbol XAUUSD, Equiti server feed. Fourteen pre-registered hypotheses (nine textbook, five original) plus one meta-question. Code: `py/lab01_preregistered.py`, `py/lab02_original.py`. Machine results: `reports/lab01_results.json`, `reports/lab02_results.json`.

## 0. Data audit (a result in itself)
Found after a first run (which is superseded): the broker's H1 history is **not hourly before 2021-04** (two bars per day, New York hours 15 and 17) and the bar **spread field is 0 until 2023** (trustworthy from 2024). Every H1 study therefore starts at the first full-coverage day (2021-05); daily studies use D1, which is complete since 2017. Consequence for our products: Hour Bias Map and Weekend Gap Tracker default to 900 days (safe); a user who raises the history to 3,000 days on this broker would feed them sparse data (a guard is added in a follow-up).

## 1. Lab 01 - nine textbook hypotheses: no finding
Decision rule (fixed in advance): Bonferroni p < 0.0056 on the train period AND same sign with p < 0.05 on the holdout (2023+).

| # | Hypothesis | Train | Holdout | Result |
|---|---|---|---|---|
| H1 | an hour-of-day drift exists (max-abs-t permutation) | best hour NY 06, p = 0.36 | NY 06 flips sign | no |
| H2 | net of spread | only if H1 held | - | n/a |
| H3 | intraday momentum: NY hour 8 predicts NY hour 15 | corr +0.163, **p = 0.001** (417 days) | corr -0.002, p = 0.95 (961 days) | **no: significant in-sample, gone out-of-sample** |
| H4 | 2 h pre-event drift before high-impact USD news | 1,923 events: -0.09 bp vs control, p = 0.94 | (calendar only 2023+) | no |
| H5 | event-hour move predicts the next 3 h | 50.3 % same direction, p = 0.81 | | no |
| H6 | after a >= 2.5 ATR hour, the next 4 h continue | 43.4 % vs 50.0 % expected (n = 122), p = 0.15 | 44.6 % (n = 222), p = 0.12 | no (weak lean to reversal, not significant) |
| H7 | high-volatility regime changes the drift | p = 0.90 | p = 0.15 | no |
| H8 | turn of the month | +4.8 bp, p = 0.49 | +6.3 bp, p = 0.49 | no |
| H9 | weekend-gap direction predicts the next 4 h | 44 % (n = 59) | 53 % (n = 156) | no |

Lesson (H3): a textbook effect with p = 0.001 in the training years evaporated in the holdout. Without the holdout we would have published it.

## 2. Lab 02 - five original hypotheses and one meta-question: no pre-registered finding, one candidate
Periods: daily tests train 2017-21 / validation 2022-24 / final 2025-26; intraday 2021-04..22 / 2023-24 / 2025-26; spread test 2024-01..2025-03 / 2025-04..12 / 2026. Bonferroni 0.01.

| # | Original hypothesis | Train | Validation | Final | Result |
|---|---|---|---|---|---|
| O1 | a wider-than-usual spread (for that hour) predicts a bigger range in the NEXT hour | corr +0.14, **p = 0.005** | corr -0.10, p = 0.65 | +0.05, p = 0.58 | **no: significant in-sample, sign flips** |
| O2 | time-series momentum: trailing 63-day sign predicts the next 21 days | diff -0.5 pp, p = 0.66 | +1.8 pp, p = 0.20 | +2.4 pp, p = 0.56 | no (22-49 samples per period) |
| O3 | scale alignment: last 1 h / 4 h / 24 h / 120 h all agree -> next 24 h continues | 50.5 % vs 50.0 % | 54.9 % vs 50.4 %, p = 0.08 | 47.8 % vs 50.8 % | no |
| O4 | stretch: range already 100 % of expected by 12:00 NY changes the rest of the day | p = 0.61 | p = 0.54 | p = 0.40 | no |
| O5 | the first hour after the daily break (NY 18:00) has a positive drift | +0.5 bp, p = 0.64 | **+3.1 bp, t = 4.9** | **+4.7 bp, t = 3.3, p = 0.001** | **no by the rule (train fails) - but see below** |

### The one candidate: the NY 18:00 "reopening premium"
- By year (mean per hour, t): 2021 -0.4 bp (-0.1), 2022 +1.2 (1.9), 2023 +4.6 (4.2), 2024 +1.7 (2.6), 2025 +4.9 (3.6), 2026 +4.5 (1.7). It is **not there in 2021-22 and appears from 2023**; up in 57-65 % of days since.
- Where it lives (M15, 2025-26): +2.3 bp in the first 15 minutes, +1.0, +1.3, +0.5 in the rest of the hour; bar spread about 15-19 points (0.4 bp), not unusually wide.
- Since 2024, net of the recorded bar spread: +3.2 bp per trade (t = 3.3).
- Why it is NOT a trading claim: (1) it fails the pre-registered rule (absent in the train period); (2) the candle series is BID-based: right after the reopening the spread is widest and the bid is lowest, so a bid-series "drift" can come from the spread narrowing, which a buyer paying the ask never earns; the bar-level spread field cannot show the spread at the very first tick; (3) the effect has a birth date (2023): effects are mortal. Verdict: **candidate, needs tick-level data and a forward test.**

### Meta-question M1: do the best hours persist?
For each 12-month window (step 3 months, 17 windows) we took the New York hour with the largest |t| and checked the next 6 months: the sign persisted in **14 of 17 windows (82 %)** and kept about 84 % of its size (mean +2.8 bp after the window vs 3.3 bp inside it). The windows overlap heavily (binomial p = 0.013 is optimistic), and the persistence is mostly the single hour NY 18:00 recurring in 11 of the 17 windows; the earlier "best hours" (NY 06, NY 16) did not persist reliably.

## 3. What this means (honest)
1. Fourteen hypotheses, no finding by our own rule. Two (H3 intraday momentum, O1 spread-predicts-range) looked highly significant in the training years and failed out-of-sample: the single most important thing a trader can learn about "edges".
2. One candidate (NY 18:00 reopening drift) is consistently positive since 2023 on this feed, but unconfirmed and possibly a bid-series/spread artifact. The right next step is a forward ledger (no hindsight) and tick data.
3. Effects have birth and death dates. A tool that tracks effects live, with a pre-registration date and a running out-of-sample tally, would be genuinely new.
4. All our published indicators remain descriptive; nothing here changes their claims.

## 4. Product ideas that come from this research (our own)
- **AT24 Forward Ledger**: candidate rules are pre-registered with a date; the indicator tallies their live out-of-sample results (running mean, t-statistic, p-value) beside a control rule. Nobody can fool themselves with hindsight, including us. First entry: "long the NY 18:00 hour", registered 2026-11-10.
- **AT24 Effect Tracker**: rolling t-statistics and change-point (birth/death) detection for hour-of-day and weekday effects: "is this effect alive right now?".
- **AT24 Edge Truth Test**: choose a simple rule, get a p-value from a proper null and a holdout split, the same engine as this lab.
- **AT24 History Doctor**: audits the broker's history (bars per day, zero-spread stretches, gaps) before any statistic is trusted - this lab found two such problems on a major broker.
