# AT24 Forward Ledger - test record (2026-11-10, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, two screenshot scripts) |
| Engine vs independent Python (`mt5/AT24_FL_SelfTest.mq5` + `test/verify_fl.py`, 34,967 XAUUSD H1 bars) | the three rules replayed from three start dates (2024-01-01, 2025-06-01, 2026-07-01): trade counts, mean, standard deviation, t-statistic, hit rate, cumulative bp, mean direction, market drift per bar, drift-adjusted mean and its t-statistic all identical (9 of 9); New York hour identical to Python `zoneinfo` on all 34,967 bars; first valid (hourly) bar index identical |
| History guard | the broker's H1 history before 2021-05 has two bars per day; `AT24FL_ValidFrom` skips every day with fewer than 20 bars, the same way in MT5 and Python (index 1,959 = 2021-05-05) |
| MT5 live chart (portable terminal) | official ledger (opens 2026-11-10, 0 trades, "collecting"): test/mt5_forward_ledger_official.png; REPLAY mode from 2025-06-01 (in-sample, clearly labelled, matches the Python numbers): test/mt5_forward_ledger_replay.png |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it is
A pre-registration ledger. Three candidate rules from the AT24 Research Lab (reports/LAB-01-02-REPORT.md) are registered on **2026-11-10 (UTC)**:
- R1 long the New York 18:00 hour (the "reopening premium" candidate, hold 1 hour);
- R2 fade an H1 bar whose body is at least 2.5 ATR (enter next open, exit after 4 hours);
- R3 trade with the signs of the last 1 h / 4 h / 24 h / 120 h returns when all four agree (24-hour hold, one trade at a time).
Only trades whose entry bar starts after the registration time count; the indicator replays the closed hourly history each hour, so the numbers are always recomputable from the broker data. It places no orders.
For each rule it shows trades, mean return (bp), the mean net of the market's own drift (gold's drift would otherwise flatter every long rule), the drift-adjusted t-statistic, and a verdict: COLLECTING (fewer than 30 trades), NO EDGE SO FAR, or POSITIVE/NEGATIVE SO FAR only when |t| is at least 2.39 (two-sided 0.05 divided by the three registered rules).

## What the replay shows (in-sample, NOT evidence)
Replay from 2025-06-01: R1 373 trades, +5.0 bp (net of drift +4.8, t +2.82); R2 77 trades +2.5 bp (t +0.26); R3 286 trades +1.9 bp (t +0.13). Replay from 2026-07-01: R1 94 trades, -1.0 bp (t -0.51): the NY 18:00 premium was NOT there in the last four months. These are exactly the numbers a trader would be tempted to quote; the ledger exists so that nobody (including us) can quote them as evidence.

## Notes / limits
- The official ledger shows nothing until trades occur after 2026-11-10; R1 trades once per day (30 trades take about six weeks), R2 and R3 are rarer.
- Candles are bid-based and bar spread is a bar-level field: a rule that "wins" at the reopening can still be a spread/bid artifact; the ledger reports bid-series results (see the research report). No costs are subtracted.
- Rules are only ever ADDED with later registration dates; editing a registered rule would defeat the purpose.
- The registration date lives in the indicator source (public in the repository history); a user can change their own copy, which is why the official ledger is the published, versioned one.
