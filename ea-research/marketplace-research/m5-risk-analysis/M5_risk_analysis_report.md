# M5 Risk Analysis Report

## Input

- Evidence ID: `1d0d5df55c44a8a1`
- Evidence hash: `1d0d5df55c44a8a1`
- Validation ID / hash: `b15e7232bf5b2d9b` (validation overallStatus was `INCONCLUSIVE`)
- Version: `G01-v0.1-FROZEN-BASELINE`
- Risk Analysis ID / content hash: `f7b2f31d02b36205`

This report presents measured risk facts only. No AT24 Score, Trust Status, risk grade, or marketplace-readiness conclusion is implied by anything below. G01's v0.1 baseline is a known losing configuration (PF≈0.888, expectancy≈-$2.18/trade, max drawdown 63.01%, 2,712 trades) — the analysis below is not softened to suggest otherwise.

## Risk Profile

### Drawdown

- Curve type: balance (trade-close), NOT intraday equity -- see design doc section 8
- Max drawdown: 6365.57 (63.01%)
- Max drawdown duration: 3338 days
- Average / median drawdown: 3550.02 / 3550.02
- Drawdown episodes: 2 (1 unrecovered at end of period)
- Data quality: **LIMITED** — DRAWDOWN_ANALYSIS_LIMITED: no intraday/tick equity series exists in this Evidence (Evidence.curves is empty) -- figures above are BALANCE drawdown (closed trades only), not EQUITY drawdown.

### Loss Distribution

- Count: 1804, largest: -141.97, average: -29.14, median: -22.71, stdev: 13.86
- Percentiles: P50=22.72, P75=40.48, P90=48.44, P95=52.08, P99=65.56
- Max consecutive losses: 16 (avg streak length 2.99, 603 loss-streak episodes)
- Share of losses that are clustered (streak ≥2): 90.0%
- Data quality: **AVAILABLE**

### Win Distribution

- Count: 908, largest: 120.08, average: 51.38, median: 40.3, stdev: 21.62
- Percentiles: P50=40.3, P75=73.0, P90=83.51, P95=88.89, P99=100.84
- Max consecutive wins: 7 (avg streak length 1.5)
- Data quality: **AVAILABLE**

### Expectancy / Payoff

- Expectancy per trade: -2.179
- Average win / loss: 51.38 / -29.14 (win/loss ratio 1.7634)
- Profit Factor (net): 0.8876
- Gross profit / loss (net-of-cost basis): 46653.41 / -52562.73
- Gross profit / loss (pre-cost basis): 47962.14 / -50228.77
- Net result: -5909.32
- Data quality: **AVAILABLE**

### Loss Streaks

- Max consecutive losses: 16 over 18 days
- Capital impact of longest loss streak: -355.08 (3.55% of deposit)
- Data quality: **AVAILABLE**

### Recovery

- Recovery episodes: 1 (unrecovered at end of period: 1)
- Average recovery duration: 55 days
- % of tested period spent below prior equity peak: 100.0%
- Data quality: **LIMITED** — Recovery timing is reconstructed from the same balance-level (trade-close) equity curve as drawdown -- not intraday equity. See drawdown section.

### Tail Risk

- Worst 1 / 5 / 10 trades: -141.97 / -533.85 / -959.71
- Share of gross loss from worst 1 / 5 / 10 trades: 0.3% / 1.0% / 1.8%
- P95 loss: 52.08, P99 loss: 65.56
- Data quality: **AVAILABLE**

### Concentration

- Top 1% / 5% winning trades' share of gross profit: 2.1% / 9.3%
- Best year: {'year': '2026', 'tradeCount': 106, 'netProfit': 321.78}
- Worst year: {'year': '2021', 'tradeCount': 309, 'netProfit': -1582.41}
- Best month: {'month': '2019-03', 'tradeCount': 29, 'netProfit': 604.72}
- Worst month: {'month': '2019-04', 'tradeCount': 30, 'netProfit': -630.48}
- Positive / negative months: 45 / 67
- Data quality: **AVAILABLE**

### Temporal Risk

- Worst drawdown year: 2021

| Year | Trades | Max DD within year | Max consecutive losses within year |
|---|---|---|---|
| 2017 | 216 | 1259.51 | 12 |
| 2018 | 274 | 1037.14 | 10 |
| 2019 | 306 | 1713.04 | 13 |
| 2020 | 289 | 1605.63 | 14 |
| 2021 | 309 | 1890.48 | 16 |
| 2022 | 296 | 374.28 | 10 |
| 2023 | 293 | 434.35 | 11 |
| 2024 | 318 | 616.79 | 9 |
| 2025 | 305 | 434.59 | 12 |
| 2026 | 106 | 240.26 | 7 |

- Data quality: **AVAILABLE**

### Regime Risk

- Data quality: **UNAVAILABLE**
- REGIME_DATA_UNAVAILABLE: no trades in this Evidence carry a marketRegime tag. No regime classifier exists yet in this research program -- not inferred.

### Exposure Risk

- Position size: max=5.36, avg=0.1555
- Directional split: {'long': 1419, 'short': 1293, 'longSharePct': 0.5232}
- Simultaneous exposure: {'maxSimultaneousPositions': 1, 'hadOverlappingPositions': False, 'totalOverlapDurationHours': 0.0}
- Data quality: **AVAILABLE**

### Cost Risk

- Total commission: -2964.9, total swap: -677.79, total cost: -3642.69
- Cost per trade: -1.3432
- Cost as % of gross profit / loss: 0.0759 / 0.0725
- Spread model: UNKNOWN
- Data quality: **AVAILABLE** — spreadModel is UNKNOWN (not zero) -- the source report doesn't expose it; commission/swap above are real measured values, independent of this gap.

## Data Quality Summary

| Dimension | Quality |
|---|---|
| drawdown | LIMITED |
| lossDistribution | AVAILABLE |
| winDistribution | AVAILABLE |
| expectancy | AVAILABLE |
| lossStreaks | AVAILABLE |
| recovery | LIMITED |
| tailRisk | AVAILABLE |
| concentration | AVAILABLE |
| temporalRisk | AVAILABLE |
| regimeRisk | UNAVAILABLE |
| exposureRisk | AVAILABLE |
| costRisk | AVAILABLE |

## Findings

- Max drawdown (balance): 6365.57 (0.6301), 2 drawdown episodes, 1 unrecovered at end of period.
- Expectancy per trade: -2.179. Max consecutive losses: 16.

## Warnings

None.

## Limitations

- DRAWDOWN_ANALYSIS_LIMITED: no intraday/tick equity series exists in this Evidence (Evidence.curves is empty) -- figures above are BALANCE drawdown (closed trades only), not EQUITY drawdown.
- Recovery timing is reconstructed from the same balance-level (trade-close) equity curve as drawdown -- not intraday equity. See drawdown section.
- REGIME_DATA_UNAVAILABLE: no trades in this Evidence carry a marketRegime tag. No regime classifier exists yet in this research program -- not inferred.
- spreadModel is UNKNOWN (not zero) -- the source report doesn't expose it; commission/swap above are real measured values, independent of this gap.

## Final Status

# PARTIAL

**What this status means:** how much of the risk picture above could be measured from this Evidence (12 dimensions; see Data Quality Summary). It is not a judgment of whether the risk level is acceptable — G01's actual measured risk profile (63.01% max drawdown, negative expectancy, 7 of 9 walk-forward years losing, 16 max consecutive losses) is stated in full above, unsoftened.
