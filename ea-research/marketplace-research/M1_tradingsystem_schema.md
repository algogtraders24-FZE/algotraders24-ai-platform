# M1 — TradingSystem Schema

**Status:** DRAFT — data model only, authorized by [M0.1_product_model_freeze.md](M0.1_product_model_freeze.md). Not wired to any database (frontend's live `frontend/prisma/schema.prisma` is untouched — see §5 for why). The companion file [`M1_schema.prisma`](M1_schema.prisma) is the literal schema artifact; this document is the rationale and invariants behind it.

**Question this document answers, and only this question (per M0.1 sign-off):**
> What data must AT24 persist so that the frozen product model can exist and be audited?

It does **not** answer what score a system gets or what threshold makes a system verified — those are M4/M5/M6 decisions and are deliberately left as versioned, swappable rule-engine inputs rather than hardcoded logic or schema constraints (see §4).

---

## 1. Entity map (follows the frozen chain exactly)

```
TradingSystem ──< Version ──< Evidence ──< Trade
                     │            │
                     │            └──< Validation
                     │
                     ├──< RiskAnalysis
                     ├──< HistoryEvent      (append-only ledger)
                     ├──< TrustStatus       (append-only, "current" = latest)
                     ├──< Score             (append-only, "current" = latest)
                     └──< MarketplaceListing (0 or 1 active)
```

Every entity below `Version` exists to be independently queryable and independently auditable — per M0.1's core rule, the chain is not `TradingSystem → Score`, so nothing here collapses layers into a single denormalized "results" blob. A future third-party-submitted system flows through the exact same tables; nothing is AT24-owner-special-cased (principle 12).

---

## 2. Entities

### TradingSystem
The identity-bearing root. Owns **zero** performance data — everything performance-related lives at or below `Version`.

| Field | Notes |
|---|---|
| `id`, `slug`, `name` | Identity |
| `ownerId` | FK to a seller/owner (see §5 — reuses the existing platform `User`, does not fork a parallel identity system) |
| `strategyCategory` | Free-text/enum tag (trend-following, mean-reversion, liquidity-sweep, ...) — descriptive only, not a validation input |
| `description`, `shortDescription` | **Seller-controlled** (M0.1 §3 boundary) |
| `platform` | MT4 / MT5 / other |
| `status` | Lifecycle of the system record itself: `DRAFT`, `ACTIVE`, `ARCHIVED` — distinct from any Version's Trust Status and distinct from a Listing's publication status |
| `currentVersionId` | Convenience pointer to the latest Version; not authoritative (Version history is the source of truth) |

### Version
An **immutable** snapshot of the strategy at a point in time. Nothing carries forward from the prior version automatically (M0.1 principle 10) — a new Version starts with zero Evidence, zero Validation, zero Trust Status.

| Field | Notes |
|---|---|
| `id`, `tradingSystemId`, `versionString` | e.g. `v1.0`, `v2.0` |
| `parentVersionId` | Nullable — lineage pointer only, never implies evidence inheritance |
| `strategyDefinition` | JSON: entry/exit logic reference, parameter set, artifact pointer/hash — **seller-authored** technical description |
| `declaredRiskModel` | JSON: risk-per-trade, max trades/day, SL/TP geometry as *declared by the seller* — explicitly distinct from `RiskAnalysis`, which is AT24-computed from actual Evidence. A system can declare one risk model and have Evidence reveal a different realized one; both must be visible, not merged. |
| `supportedInstruments`, `supportedTimeframes`, `executionModel` | Descriptive/seller-authored |
| `artifactHash` | Reserved for M14 (integrity/security) — not enforced yet, but the field exists so M14 doesn't require a migration |
| `status` | `DRAFT`, `FROZEN` (immutable, evidence may attach), `DEPRECATED` |
| `createdAt` | Immutable once `FROZEN` |

### Evidence
A structured, provenance-tagged performance record. **Immutable once generated** (M0.1 principle 2 — no update endpoint, only create). This is the direct fix for MQL5 Market's core failure: a backtest screenshot in a free-text description.

| Field | Notes |
|---|---|
| `id`, `versionId` | Always bound to exactly one Version (principle 10) |
| `evidenceClass` | `HISTORICAL` \| `LIVE` (principle 5 — never merged) |
| `source` | `BACKTEST` \| `PAPER` \| `LIVE_ACCOUNT` |
| `provenance` | JSON, **mandatory**: dataSource, broker, symbol, timeframe, periodStart, periodEnd, spreadModel, commissionModel, swapModel, tickDataQuality, executionAssumptions (M0.1 principle 7 — no metric is ever displayed without this traveling alongside it) |
| `generatedBy` | Which AT24 process/engine produced this (e.g. `AT24-MT5-Tester-v1`) — the reproducibility claim from principle 2 lives here: Evidence not traceable to a named, versioned generator process cannot be trusted the same way |
| `metricsSummary` | JSON: netProfit, returnPct, profitFactor, winRate, avgTrade, maxDrawdown, recoveryFactor, sharpe, sortino, expectedPayoff, largestWin/Loss, consecutiveWins/Losses, tradeCount (M2 scope) |
| `curves` | Pointer/blob ref to equity/balance/drawdown curve series + monthly/yearly rollups |
| `immutable` | Enforced at the application/write layer, not just a convention |

### Trade
Trade-level detail (M3). Only present for Evidence that includes it — not every Evidence record needs trade-level granularity (e.g. a coarse third-party-submitted summary might not, and that absence is itself meaningful — see §4).

| Field | Notes |
|---|---|
| `id`, `evidenceId` | |
| `timestamp`, `symbol`, `direction` | |
| `entryPrice`, `exitPrice`, `sl`, `tp`, `volume` | |
| `profit`, `rMultiple`, `durationSeconds` | |
| `marketRegime` | Nullable tag — feeds M4 Layer 6 (regime validation) |

### Validation
The record of running one Evidence record through one check layer (M4). Always tied to a specific Evidence — never to a seller's description of that evidence.

| Field | Notes |
|---|---|
| `id`, `evidenceId` | |
| `layer` | `DATA_INTEGRITY` \| `STATISTICAL_VALIDITY` \| `OUT_OF_SAMPLE` \| `WALK_FORWARD` \| `PARAMETER_ROBUSTNESS` \| `REGIME_VALIDATION` — the layer *names* are fixed by the M4 spec already agreed; the pass/fail *thresholds* inside each layer are not (see §4) |
| `result` | `PASS` \| `FAIL` \| `NOT_APPLICABLE` |
| `measuredValues` | JSON — actual numbers produced by the check |
| `thresholdsUsed` | JSON **snapshot** of whatever thresholds were applied at run time — required because thresholds are explicitly unfrozen and will change; old Validation rows must stay individually correct even after the ruleset moves on |
| `rulesetVersion` | Which versioned threshold-ruleset produced this result (traceability without freezing the numbers now) |
| `auditTrail` | Human-readable explanation of why it passed/failed (principle 8) |
| `runAt` | |

### RiskAnalysis
AT24-computed robustness/anti-overfitting analysis (M5), scoped to a Version (it synthesizes across that Version's Evidence, not a single run).

| Field | Notes |
|---|---|
| `id`, `versionId` | |
| `monteCarloSummary` | JSON: drawdown distribution, losing-streak distribution, probability-of-ruin estimate, return distribution |
| `parameterPerturbationSummary` | JSON: performance across the parameter neighborhood |
| `stressTestSummary` | JSON: spread stress (+25/+50/+100%), slippage stress |
| `dataWindowStabilitySummary`, `marketRegimeStabilitySummary` | JSON |
| `rulesetVersion` | Same traceability pattern as Validation — the classification logic is swappable |
| `computedAt` | |

### HistoryEvent
Append-only ledger per Version. This is what makes "History" a real layer in the chain rather than a synonym for "look at the Evidence table" — it's the thing that lets Trust Status reason about *duration and cadence* (echoing MQL5 Signals' own "watch 2-4 weeks" caveat and Darwinex's trailing-window Experience attribute), and it's the mechanism that makes principle 8's audit trail global rather than per-record.

| Field | Notes |
|---|---|
| `id`, `versionId` | |
| `eventType` | `EVIDENCE_ADDED` \| `VALIDATION_RUN` \| `RISK_ANALYSIS_RUN` \| `TRUST_STATUS_CHANGED` \| `LISTING_STATUS_CHANGED` |
| `referenceId` | FK to the specific row this event documents |
| `occurredAt` | |

### TrustStatus
AT24-computed classification, scoped to a Version, **never seller-set** (principle 11). Modeled as an append-only log — a system's trust status can move (including backward, if new Evidence contradicts old), and every past assignment must remain inspectable, not overwritten.

| Field | Notes |
|---|---|
| `id`, `versionId` | |
| `status` | `UNVERIFIED` \| `BACKTEST_VERIFIED` \| `ROBUSTNESS_VERIFIED` \| `PAPER_VERIFIED` \| `LIVE_VERIFIED` \| `AT24_VERIFIED` — labels only, fixed by the M7 spec; qualification *rules* for each label are not decided here |
| `rationale` | Text — why this status, referencing which Validation/RiskAnalysis rows justified it |
| `basedOnValidationIds`, `basedOnRiskAnalysisId` | Traceability |
| `rulesetVersion` | Which trust-qualification ruleset decided this |
| `assignedAt`, `supersededAt` | `supersededAt IS NULL` → currently active |

### Score
AT24 Score (M6) — the interpretation layer, explicitly last in the chain. Also append-only for the same reason as TrustStatus.

| Field | Notes |
|---|---|
| `id`, `versionId` | |
| `scoreValue` | Headline number |
| `subScores` | JSON: performance, risk, robustness, consistency, validation, sampleSize, liveEvidence — the *dimensions* named in the original M6 sketch; weights/formula not decided here |
| `basedOnTrustStatusId` | |
| `formulaVersion` | Same versioned-ruleset pattern |
| `computedAt`, `supersededAt` | |

### MarketplaceListing
The buyer-facing publishable object (M9). References a TradingSystem and points at whichever Version is currently published — Evidence/Validation/Score always stay attached to that Version, never copied into the listing as editable text.

| Field | Notes |
|---|---|
| `id`, `tradingSystemId`, `publishedVersionId` | `publishedVersionId` nullable until actually published |
| `title`, `description`, `category`, `supportedMarkets`, `supportedTimeframes`, `media` | **Seller-controlled** |
| `pricing` | JSON placeholder — M13 economics deliberately not modeled beyond "a slot exists" |
| `publicationStatus` | `DRAFT` → `SUBMITTED` → `UNDER_REVIEW` → `VALIDATION` → `APPROVED` → `PUBLISHED`, or → `REJECTED` (with `rejectionReason`) |
| `performanceSummary`, `riskProfileSummary`, `trustStatusSummary` | **Read-only projections** computed from the published Version's Evidence/RiskAnalysis/TrustStatus at render/publish time — never independently editable listing copy |

---

## 3. Invariants enforced by this schema (traceable to M0.1)

- A `Version` cannot be `PUBLISHED` via a `MarketplaceListing` without at least one `Evidence` row and at least one `Validation` row with `layer IN (DATA_INTEGRITY, STATISTICAL_VALIDITY)` and `result = PASS` (M0.1 §3, "What makes a system eligible for publication?").
- `Evidence.metricsSummary`, `RiskAnalysis.*`, `TrustStatus.status`, and `Score.scoreValue` have **no seller-writable path** in the application layer — only AT24 engine processes may write them. `MarketplaceListing.title/description/media/pricing` are the only seller-writable surface (M0.1 §3, seller/AT24 boundary — matches the exact split the user signed off).
- `Evidence.evidenceClass` (`HISTORICAL`/`LIVE`) is never collapsed into a single "performance" number without the class traveling with it (principle 5).
- `TrustStatus` and `Score` are append-only; "current" is always "latest non-superseded row," never an in-place update — this is what lets a later audit reconstruct exactly what a buyer saw at purchase time, even after the ruleset evolves.
- Every `Validation` and `RiskAnalysis` row snapshots the `rulesetVersion`/`thresholdsUsed` it ran under, so tightening a threshold later never silently rewrites historical verdicts.

---

## 4. Explicitly NOT decided here (per M0.1 and the user's direct instruction)

- The actual numeric thresholds inside `thresholdsUsed` for any Validation layer.
- OOS/walk-forward split ratios, curve-fit/robustness pass criteria.
- The rules that map a set of Validation/RiskAnalysis results to a specific `TrustStatus.status` value.
- The `Score` formula/weights across `subScores`.
- `MarketplaceListing.pricing` structure beyond "a JSON slot exists" — seller fees/revenue share (M13) untouched.
- Ranking/sort algorithm for discovery (M11) — out of scope for a schema sprint entirely.

These are intentionally represented as **versioned, swappable ruleset references** (`rulesetVersion`, `formulaVersion`) rather than either hardcoded logic or schema-level constraints, so M4/M5/M6 can be designed and iterated on later without another schema migration.

---

## 5. Relationship to the existing codebase (context, not a decision)

`frontend/prisma/schema.prisma` already has a `Product` model (category `mt5-expert-advisors`, price, rating, downloads, featured, etc.) — this is the current public `/products` marketing catalog (Sprint D2.4), not the evidence/trust pipeline described here. It is a simpler, seller-narrated listing with no Evidence/Validation/TrustStatus concept at all — structurally it's closer to the MQL5 Market model this whole program exists to move past. This M1 schema is deliberately kept as a **standalone draft** (`M1_schema.prisma`, not merged into `frontend/prisma/schema.prisma`) rather than touching the live application database — reconciling or migrating the existing `Product` catalog into this model is a future integration decision, not part of M1, and should not be assumed either way without the user weighing in when it's actually time to wire this into the running app.

`TradingSystem.ownerId` / seller identity is modeled as a reference to the platform's existing `User` model rather than a parallel identity table — no reason found in the M0 research or M0.1 freeze to fork a separate seller-identity system, and principle 12 (future third-party sellers) is satisfied by `User.role` gaining a seller capability later, not by a new user table.

---

## 6. Next step

M2 — Backtest Evidence Engine builds the actual generator that produces `Evidence` rows (`source = BACKTEST`) with real `metricsSummary`/`provenance`/`curves` data — starting naturally from G01's existing backtest telemetry (`AT24_G01_ResearchLog.csv`, native MT5 `.htm` reports) as the first real data source to map into this schema.
