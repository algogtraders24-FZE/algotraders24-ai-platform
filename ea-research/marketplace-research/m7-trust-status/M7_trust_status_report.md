# M7 Trust Status Report — G01

## Inputs

- Evidence: `1d0d5df55c44a8a1` (M3 status: **VERIFIED**)
- Validation: overallStatus **INCONCLUSIVE** — SAMPLE_SIZE=PASS, OUT_OF_SAMPLE=PASS, WALK_FORWARD=PASS, TEMPORAL_STABILITY=PASS, REGIME_COVERAGE=INCONCLUSIVE, PERFORMANCE_DISTRIBUTION=PASS, PARAMETER_SENSITIVITY=INCONCLUSIVE
- RiskAnalysis: status **PARTIAL** — dataQuality: drawdown=LIMITED, lossDistribution=AVAILABLE, winDistribution=AVAILABLE, expectancy=AVAILABLE, lossStreaks=AVAILABLE, recovery=LIMITED, tailRisk=AVAILABLE, concentration=AVAILABLE, temporalRisk=AVAILABLE, regimeRisk=UNAVAILABLE, exposureRisk=AVAILABLE, costRisk=AVAILABLE
- History: 6 events, 1 recorded observation(s)

## Current Trust Status

# INCONCLUSIVE

- reasonCode: `VALIDATION_INCONCLUSIVE`
- explanation: Evidence integrity is verified, but the current Validation (M4) result is INCONCLUSIVE (overallStatus=INCONCLUSIVE) -- validation types not conclusively completed: REGIME_COVERAGE, PARAMETER_SENSITIVITY
- generatedAt: `2026-08-19T14:40:19.189714Z`
- statusContentHash: `c70cc7018636015f`

## Status Precedence — which condition determined the final state

Checked in this exact order (see M7_trust_status.md section 2): SUPERSEDED? No (no VERSION_SUPERSEDED event exists). INVALIDATED? No (no invalidation event exists). UNVERIFIED? No (M3 status is VERIFIED). VALIDATION_PENDING? No (a Validation result exists). **The determining condition is: M4 overallStatus = `INCONCLUSIVE`** — this alone routes the status to INCONCLUSIVE, before RiskAnalysis or History observation-count are even consulted (per the documented precedence, Validation sufficiency is checked before RiskAnalysis completeness).

## Evidence State (M3)

- Status: **VERIFIED**
- Warnings: ["PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'spreadModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'commissionModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'swapModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'tickDataQuality' is null"]

## Validation State (M4)

- overallStatus: **INCONCLUSIVE**

| Validation Type | Status |
|---|---|
| SAMPLE_SIZE | PASS |
| OUT_OF_SAMPLE | PASS |
| WALK_FORWARD | PASS |
| TEMPORAL_STABILITY | PASS |
| REGIME_COVERAGE | INCONCLUSIVE |
| PERFORMANCE_DISTRIBUTION | PASS |
| PARAMETER_SENSITIVITY | INCONCLUSIVE |

## Risk State (M5)

- status: **PARTIAL**

| Dimension | Data Quality |
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

## History State (M6)

| # | Event Type | observedAt | recordedAt |
|---|---|---|---|
| 1 | SYSTEM_CREATED | 2026-08-19T14:40:18.911536Z | 2026-08-19T14:40:18.911536Z |
| 2 | VERSION_CREATED | 2026-08-19T14:40:18.911536Z | 2026-08-19T14:40:18.911536Z |
| 3 | EVIDENCE_ADDED | 2026-07-22T04:08:42 | 2026-08-19T14:40:18.911536Z |
| 4 | EVIDENCE_VERIFIED | 2026-08-19T14:40:18.911536Z | 2026-08-19T14:40:18.911536Z |
| 5 | VALIDATION_COMPLETED | 2026-08-19T14:40:18.911536Z | 2026-08-19T14:40:18.911536Z |
| 6 | RISK_ANALYSIS_COMPLETED | 2026-08-19T14:40:18.911536Z | 2026-08-19T14:40:18.911536Z |

## Longitudinal Depth

- Observation count: **1**
- Evidence age: see M6_history_report.md (28 days as of the M6 run)
- History limitation: single verified historical observation — no longitudinal trend, cadence, or version-comparison claim is made anywhere in this report.

## Status Timeline

| # | Status | Reason Code | Generated At |
|---|---|---|---|
| 1 | INCONCLUSIVE | VALIDATION_INCONCLUSIVE | 2026-08-19T14:40:19.189714Z |

## Limitations

- This is a single TrustStatus derivation from one historical Evidence observation — not a longitudinal trust claim.
- M4's overallStatus is INCONCLUSIVE specifically because REGIME_COVERAGE (no regime classifier exists yet) and PARAMETER_SENSITIVITY (no perturbation runs were performed, per the M4 sprint's explicit guardrail) could not be completed — not because G01's methodology failed a check it was actually subjected to.
- G01's underlying measured facts remain exactly as M4/M5 reported them: PF≈0.888, expectancy≈-$2.18/trade, max drawdown 63.01%, negative net profit across most calendar years — none of this is softened, hidden, or reinterpreted by this report. **INCONCLUSIVE describes the state of AT24's evidence about G01, not a judgment that G01 is a bad strategy — and it is not, on this evidence, a good one either. It is simply not yet fully validated.**

## Final Status

# INCONCLUSIVE
