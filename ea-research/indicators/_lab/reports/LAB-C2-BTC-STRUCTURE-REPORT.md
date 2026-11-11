# AT24 Research Lab C2 (2026-11-11): price-only structure of BTC

Script: `py/lab_c2_btc_price_structure.py` (pre-registration in the header). Raw numbers: `reports/lab_c2_results.json`. Data: Binance spot BTCUSDT H1 (24/7), 2020-2026, UTC. Descriptive stability checks, no trading rule, no edge claim.

| Question | Result | Stable? |
|---|---|---|
| Q1 intraday range profile by UTC hour, period A (2020-22) vs B (2023-26) | Spearman rho +0.75 (p 0.0002). Median H1 range: 0.38-0.40 % at 04-06 UTC, rising to **0.87 % at 14:00 UTC** (13-16 UTC is the peak = US cash open); top 3 hours A: 14, 0, 13; B: 14, 15, 13 | yes |
| Q2 weekend day range / weekday day range, per year | 0.77, 0.75, 0.63, 0.56, 0.51, 0.54, 0.55 (2020..2026): below 1 in all 7 years and **falling**: weekends are about half as wide as weekdays since 2023 | yes |
| Q3 funding hours (00, 08, 16 UTC) H1 range / other hours | 1.21, 1.22, 1.14, 1.11, 1.07, 1.09, 1.11: above 1 in all 7 years, shrinking | yes |
Not tested, reported: median annualised realised volatility by year 52 / 72 / 64 / 40 / 51 / 44 / 38 % (2020..2026); now 35.8 %, the 16th percentile of its own history (calm). Drawdown from all-time high now -41.5 % (max -77.2 %); BTC spent 75 % of the time more than 10 % below its ATH and 49 % more than 30 % below.

Reading: BTC has a stable, strong, price-only time structure (US-session hump, quiet Asian night, half-size weekends, small funding-hour bump). These describe HOW MUCH price moves, never which way: no edge is implied (Labs C1, 01-06).
