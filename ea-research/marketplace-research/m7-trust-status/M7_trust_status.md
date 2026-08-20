# M7 — Trust Status Engine

**Status:** Contract + engine built, tested (synthetic + real). See `M7_trust_status_report.md` for the actual real-G01 result.

**Scope discipline:** M7 answers *"what is the current evidence-based Trust Status of this TradingSystem Version?"* — a description of **evidence state**, never strategy quality. `VALIDATED` does not mean profitable; `INCONCLUSIVE` does not mean bad; `INVALIDATED` does not mean the strategy loses money. No AT24 Score, no risk grade, no star rating, no seller-authored status — anywhere in this sprint.

---

## 1. Status vocabulary — and a deliberate collapse, not a blind implementation

The brief's minimum list is `UNVERIFIED, VERIFIED, VALIDATION_PENDING, VALIDATED, INCONCLUSIVE, LIMITED, INVALIDATED, SUPERSEDED, UNDER_OBSERVATION`, with explicit permission to propose a smaller vocabulary if states overlap (section 5). They do: section 6's own definitions of `VERIFIED` ("Evidence integrity/provenance is verified, but required validation is not yet complete") and `VALIDATION_PENDING` ("Verified Evidence exists, but required Validation is absent/incomplete") describe the same condition. M7's actual observable inputs (a completed M3 result, and either a completed M4 result or none at all — this is a batch pipeline with no "validation in progress" state visible to M7) cannot distinguish "verification just finished, validation never requested" from "validation was requested and is incomplete" — there is no third observable state between them. **`VERIFIED` is therefore dropped as a separate status; `VALIDATION_PENDING` is the surviving name** (more informative — it names what's actually pending). This satisfies Test A's brief-sanctioned either/or (`VERIFIED` or `VALIDATION_PENDING`) directly.

**Final vocabulary (8 states):** `UNVERIFIED`, `VALIDATION_PENDING`, `VALIDATED`, `INCONCLUSIVE`, `LIMITED`, `UNDER_OBSERVATION`, `INVALIDATED`, `SUPERSEDED`.

