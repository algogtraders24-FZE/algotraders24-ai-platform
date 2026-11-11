# AT24 Research Lab C1 (2026-11-11): first crypto lab - funding extremes and the weekend

Script: `py/lab_c1_crypto_funding_weekend.py` (pre-registration in the header, written before any result was seen). Raw numbers: `reports/lab_c1_results.json`.
Data: Binance public REST, USDT-margined perpetuals, funding (every 8 h) and klines from 2019-09. BTC is the primary test; ETH is an uncounted replication. Family of 3, Bonferroni alpha 0.0167. Periods: train 2020-2022, validation 2023-2024-06, final 2024-07..end.

## Results (BTCUSDT)
| # | Belief | train | validation | final | Finding |
|---|---|---|---|---|---|
| C1a | after top-decile funding (crowded longs) the next 24 h return is lower | -64 bp (p 0.045, 180 events) | +10 bp (p 0.67) | -9 bp (p 0.68) | no (sign flips) |
| C1b | after bottom-decile funding (crowded shorts) the next 24 h return is higher | +31 bp (p 0.45) | +21 bp (p 0.43) | -14 bp (p 0.58) | no |
| C2 | weekend days (Sat+Sun) differ from weekdays | -16 bp/day (p 0.54) | +4 (p 0.87) | -2 (p 0.93) | no |
ETH replication: nothing either (all p >= 0.15, signs unstable).

## Descriptive: what a delta-neutral funding carry would have paid (mean funding x 3 x 365, before fees, borrow and margin costs)
BTC: 2020 17.5 %/yr, 2021 35.6, 2022 4.3, 2023 8.0, 2024 12.2, 2025 5.3, **2026 3.5**. ETH: 22.5 / 43.4 / 0.0 / 8.5 / 13.2 / 4.9 / **2.0**. The carry has collapsed to roughly the level of short-term interest rates: it is not an opportunity today.

## Reading
- Funding extremes do not predict the next 24 hours in a stable way (the training result looked like the textbook "crowded longs pay" effect and then vanished out of sample, as in the gold labs). The weekend effect is nothing.
- Together with the earlier Binance sprints (9 price-rule strategies, none passed) the honest picture is the same as for gold: no established tradable edge from simple price or funding rules.
- Consequence for products: crypto derivatives data is useful as CONTEXT (crowding, leverage, volatility), not as a signal.
