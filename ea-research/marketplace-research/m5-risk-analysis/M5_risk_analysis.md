# M5 — Risk Analysis Engine

**Status:** Contract + engine built, tested (synthetic + real). See `M5_risk_analysis_report.md` for the actual real-G01 result.

**Scope discipline:** M5 answers *"what are the measurable risk characteristics of this TradingSystem, and where are the important risk concentrations or weaknesses?"* — never *"is this system safe/risky/good."* No Trust Status, no AT24 Score, no risk grade (LOW/MEDIUM/HIGH), no marketplace ranking, no investment recommendation. A `RiskAnalysis.status` of `COMPLETE`/`PARTIAL`/`INCONCLUSIVE`/`FAILED` describes **how much of the risk picture could be measured**, never whether the risk level is acceptable.

---

## 1. Purpose

Given M3-verified Evidence and an M4 Validation result, M5 measures a fixed set of risk dimensions — drawdown, loss/win distribution, expectancy, loss streaks/recovery, tail risk, concentration, temporal risk, regime-conditional risk, exposure, and cost — and reports them as facts, each tagged with how reliable/complete the underlying data actually is. It exists to make one thing impossible: presenting a single headline number (like "63% drawdown") without also disclosing what kind of drawdown was measured, over what data, with what gaps.

## 2. Inputs

- A path to an M2 Evidence package.
- The Evidence's expected `versionId` and the current path to its source artifact (for M5's own fresh M3 re-verification).
- An **already-computed M4 validation result** (a dict, in the exact shape `run_validation_suite` returns) — M5 does not run M4 itself; the caller assembles the pipeline explicitly: verify → validate → analyze risk. This keeps "Evidence didn't verify" (`INVALID_INPUT_EVIDENCE`) and "no Validation was supplied at all" (`INSUFFICIENT_VALIDATION_INPUT`) as genuinely independent, separately testable failure modes rather than one hidden inside the other.
- Optional `expected_evidence_hash` / `expected_validation_hash` for tamper detection (§21).

## 3. Outputs

One `RiskAnalysis` record (§19) with named, independently-inspectable sub-objects per dimension — never a single blended number.

## 4. Methodology and calculation versioning

`METHODOLOGY_VERSION = "M5-methodology-v1"` and `CALCULATION_VERSION = "M5-calc-v1"` are recorded on every result. As with M4, a distinction is drawn between **structural/methodological parameters** (e.g., the minimum sample size below which a percentile calculation is flagged `LIMITED` rather than reported as if fully reliable — a mathematical necessity, not a business judgment) and **forbidden quality thresholds** (a risk score, a "safe/risky" cutoff) — none of the latter exist anywhere in this engine. `ACCEPTANCE_RULESET_VERSION = "none-defined"`, matching M4.

## 5. Platform-agnosticism (checked, not assumed)

Identical discipline to M4 (see `../m4-validation-engine/M4_validation_engine.md` §13): `risk_analysis_engine.py` operates only on the generic M1 Evidence/Trade shape (`timestamp`, `direction`, `entryPrice`, `exitPrice`, `volume`, `profit`, `durationSeconds`, `marketRegime`, and the M2.1-added `grossProfit`/`commission`/`swap` fields when an adapter provides them). No MT5 field names, no HTML/Deals-table parsing, no assumption that `sourceAdapter == "mt5-deals-table-v1"`. Test L constructs synthetic Evidence for six different `sourceAdapter` labels (MT5 EA, MT4 EA, cTrader cBot, NinjaTrader Strategy, crypto bot, AI trading engine) and confirms the engine runs identically for all of them — MT5 is the *first real fixture* (§22), not a design assumption.

One consequence worth stating plainly: two risk dimensions (**exposure** and **cost**) can only be computed *at all* when the underlying adapter populated the fields they need (`durationSeconds` for exposure/overlap reconstruction; `commission`/`swap` for cost risk). Both of M2's current adapters differ here — the deals-table adapter (M2.1, MT5's first real use) populates both; the original CSV adapter populates neither. This is reported explicitly per-Evidence via `dataQuality`, never silently defaulted.