| Status | Exact meaning | Entry condition |
|---|---|---|
| `UNVERIFIED` | No successful Evidence verification exists for this Version. | M3 status ≠ `VERIFIED`. |
| `VALIDATION_PENDING` | Verified Evidence exists; no Validation result has been supplied yet. | M3 `VERIFIED` and Validation input absent. |
| `INCONCLUSIVE` | Required evidence exists, but Validation and/or RiskAnalysis do not support a definitive stronger state. | M4 `overallStatus` is `FAIL` or `INCONCLUSIVE`, OR M4 passed but RiskAnalysis is missing/`INCONCLUSIVE`/`FAILED`. |
| `LIMITED` | Evidence/Validation are sufficient, but RiskAnalysis is materially incomplete (not simply missing). | M4 `PASS`/`WARNING` and RiskAnalysis `status == PARTIAL`. |
| `UNDER_OBSERVATION` | Evidence, Validation, and RiskAnalysis are all fully satisfied, but only a single historical observation exists — AT24 has not yet watched this Version across more than one point in time. | Would otherwise reach `VALIDATED`, but History shows fewer than 2 recorded observations (section 17's single-observation rule, made an explicit, structural — not business-quality — gate). |
| `VALIDATED` | Evidence verification, Validation, and RiskAnalysis conditions are all satisfied, AND History shows at least 2 independent observations. | M4 `PASS`/`WARNING`, RiskAnalysis `COMPLETE`, ≥2 observations recorded. |
| `INVALIDATED` | Previously usable evidence/validation/risk has been invalidated by a later, verified History event. | An `*_INVALIDATED` History event references the artifact currently under evaluation. |
| `SUPERSEDED` | This Version has been explicitly replaced by another Version, per a recorded History event (never inferred from version numbers). | A `VERSION_SUPERSEDED` History event names this version as superseded. |

## 2. Precedence (section 14) — the exact order, made explicit rather than left implicit in code

1. **Halting conditions first** (raise, never produce a misleading status): input hash mismatch → `INPUT_INTEGRITY_FAILURE`; cross-artifact version mismatch → `VERSION_BINDING_FAILURE`; broken History chain → `HISTORY_INTEGRITY_FAILURE`.
2. `SUPERSEDED` — checked first among status outcomes: a superseded Version's trust state is moot regardless of how good its evidence looked.
3. `INVALIDATED` — checked next: overrides `VALIDATED`/`INCONCLUSIVE`/`LIMITED`/anything else, because an invalidation is a statement that something previously trusted turned out not to be.
4. `UNVERIFIED` — if Evidence itself was never M3-verified, nothing downstream (Validation, RiskAnalysis, History) can rescue a higher state.
5. `VALIDATION_PENDING` — Evidence verified, Validation not yet available.
6. `INCONCLUSIVE` — Validation ran but didn't support a stronger state, or RiskAnalysis is missing/inconclusive.
7. `LIMITED` — Validation supports it, RiskAnalysis is materially incomplete (`PARTIAL`).
8. `UNDER_OBSERVATION` vs. `VALIDATED` — the only distinction between these two is observation count; both require full Evidence+Validation+RiskAnalysis sufficiency.

## 3. Reason codes (section 13, plus documented additions)

Brief's list, used as specified: `EVIDENCE_NOT_VERIFIED`, `VALIDATION_NOT_AVAILABLE`, `VALIDATION_INCONCLUSIVE`, `VALIDATION_COMPLETE`, `RISK_ANALYSIS_MISSING`, `RISK_ANALYSIS_PARTIAL`, `HISTORY_INSUFFICIENT`, `EVIDENCE_INVALIDATED`, `VERSION_SUPERSEDED`, `INPUT_HASH_MISMATCH`, `VERSION_BINDING_FAILURE`, `HISTORY_CHAIN_FAILURE`.

**Documented additions** (needed because the brief's list doesn't distinguish every case this engine's precedence table actually reaches): `VALIDATION_FAILED` (M4 `overallStatus == FAIL` specifically, distinct from `VALIDATION_INCONCLUSIVE` for explanation clarity, though both currently map to Trust Status `INCONCLUSIVE` — see section 1's collapse discussion for why two reason codes can share one status), `VALIDATION_INVALIDATED`, `RISK_ANALYSIS_INVALIDATED` (the `*_INVALIDATED` History event types from M6 applied to Validation/RiskAnalysis specifically, not just Evidence).

## 4. Explanation generation (section 12)

Explanations are built from a fixed template keyed by `reasonCode`, filled in with structured facts (the actual M4 `overallStatus`, M5 `status`, observation count, etc.) — never open-ended prose. `generate_explanation(status, reasonCode, facts)` is a pure string-template function; there is no free-form generation step anywhere in the derivation path.

## 5. Inputs and their required integrity checks (sections 8-10)

M7 requires, per Version being evaluated: an M3 verification result (re-verified fresh, same discipline as M4/M5/M6), an M4 validation result (or explicitly `None`), an M5 RiskAnalysis result (or explicitly `None`), and an M6 History chain. `expected_evidence_hash`/`expected_validation_hash`/`expected_risk_hash`, if supplied, are checked against fresh values (Evidence's own `_contentHash`; a freshly-recomputed validation-result hash reusing M5's `validation_result_hash`; RiskAnalysis's own `riskAnalysisHash`) — mismatch on any → `INPUT_INTEGRITY_FAILURE`. Every artifact's own declared `versionId` must match the Version being evaluated — mismatch → `VERSION_BINDING_FAILURE`. The supplied History chain is verified via M6's own `verify_chain()` — broken → `HISTORY_INTEGRITY_FAILURE`.

## 6. Append-only TrustStatus (sections 18-20)

`TrustStatus` records are never edited. `append_trust_status(chain, ...)` is a pure function (same pattern as M6's `append_event`) that returns a new list with a new record appended, referencing the prior record's id via `previousStatusId`. A status **change** (e.g. `INCONCLUSIVE` → `VALIDATED` after a later, better Validation run) is a new record, not an edit — the timeline stays fully reconstructable (Tests M, P).

## 7. RiskAnalysis and History's roles (sections 15-17) — availability, never numbers, drive status

RiskAnalysis's *numeric* findings (max drawdown 63.01%, negative expectancy) never appear in any status-derivation condition — only whether a RiskAnalysis exists and how complete it is (`COMPLETE`/`PARTIAL`/`INCONCLUSIVE`/`FAILED`, i.e. its *own* already-computed data-quality verdict, itself already free of business thresholds per M5's design) feeds the state machine. Symmetrically, History's *evidence age in days* is never compared to any threshold — only whether an invalidation/supersession event exists, and how many observations have been recorded (compared only against the structural floor of 2, needed to distinguish "one data point" from "more than one," not a business judgment about how many is "enough" to trust).

## 8. Single-observation rule, operationalized (section 17)

G01 has exactly one recorded observation (per M6). This alone cannot push it to `UNDER_OBSERVATION` vs. `VALIDATED` distinction in practice, because M4's real result (`INCONCLUSIVE`) already routes G01 to `INCONCLUSIVE` before observation count is ever consulted (see precedence, §2) — but the `UNDER_OBSERVATION` mechanism is built and proven with a synthetic fixture (Test S) precisely so a *future*, fully-validated G01 observation (hypothetically M4 `PASS` + M5 `COMPLETE`) would not silently become `VALIDATED` on the strength of one data point either.

## 9. TrustStatus record shape — prototype, not a production schema change (section 18/31)

M1's actual Prisma schema has a `TrustStatus` model (`versionId, status, rationale, basedOnValidationIds, basedOnRiskAnalysisId, rulesetVersion, assignedAt, supersededAt`) — genuinely closer to this sprint's needs than M6's HistoryEvent gap was, but still missing `statusContentHash`, `previousStatusId` (M1 uses `supersededAt` timestamp-nulling instead of an explicit link), and direct `evidenceHash`/`validationHash`/`riskAnalysisHash` fields (M1 uses `basedOnValidationIds`/`basedOnRiskAnalysisId` — ids, not hashes, and no evidence hash at all). Per the guardrail, `M1_schema.prisma` and `frontend/prisma/schema.prisma` are both left untouched; `trust_status_engine.py` implements the richer flat-file shape below and documents the gap rather than silently resolving it:

```
TrustStatus (prototype representation)
├── id                  -- = statusContentHash (same "hash serves as identity" convention throughout this program)
├── tradingSystemId
├── versionId
├── status
├── reasonCode
├── explanation
├── evidenceId / evidenceHash
├── validationId / validationHash
├── riskAnalysisId / riskAnalysisHash
├── historyReference    -- the History chain's own tip event id, at the time this status was derived
├── rulesetVersion       -- TRUST_RULESET_VERSION = "none-defined" (section 4 -- no business thresholds frozen)
├── methodologyVersion
├── generatedAt / effectiveAt
├── previousStatusId
├── statusContentHash
└── provenance          -- {engineVersion, inputs summary}
```

**Production migration requirement, stated explicitly:** a real `TrustStatus` table would need `previousStatusId` (an explicit FK, not timestamp-nulling), a `statusContentHash`, and `evidenceHash`/`validationHash`/`riskAnalysisHash` alongside the existing id-based references, to make the same tamper-evidence and hash-integrity guarantees this prototype provides. `ARCH-M1-TRUST-001` — logged here, not silently resolved, alongside the already-known `ARCH-M1-HISTORY-001` (M6) and `M4-BUG-001` (single-year walk-forward `IndexError`, still unpatched per the same guardrail).

**A second, more significant schema gap found while checking the first — `ARCH-M1-TRUST-002`:** M1's own `TrustStatus.status` field comment (written back in Sprint M1, before M4/M5/M6 existed) documents a *completely different* vocabulary: `UNVERIFIED | BACKTEST_VERIFIED | ROBUSTNESS_VERIFIED | PAPER_VERIFIED | LIVE_VERIFIED | AT24_VERIFIED` — an evidence-*tier* ladder (what kind of testing has this system been through), not the evidence-*state* vocabulary this sprint's brief specifies (`VALIDATED`/`INCONCLUSIVE`/`LIMITED`/etc. — what does AT24 currently know and trust about one specific tier of evidence). These are two different, not-obviously-reconcilable axes: a system could plausibly be `LIVE_VERIFIED` (M1's tier axis — it has live evidence) while that live evidence's *current* state is `INVALIDATED` (this sprint's axis — something about it just failed integrity). This is reported here as a genuine open design question for a future schema-reconciliation sprint, not resolved by picking one vocabulary and silently discarding the other — M7's engine uses this sprint's brief's vocabulary throughout, exactly as instructed, and flags rather than papers over the mismatch with M1's original design.

## 10. Platform-agnosticism (checked)

`trust_status_engine.py` never reads `sourceAdapter`, never branches on it, and never touches anything MT5-specific — it consumes only the already-platform-agnostic outputs of M3 (`status`), M4 (`overallStatus`, `versionId`), M5 (`status`, `versionId`, `riskAnalysisHash`), and M6 (event list). Test T sweeps six adapter labels through the full real gate (fresh M3 verification included) to prove this end-to-end, not just at the derivation-function level.

## 11. What Trust Status does NOT decide

No AT24 Score, no Trust Score/number, no risk score, no confidence score, no ranking, no star rating. No seller-authored status (a seller may write a product description; AT24 alone computes `status`/`reasonCode`/`explanation`, and nothing in this engine accepts an externally supplied status value). No MarketplaceListing logic. No investment recommendation. No claim of longitudinal stability from a single observation.
