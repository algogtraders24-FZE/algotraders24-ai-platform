# M4 — Validation Engine

**Status:** Contract + engine built, tested (synthetic + real). See `M4_validation_report.md` for the actual real-G01 result.

**Scope discipline:** M4 answers *"how strong is this Evidence under independent validation procedures?"* — never *"is this a good strategy?"*. `PASS` on a validation record means **the procedure ran correctly and produced trustworthy facts**, not that the underlying numbers are favorable. A structurally sound validation of a losing strategy is a `PASS`. No AT24 Score, Trust Status, marketplace ranking, or buy/sell recommendation is produced here — those are M5/M6/M7/M8+.

---

## 1. Purpose

Given Evidence that M3 has already verified as internally consistent and traceable, M4 runs a fixed set of independent, methodologically-defined analyses against its trade records and reports **measured facts**, not judgments. It exists to make one thing impossible: presenting a backtest's raw metrics as if they were validated proof of a working strategy, when in fact important checks (adequate sample, genuine out-of-sample behavior, stability over time, sensitivity to small parameter changes) were never run or never passed.

## 2. Inputs

- A path to an M2 Evidence package (the same `{"evidence": {...}, "trades": [...]}` shape M3 consumes).
- The current path to the original source artifact (for M3's own re-verification — M4 does not trust a stale/cached M3 result, see §4).
- The `versionId` this Evidence is expected to belong to.
- Optionally: an `expected_dataset_hash` (for reproducibility checks, §16) and a set of parameter-perturbation configurations (§12 — absent for the real G01 run this sprint, see §17).

## 3. Outputs

One `Validation` record per validation type (§5), each independently inspectable, plus an aggregate suite result. No record is ever collapsed into another; a caller can always ask "what did the Sample Size validation specifically find?" independent of what Walk-Forward found.

## 4. Verified-Evidence prerequisite (§4 of the brief)

M4 does not accept a pre-computed, possibly-stale M3 result — it re-invokes M3's `verify_evidence_package` itself, every run, against the Evidence package and the *current* state of the source artifact. If the result is not `VERIFIED`, M4 halts immediately with `INVALID_INPUT_EVIDENCE` and runs nothing else. This is deliberately stricter than "trust whatever status is written down somewhere" — an Evidence file that was `VERIFIED` yesterday but whose source artifact changed since is not verified today.

## 5. Validation types (this sprint)

| Type | What it measures | Status semantics |
|---|---|---|
| `SAMPLE_SIZE` | trade/profit/loss counts, duration, trades-per-period | `FAIL` only if zero trades (nothing measurable); otherwise `PASS` — the facts themselves carry no verdict |
| `TEMPORAL_SPLIT` + `OUT_OF_SAMPLE` | in-sample vs. out-of-sample metrics, computed with a hard non-leakage guarantee | `PASS` if both segments are non-empty and the leakage assertion holds; `INCONCLUSIVE` if a segment is empty; halts with `TEMPORAL_LEAKAGE` if the assertion is ever violated (should be structurally impossible — see §7) |
| `WALK_FORWARD` | one window per calendar year, train = everything strictly before that year, test = that year | Each window is independently `PASS`/`INCONCLUSIVE` by measurability (test segment non-empty); the record's own status is `PASS` only if every window was measurable |
| `TEMPORAL_STABILITY` | monthly/quarterly/yearly breakdown, longest inactive gap, profit concentration in the single best period | `PASS` if periods are computable (always true given ≥1 trade) — concentration is reported as a fact, not judged |
| `REGIME_COVERAGE` | trade counts/metrics per regime, using `Trade.marketRegime` if present | `INCONCLUSIVE` when no regime data exists in the Evidence's trades (true for the real G01 evidence — see §11); the *framework* is still built and tested against a synthetic regime-tagged fixture |
| `PERFORMANCE_DISTRIBUTION` | PF, win rate, avg/median trade, expectancy, max DD, largest win/loss, consecutive streaks, top-decile profit concentration | Always `PASS` when trades exist — again, a fact report, not a verdict |
| `PARAMETER_SENSITIVITY` | comparison of metrics across declared parameter configurations vs. a baseline | `INCONCLUSIVE` / not run for the real G01 evidence this sprint — see §12/§17; framework built and tested synthetically |

## 6. Failure states

- `INVALID_INPUT_EVIDENCE` — Evidence is not currently M3-`VERIFIED`. Halts before any validation runs.
- `DATASET_INTEGRITY_FAILURE` — the trades actually being validated hash differently than an externally declared expectation (simulates dataset substitution between verification and validation time).
- `TEMPORAL_LEAKAGE` — a trade timestamped after a segment boundary was found inside the "before the boundary" segment, or vice versa. Enforced by an explicit runtime assertion inside every temporal split, not just assumed from correct slicing logic.
- `INVALID_VALIDATION_WINDOW` — a requested/derived window has a non-positive duration, or a test window's boundaries fall outside the dataset's actual timestamp range.
- `VALIDATION_PROVENANCE_FAILURE` — the Evidence package is missing a field M4 itself needs to build valid provenance for its own output (e.g. `provenance.periodStart`/`periodEnd`, `versionId`, or the Evidence content hash).

## 7. Warning states

`WARNING` (as distinct from `INCONCLUSIVE`) is reserved for a validation type that *did* complete but surfaced something the caller should know before trusting the record at face value — for example, an out-of-sample segment with a very small trade count relative to in-sample (still non-empty, still measurable, but thin). This sprint's implementation does not hardcode a numeric threshold for when "thin" becomes a warning (that would reintroduce exactly the "100 trades = PASS" problem the brief forbids) — the *field* exists in the result shape and is used for the one place this sprint has non-arbitrary grounds to warn (see the real report), rather than being wired to an invented number everywhere.

## 8. Provenance requirements (§15)

Every `Validation` record carries: `evidenceId` (the M3-verified Evidence's content hash), `versionId`, `datasetIdentity` + `datasetHash` (SHA-256 of the canonicalized trades array M4 actually analyzed — see §16), `inputEvidenceHash` (same as evidenceId, named per the brief's field list), `startedAt`/`completedAt`, `methodology` (a short name identifying which procedure ran), `rulesetVersion` and `parameters` (see §9), and `createdBy` (the engine version string).

## 9. Ruleset / methodology versioning — and where a split ratio is not a "quality threshold"

Two kinds of numeric decision appear in this engine, and they are treated differently on purpose:

- **Quality-judgment thresholds** ("PF > 1.5 = good", "100 trades = verified") — **forbidden this sprint**, per the brief. None appear anywhere in this engine's status logic. A validation's `status` never depends on whether a metric crossed a business-meaningful line.
- **Methodology parameters** (the OOS split ratio, the walk-forward window definition) — these are structurally necessary to define *what a temporal split even is*; there is no way to build an OOS framework without picking some boundary. They are treated as ordinary, versioned, documented configuration — `rulesetVersion = "M4-methodology-v1"`, with the exact values (80/20 time-based OOS split; one walk-forward window per calendar year) recorded in every record's `parameters` field — not silently hardcoded and not disguised as a quality bar. A future `M4-methodology-v2` could pick different values without this sprint's status logic changing at all.

`RULESET_VERSION` for anything resembling an acceptance threshold is deliberately left unset (`"none-defined"`) this sprint, matching §14's instruction not to invent marketplace-acceptance thresholds — the engine exposes measured facts and is structured to accept a versioned threshold ruleset later without a redesign.

## 10. Reproducibility (§16)

Every validation function is a pure function of its trade-list input plus its documented, versioned parameters — no randomness, no external state, no wall-clock dependence in the computed values (only `startedAt`/`completedAt` vary between runs, exactly mirroring M2/M3's `createdAt` exclusion pattern). Test G proves this directly: running the full suite twice against the same Evidence produces byte-identical output once timestamp fields are excluded. If Monte Carlo or any randomized procedure is introduced in a future sprint, its seed becomes a required provenance field at that point — no such procedure exists in this sprint's engine.

## 11. Regime coverage — an honest limitation, not a gap papered over

The real G01 Evidence's trade records all have `marketRegime: null` — M2/M2.1 never populated this field (no regime classifier exists yet in this research program). `validate_regime_coverage` is built and verified against a synthetic, regime-tagged fixture (proving the logic is correct), but for the real G01 run it correctly reports `INCONCLUSIVE` with an explicit reason, not a fabricated regime breakdown and not a silently-skipped record.

## 12. Parameter sensitivity — built, not executed against G01 this sprint

The comparison framework (`ParameterConfiguration`, baseline-vs-variant diffing) is implemented and tested against synthetic multi-configuration fixtures (Test H). It is **not** run against real G01 data this sprint: doing so for real would require new MT5 backtests with perturbed EA inputs, which is exactly what this sprint's guardrails forbid ("Do not optimize G01. Do not change G01 parameters."). The real validation report records this as `INCONCLUSIVE` with the reason stated plainly, rather than skipping the record or inventing perturbation data.

## 13. Platform-agnosticism (checked, not assumed)

M4 operates exclusively on the M1-schema-shaped Evidence/Trade JSON that any adapter produces — `versionId`, `provenance.*`, `metricsSummary`, and a `trades[]` array with the generic canonical fields (`timestamp`, `symbol`, `direction`, `entryPrice`, `exitPrice`, `volume`, `profit`, `marketRegime`, ...). Nothing in `validation_engine.py` parses an MT5 report, references MT5 field names, or assumes `sourceAdapter == "mt5-deals-table-v1"`. The functions it imports (M2's `compute_metrics`, M3's `verify_evidence_package`) are themselves already adapter-agnostic for the same reason — they were built to consume the canonical Trade shape, not any one source format.

The only place MT5 appears anywhere in this sprint's work is as the **first real test fixture** (§17/§19 — the genuine G01 Evidence, produced by M2.1's `mt5-deals-table-v1` adapter) — a concrete input to prove the engine works, not a design assumption baked into the contract. The synthetic tests in `test_validation_engine.py` deliberately use a generic `sourceAdapter: "synthetic-test-v1"` label (matching M3's own test-fixture convention) precisely to keep this distinction visible: a future adapter for a different platform's report format would flow through the exact same `validate_*` functions with zero changes.

## 14. What M4 explicitly does NOT decide

No AT24 Score. No Trust Status or badge. No marketplace ranking or sort order. No buy/sell/investment recommendation. No claim that G01 (or any system) is "profitable enough," "robust enough," or "ready." No forced agreement between AT24's computed figures and MT5's own report (that boundary was already drawn in M2.1/M3 and is not re-litigated here). No regime classification invented where none exists. No parameter-sensitivity data invented where no perturbation runs were performed.
