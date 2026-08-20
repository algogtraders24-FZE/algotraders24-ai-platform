# M6 History Report — G01

## System

- TradingSystem: `G01` — G01 LiquiditySweep MSS FVG (Gold Auto Strategy)
- Version: `G01-v0.1-FROZEN-BASELINE`

## History Chain

Chain integrity: **VERIFIED**

### Event 1: SYSTEM_CREATED

- observedAt: `2026-08-19T14:27:47.567843Z`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M6-History-Engine-v1.0`
- artifact IDs: evidenceId=`None`, validationId=`None`, riskAnalysisId=`None`
- sourceHash: `None`
- eventHash: `63261cc680a9841f`
- previousEventId: `None`
- payload: `{"tradingSystemId": "G01"}`

### Event 2: VERSION_CREATED

- observedAt: `2026-08-19T14:27:47.567843Z`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M6-History-Engine-v1.0`
- artifact IDs: evidenceId=`None`, validationId=`None`, riskAnalysisId=`None`
- sourceHash: `None`
- eventHash: `d77f103d1702987e`
- previousEventId: `63261cc680a9841f`
- payload: `{"versionId": "G01-v0.1-FROZEN-BASELINE"}`

### Event 3: EVIDENCE_ADDED

- observedAt: `2026-07-22T04:08:42`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M2-Evidence-Engine-v0.2`
- artifact IDs: evidenceId=`1d0d5df55c44a8a1`, validationId=`None`, riskAnalysisId=`None`
- sourceHash: `1d0d5df55c44a8a1`
- eventHash: `789d320733b24eda`
- previousEventId: `d77f103d1702987e`
- payload: `{"sourceAdapter": "mt5-deals-table-v1", "tradeCount": 2712}`

### Event 4: EVIDENCE_VERIFIED

- observedAt: `2026-08-19T14:27:47.567843Z`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M3-Evidence-Verifier-v1.0`
- artifact IDs: evidenceId=`1d0d5df55c44a8a1`, validationId=`None`, riskAnalysisId=`None`
- sourceHash: `1d0d5df55c44a8a1`
- eventHash: `01bc1c20b6e86ea8`
- previousEventId: `789d320733b24eda`
- payload: `{"m3Status": "VERIFIED", "warnings": ["PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'spreadModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'commissionModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'swapModel' is null", "PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'tickDataQuality' is null"]}`

### Event 5: VALIDATION_COMPLETED

- observedAt: `2026-08-19T14:27:47.567843Z`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M4-Validation-Engine-v1.0`
- artifact IDs: evidenceId=`1d0d5df55c44a8a1`, validationId=`1d0d5df55c44a8a1`, riskAnalysisId=`None`
- sourceHash: `1d0d5df55c44a8a1`
- eventHash: `6f754fff1f0efe53`
- previousEventId: `01bc1c20b6e86ea8`
- payload: `{"overallStatus": "INCONCLUSIVE", "recordStatuses": {"SAMPLE_SIZE": "PASS", "OUT_OF_SAMPLE": "PASS", "WALK_FORWARD": "PASS", "TEMPORAL_STABILITY": "PASS", "REGIME_COVERAGE": "INCONCLUSIVE", "PERFORMANCE_DISTRIBUTION": "PASS", "PARAMETER_SENSITIVITY": "INCONCLUSIVE"}}`

### Event 6: RISK_ANALYSIS_COMPLETED

- observedAt: `2026-08-19T14:27:47.567843Z`
- recordedAt: `2026-08-19T14:27:47.567843Z`
- source: `AT24-M5-Risk-Analysis-Engine-v1.0`
- artifact IDs: evidenceId=`1d0d5df55c44a8a1`, validationId=`1d0d5df55c44a8a1`, riskAnalysisId=`f7b2f31d02b36205`
- sourceHash: `f7b2f31d02b36205`
- eventHash: `797a116450363f20`
- previousEventId: `6f754fff1f0efe53`
- payload: `{"status": "PARTIAL", "dataQuality": {"drawdown": "LIMITED", "lossDistribution": "AVAILABLE", "winDistribution": "AVAILABLE", "expectancy": "AVAILABLE", "lossStreaks": "AVAILABLE", "recovery": "LIMITED", "tailRisk": "AVAILABLE", "concentration": "AVAILABLE", "temporalRisk": "AVAILABLE", "regimeRisk": "UNAVAILABLE", "exposureRisk": "AVAILABLE", "costRisk": "AVAILABLE"}}`

## Longitudinal State

- Evidence records: **1**
- Validation records: **1** (containing 7 validation-type sub-records — see M4_validation_report.md)
- RiskAnalysis records: **1**
- Evidence age: **28 days** (reference time 2026-08-19T14:27:47.568843, evidence period end 2026-07-22T04:08:42)
- History gaps: not computable — fewer than 2 observations exist.
- Cadence: not computable — fewer than 2 observations exist.

## Version History

- Versions on record: **1** (`G01-v0.1-FROZEN-BASELINE`)
- Supersession events: none recorded — no second version has been independently verified through this pipeline yet. (Note: an execution-integrity-patched build referred to elsewhere in this research program as "v0.2" exists as source code, but per section 25 of this sprint's brief, it is not assumed to be a separate validated Version here merely because a report file exists for it — it would need its own independent M2→M5 run through this exact pipeline to earn a VERSION_CREATED event.)

## Comparability

- Comparable observation pairs: **0** — only one observation exists; there is nothing to compare it against.
- Non-comparable observation pairs: **0**

## Limitations

**Single verified historical observation; longitudinal performance history not yet established.** Everything in this report (evidence age, the single-event chain, the absence of gaps/cadence/change-detection output) reflects exactly one genuine G01 v0.1 backtest run through M2→M5. No monthly, live, or forward-test observations exist. No performance trend, recovery pattern, or version transition is asserted anywhere in this report — per this sprint's explicit rule (section 28), none has been manufactured to fill the gap. The gap-detection, cadence-analysis, and change-detection *engine functions* are proven correct against synthetic multi-observation fixtures in `test_history_engine.py` (Tests M, O, P, Q) — they are simply not yet exercised against a second real G01 observation, because one does not exist.

## Final Status

# PARTIAL

**Why PARTIAL, not COMPLETE:** the chain itself is fully verified and every event is properly hashed, sourced, and provenance-complete — but a *longitudinal* history engine's fullest value (gap detection, cadence, change tracking) requires more than one observation, which doesn't exist yet for G01. `COMPLETE` is reserved for a case where the available observation depth actually supports every longitudinal feature this engine has, not just the chain-integrity portion of it.

**What this status does not mean:** no Trust Status, Score, or marketplace-readiness conclusion is implied. G01's underlying measured facts (PF≈0.888, expectancy≈-$2.18/trade, max drawdown 63.01%) remain exactly as reported in M4/M5 — this report adds *when AT24 came to know them*, not a new judgment about them.