## 6. Verified-Evidence + Validation prerequisite (§3/§4 of the brief)

1. M5 re-verifies M3 itself, fresh, exactly as M4 does (never trusts a cached status). Not `VERIFIED` → halts with `INVALID_INPUT_EVIDENCE`.
2. M5 requires a non-empty, well-formed `validation_result` to be supplied by the caller. Absent → halts with `INSUFFICIENT_VALIDATION_INPUT`. M5 does not require every M4 validation type to have `PASS`ed (M4 legitimately produces `INCONCLUSIVE` for regime coverage/parameter sensitivity on real G01 data, which is not a defect) — only that a genuine validation run actually happened and produced records.
3. `expected_evidence_hash` / `expected_validation_hash`, if supplied, are checked against fresh recomputation. Mismatch → `INPUT_INTEGRITY_FAILURE`.
4. M5's own provenance check (independent of M3/M4's own gates): `sourceAdapter` must be present — M5's provenance chain needs to know which adapter produced the Evidence it's about to characterize risk for. Absent → `RISK_PROVENANCE_FAILURE`.

## 7. Risk dimensions and their data-quality semantics

| Dimension | What's measured | `dataQuality` reality for the current M2.1 (deals-table) adapter |
|---|---|---|
| Drawdown | Peak-to-trough on a **trade-close (balance-level) cumulative equity curve** — see §8 | `LIMITED`. M2's `Evidence.curves` field is reserved but never populated by any current adapter (confirmed: always `{}`) — there is no intraday/tick-level equity series, so *equity* drawdown (which would include floating P&L on open positions) is `UNAVAILABLE`; only *balance* drawdown (closed-trade cumulative) is computable, and that's what's reported, explicitly labeled as such. |
| Loss / win distribution | Largest/avg/median, stdev, P50/P75/P90/P95/P99, streaks, clustering | `AVAILABLE` (2,712 real trades for G01 — ample for percentiles). `LIMITED` for very small samples, see §7's percentile floor below. |
| Expectancy / payoff | Expectancy, win/loss ratio, PF, gross vs. net | `AVAILABLE` — gross vs. net distinction uses the real per-trade `grossProfit`/`commission`/`swap` fields M2.1 already preserves. |
| Loss streaks / recovery | Longest streak, capital impact, recovery duration/efficiency, % time below peak | Tied to the same balance-curve reconstruction as drawdown — `LIMITED` for the same reason. |
| Tail risk | Worst 1/5/10 trades, P95/P99 loss, % of total loss from worst-N | `AVAILABLE`. |
| Concentration | Top-1%/5% winner contribution, best/worst period (reused from M4) | `AVAILABLE` — reuses M4's `TEMPORAL_STABILITY` record rather than recomputing period aggregation (§12 of the brief: "do not duplicate M4 validation logic unnecessarily"). |
| Temporal risk | Per-year drawdown/loss-streak (genuinely new vs. M4, which only tracked net profit/PF per year) | `AVAILABLE`. |
| Regime-conditional risk | Per-regime risk, if `Trade.marketRegime` is populated | `UNAVAILABLE` for G01 (no regime tags exist anywhere in this research program yet — same fact M4 already found). Reported as `REGIME_DATA_UNAVAILABLE`, never inferred. |
| Exposure | Position-size distribution, reconstructed entry/exit overlap (simultaneous positions), directional concentration | `AVAILABLE` when `durationSeconds` is present (true for M2.1's deals-table adapter, which lets entry time = close time − duration be reconstructed); `LIMITED`/`EXPOSURE_ANALYSIS_LIMITED` otherwise. |
| Cost | Commission/swap totals, cost as % of gross profit/loss, cost per trade; `spreadModel` from provenance | `AVAILABLE` for commission/swap (real per-trade values exist for the deals-table adapter); `UNKNOWN` — never `0` — for `spreadModel`, since M2's provenance already correctly leaves it `null` when the source doesn't expose it (M0.1: **UNKNOWN ≠ ZERO**). |

Percentile floor: P95/P99 are reported as `LIMITED` (not withheld, not silently trusted) whenever the underlying sample has fewer than 20 observations — a structural statement about how many points a 95th/99th-percentile estimate needs to mean anything at all, not a business-quality threshold.

## 8. Balance drawdown vs. equity drawdown — the one distinction this document leads with

MT5 (and most platforms) distinguish **Balance Drawdown** (computed only from closed-trade P&L) from **Equity Drawdown** (which also reflects unrealized P&L on currently-open positions, and is therefore always ≥ balance drawdown in magnitude). M2's Evidence never captured an intraday equity series — only closed-trade records. **Every drawdown figure this engine reports is a balance drawdown, reconstructed from the trade-close equity curve, and is labeled as such everywhere it appears.** No equity-drawdown number is fabricated to fill the gap; the field is `UNAVAILABLE` and says why.

## 9. Provenance, hashing, reproducibility (§20/§21)

Every `RiskAnalysis` carries `inputEvidenceHash` (= the Evidence's own `_contentHash`) and `inputValidationHash` (a hash M5 computes over the supplied M4 result, excluding volatile per-record `startedAt`/`completedAt` fields — the same exclusion discipline M2/M3/M4 already apply to their own `createdAt`/timestamp fields). `riskAnalysisId` = `inputValidationHash`-adjacent content hash of the finished RiskAnalysis itself (mirroring M3's "content hash serves as identity" convention, since M5 has no real database either). All risk-dimension functions are pure functions of their trade/evidence/validation inputs plus documented parameters — no randomness, no wall-clock dependence in computed values. Test J proves two runs against identical input produce identical output once `generatedAt` is excluded; Test K proves the hash is actually sensitive to content changes.

## 10. Limitations (stated plainly, not buried)

- No true equity curve exists in any current M2 Evidence → all drawdown/recovery figures are balance-level, not equity-level.
- No regime classifier exists yet in this research program → regime-conditional risk is always `UNAVAILABLE` for every Evidence produced so far, G01 included.
- Real parameter-sensitivity risk (how risk changes under perturbed parameters) is out of scope for this sprint for the same reason M4 didn't run it against real G01 — no new backtests were authorized.
- Exposure/cost analysis quality depends entirely on which adapter produced the Evidence — the CSV adapter (M2's original) cannot support either dimension; only the deals-table adapter (M2.1) currently can.

## 11. Failure states

`INVALID_INPUT_EVIDENCE`, `INSUFFICIENT_VALIDATION_INPUT`, `INPUT_INTEGRITY_FAILURE`, `RISK_PROVENANCE_FAILURE` — all halt before any risk dimension is computed. Within a completed run, per-dimension issues are never silent: `DRAWDOWN_ANALYSIS_LIMITED`, `REGIME_DATA_UNAVAILABLE`, `EXPOSURE_ANALYSIS_LIMITED`, and `UNKNOWN` (for genuinely unknown cost components) are explicit values inside `dataQuality`/`findings`, not exceptions — a partially-measurable Evidence still produces a useful (if `PARTIAL`) result.

## 12. Warning states

Surfaced (non-blocking) whenever a dimension completed but with a caveat worth knowing — e.g. a percentile computed from a thin-but-nonzero sample, or a drawdown episode that never recovered within the tested period. Never influences `status`.

## 13. What Risk Analysis does NOT decide

No Risk Score, no Risk Grade (LOW/MEDIUM/HIGH), no Trust Status, no AT24 Score, no marketplace ranking, no seller reputation, no "safe"/"risky" label, no investment recommendation, no profitability guarantee, no parameter optimization or strategy improvement suggestion, no curve-fit judgment (that's a separate, not-yet-built robustness layer), no production Prisma integration, no marketplace UI.
