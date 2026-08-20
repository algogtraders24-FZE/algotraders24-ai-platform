# M4 Validation Report

**Evidence package:** `E:\algotraders24-ai-platform\ea-research\marketplace-research\m2-evidence-engine\real_evidence_output\evidence_G01-v0.1-FROZEN-BASELINE_1d0d5df55c44a8a1.json`  
**Engine:** AT24-M4-Validation-Engine-v1.0  
**Methodology version:** M4-methodology-v1  
**Dataset hash:** `3b94c92eb80e2583`

This report presents measured facts from independent validation procedures. It does not conclude that G01 is profitable, robust, or fit for listing -- see `M4_validation_engine.md` section 13/14 for the exact boundary. The frozen G01 v0.1 baseline is known to be a losing configuration (PF≈0.89, net profit≈-$5,909, max DD 63.01% per the M2.1/M3 record) — this report states that plainly rather than around it.

## Input Evidence

- Evidence ID: `1d0d5df55c44a8a1`
- Version: `G01-v0.1-FROZEN-BASELINE`
- Source artifact: `G01_Baseline_v0.1_Report.htm`

## Sample

- Trade count: 2712
- Profitable / losing / break-even: 908 / 1804 / 0
- Duration: 3393 days (~9.3 years)
- Trades/month: 24.33
- Years represented: 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026
- Status: **PASS**

## Temporal

### Out-of-Sample (time-based 80% split, boundary 2024-09-11T10:54:34.200000)

- In-sample: trades=2204, netProfit=-5804.25, PF=0.8763, winRate=33.26%, maxDD=61.21%
- Out-of-sample: trades=508, netProfit=-105.07, PF=0.9814, winRate=34.45%, maxDD=5.16%
- Status: **PASS**

### Walk-Forward (one window per calendar year, same configuration in every window)

| Test Year | Train Trades | Test Trades | Test Net Profit | Test PF | Window Status |
|---|---|---|---|---|---|
| 2018 | 216 | 274 | -675.18 | 0.9189 | PASS |
| 2019 | 490 | 306 | -1055.91 | 0.881 | PASS |
| 2020 | 796 | 289 | -1496.72 | 0.772 | PASS |
| 2021 | 1085 | 309 | -1582.41 | 0.6984 | PASS |
| 2022 | 1394 | 296 | 84.83 | 1.0223 | PASS |
| 2023 | 1690 | 293 | -45.2 | 0.9885 | PASS |
| 2024 | 1983 | 318 | -81.19 | 0.9799 | PASS |
| 2025 | 2301 | 305 | -374.77 | 0.8912 | PASS |
| 2026 | 2606 | 106 | 321.78 | 1.3188 | PASS |

- Walk-Forward record status: **PASS**

## Stability

- Longest inactive gap: 12 days
- Winning / losing / flat months: 45 / 67 / 0
- Best single month's share of all positive monthly profit: 10.7%

**Yearly breakdown:**

| Year | Trades | Net Profit |
|---|---|---|
| 2017 | 216 | -1004.55 |
| 2018 | 274 | -675.18 |
| 2019 | 306 | -1055.91 |
| 2020 | 289 | -1496.72 |
| 2021 | 309 | -1582.41 |
| 2022 | 296 | 84.83 |
| 2023 | 293 | -45.2 |
| 2024 | 318 | -81.19 |
| 2025 | 305 | -374.77 |
| 2026 | 106 | 321.78 |

- Status: **PASS**

## Regime

- Status: **INCONCLUSIVE**
- No trades in this Evidence carry a marketRegime tag -- regime coverage cannot be computed for this Evidence. No regime classifier exists yet in this research program (see design doc section 11); this is reported honestly, not fabricated.

## Performance Distribution

- Profit Factor: 0.8876
- Win Rate: 33.48%
- Median trade: -19.16
- Expectancy per trade: -2.179
- Max Drawdown: 63.01%
- Largest win / loss: 120.08 / -141.97
- Consecutive wins / losses: 7 / 16
- Top-decile winning trades' share of gross profit: 17.7%
- Status: **PASS**

## Parameter Sensitivity

- Status: **INCONCLUSIVE**
- Not executed for this Evidence: real parameter-sensitivity analysis requires new backtests with perturbed EA inputs, which this sprint's guardrails explicitly forbid ('Do not optimize G01. Do not change G01 parameters.'). The framework itself is built and verified against synthetic configurations (see test_validation_engine.py Test H). Deferred to a future sprint that explicitly authorizes new runs.

## Final Validation Status

# INCONCLUSIVE

### Why this status

`INCONCLUSIVE` because two of the seven validation types could not be completed for this specific Evidence, for reasons that are facts about the input, not defects in the engine:

- **Regime Coverage** is `INCONCLUSIVE`: this Evidence's trade records carry no regime classification (no regime classifier exists yet in this research program).
- **Parameter Sensitivity** is `INCONCLUSIVE`: real perturbation analysis was not run against G01 in this sprint per the explicit guardrail against re-parameterizing/optimizing G01.

The other five validation types (Sample Size, Out-of-Sample, Walk-Forward, Temporal Stability, Performance Distribution) all completed and are `PASS`/`WARNING`, meaning: the procedures ran correctly and produced trustworthy facts. Those facts show a losing strategy (negative net profit, PF<1 in-sample and consistent with that out-of-sample) across the full walk-forward history — `INCONCLUSIVE` does not soften that; it only reflects that two *additional* validation dimensions have no data to report on yet, not that the ones which did complete are in question.

**What this status does not mean:** no AT24 Score, Trust Status, or marketplace-readiness conclusion is implied by any status on this page. Those are M5 (Risk Analysis) / M6+ (Score, Trust Status), not yet run.
