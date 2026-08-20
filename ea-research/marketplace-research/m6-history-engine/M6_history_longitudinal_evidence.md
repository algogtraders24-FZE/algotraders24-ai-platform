# M6 — History & Longitudinal Evidence Engine

**Status:** Contract + engine built, tested (synthetic + real). See `M6_history_report.md` for the actual real-G01 result.

**Scope discipline:** M6 answers *"what did AT24 know, when did it know it, and what evidence supported that knowledge?"* — never *"is this system trustworthy/good/improving."* `HistoryEvent` is an append-only observation log, not an interpretation layer. No Trust Status, no AT24 Score, no marketplace ranking anywhere in this sprint.

---

## 1. Purpose

Given the artifacts M2 (Evidence), M3 (Verification), M4 (Validation), and M5 (Risk Analysis) already produced, M6 builds an immutable, hash-chained, append-only record of *when* AT24 observed each of those facts, and provides the primitives needed to reconstruct "what AT24 knew as of time T" and to compare observations over time — without ever inventing a trend from data that doesn't support one.

## 2. HistoryEvent contract — and what's a prototype stand-in

Per the brief: "only fields that actually exist in the M1 contract should be treated as frozen... document stand-ins explicitly rather than modifying production schema." M1's `HistoryEvent` (from `M1_schema.prisma`) is genuinely minimal: `id`, `versionId`, `eventType`, `referenceId`, `occurredAt`. Everything richer this sprint needs — `previousEventHash` for chain integrity, `contentHash` for tamper evidence, the `observedAt`/`recordedAt` split, and direct `evidenceId`/`validationId`/`riskAnalysisId` references instead of one generic `referenceId` — **does not exist in the frozen M1 Prisma schema and is not added to it here.** `frontend/prisma/schema.prisma` is untouched, and `M1_schema.prisma` is untouched too (modifying either would violate this sprint's guardrail without a prior M1-revision sprint explicitly authorizing it).

Instead, `history_engine.py` implements a **flat-file prototype representation** with the richer shape below, documented here as exactly that — a prototype, not a schema change:

```
HistoryEvent (prototype representation)
├── historyEventId       -- = contentHash (same "hash serves as identity" convention as M3's Evidence.id)
├── tradingSystemId
├── versionId
├── evidenceId            -- nullable, populated when eventType references Evidence
├── validationId           -- nullable
├── riskAnalysisId         -- nullable
├── eventType
├── observedAt             -- when the underlying fact occurred (section 7)
├── recordedAt             -- when AT24 recorded this event (section 7)
├── source                 -- the engine/adapter that produced the referenced artifact
├── sourceHash             -- the referenced artifact's own content hash
├── payload                -- event-specific facts (dict)
├── previousEventId         -- chain link (section 10)
├── previousEventHash        -- same value as previousEventId in this prototype (id IS the hash here); kept as a separate field for schema-conceptual completeness, since a real DB-assigned id and a content hash need not coincide
├── rulesetVersion
├── methodologyVersion
├── createdBy
└── contentHash             -- = historyEventId
```

**Future production migration requirement, stated explicitly (not silently implemented):** a real `HistoryEvent` table would need `previousEventHash`, `contentHash`, `observedAt` (`occurredAt` alone conflates the two timing facts), and either three nullable FK columns (`evidenceId`/`validationId`/`riskAnalysisId`) or a widened `referenceId` convention. This is a genuine, reportable gap between M1's frozen schema and what longitudinal integrity actually needs — flagged here, not resolved by silently editing M1.

## 3. Platform-agnosticism (checked, not assumed)

Same discipline as M4/M5: `history_engine.py` never references MT5, HTML parsing, or MetaQuotes fields. It operates on `tradingSystemId`/`versionId` strings and the content hashes/provenance already produced by M2-M5 for *any* adapter. Test S sweeps six adapter labels (MT5 EA, MT4 EA, cTrader cBot, NinjaTrader Strategy, crypto bot, AI trading engine) through the identical event-creation and chain-verification code with zero branching.

## 4. Append-only discipline (section 4)

`append_event()` is a pure function: given an existing chain (a list) and new event data, it returns a **new list** with the new event appended — it never mutates a stored event in place, and no function in this module accepts "edit event N" as an operation. `check_event_immutability()` exists specifically to prove this: given an original event and a would-be edited version sharing the same `historyEventId`, it raises `ImmutabilityFailureError` if the content actually differs (Test C). Corrections and invalidations are new events (`CORRECTION_RECORDED`, `EVIDENCE_INVALIDATED`, etc.) that *reference* the original event's id — the original is never touched.

## 5. Event vocabulary (section 6)

`SYSTEM_CREATED`, `VERSION_CREATED`, `EVIDENCE_ADDED`, `EVIDENCE_VERIFIED`, `VALIDATION_COMPLETED`, `RISK_ANALYSIS_COMPLETED`, `EVIDENCE_INVALIDATED`, `VALIDATION_INVALIDATED`, `RISK_ANALYSIS_INVALIDATED`, `VERSION_SUPERSEDED`, `VERSION_WITHDRAWN`, `OBSERVATION_RECORDED`, `CORRECTION_RECORDED`. `create_event()` rejects any `eventType` outside this set — no `TRUSTED`/`GOOD`/`BAD`/`PROFITABLE`/`SAFE` exists anywhere in the vocabulary or the code.

## 6. observedAt vs. recordedAt (section 7)

`observedAt` = the fact's own timestamp (e.g. an Evidence's `provenance.periodEnd` for an `EVIDENCE_ADDED` event, or the moment a Validation/RiskAnalysis actually completed for those event types). `recordedAt` = when AT24's history engine wrote this event down. For G01, these differ by roughly nine years (backtest data through 2026-07/08, ingested into this History chain on 2026-08-19) — exactly the brief's own worked example, and the real report states both explicitly rather than collapsing them.

## 7. Hashing and reproducibility — a deliberate departure from M2-M5's timestamp-exclusion pattern

M2 through M5 all exclude their own `createdAt`/`generatedAt`/`startedAt`/`completedAt` fields from content hashing, because those fields record *when a re-runnable pipeline stage happened to execute* — irrelevant to whether the computed content is the same. **M6 does the opposite on purpose: `recordedAt` (and `observedAt`) ARE included in the event's content hash.** An append-only history log's entries are not idempotent re-runs of a calculation; `recordedAt` is part of what makes one event a distinct, genuine historical entry rather than a duplicate of another. Reproducibility (Test R) is therefore defined as: *given the same explicit `observedAt`/`recordedAt` inputs* (supplied by the caller, not auto-stamped from the wall clock inside the engine), the same event content produces the same hash — not that the hash is time-invariant. This is stated here precisely because it is the opposite convention from every prior sprint in this program, and that asymmetry needs to be visible, not silently inconsistent.

## 8. Chain integrity (section 10)

One hash-chain per `tradingSystemId` (not per version — `VERSION_CREATED`/`VERSION_SUPERSEDED` events must live in the same chain as the versions they relate, per section 12). `verify_chain(events)` performs two independent checks per event: (a) recomputing its own `contentHash` from stored fields and comparing to `historyEventId` (catches direct tampering of a single event), and (b) confirming `previousEventId`/`previousEventHash` matches the immediately preceding element *in the list as given* (catches deletion, insertion, and reordering — Tests E/F/G each construct a different one of these three corruption modes against the same function). Check (b) also catches a "tamper-and-re-sign" attack on a middle event that check (a) alone would miss (mutate event N's payload *and* recompute its own hash to match — internally self-consistent, but event N+1's `previousEventHash` still points at the original, un-mutated hash).

## 9. Version separation and binding (sections 12/13, Tests H/I)

Events for different Versions of the same TradingSystem coexist in one chain but are always distinguishable by `versionId` — nothing in this engine merges or inherits Evidence/Validation/RiskAnalysis across a version boundary (consistent with M0.1 principle 10, already enforced upstream at M1). `record_version_binding_check()` is the explicit guard: recording an `EVIDENCE_ADDED` event under `versionId=V2` using an Evidence artifact whose own `versionId` field says `V1` raises `VERSION_BINDING_FAILURE` immediately — the same "does the artifact's own declared identity match the context it's being used in" discipline M3/M4/M5 already apply to their own inputs.

## 10. Invalidation and correction (sections 14/15, Tests J/K)

Both are ordinary new events (`EVIDENCE_INVALIDATED`, `VALIDATION_INVALIDATED`, `RISK_ANALYSIS_INVALIDATED`, `CORRECTION_RECORDED`) whose `payload` references the original event's `historyEventId` plus a reason. The original event is never removed from the chain or altered — both remain independently queryable, which is the entire point of an audit trail.

## 11. Longitudinal metrics, evidence age, gaps, cadence (sections 16-19)

All exposed as **facts with units** (`"127 days since last verified Evidence"`), never as a score. `compute_evidence_age()` takes an explicit `reference_time` parameter (never the wall clock implicitly, so results stay reproducible in tests) and reports `ageDays` with no expiration judgment. `detect_history_gaps()`/`analyze_cadence()` report the longest/median/average interval between recorded observations and flag `HISTORY_GAP` where relevant — again, a fact, not a verdict; nothing here decides a gap is "too long."

## 12. Change detection: version-aware, comparability-checked (sections 20-23, Tests O/P/Q)

`detect_change(evidence_a, risk_a, evidence_b, risk_b)` is the single function serving all three: it first checks whether the two observations share a `versionId` (if not: `VERSION_CHANGE`, never treated as ordinary drift — section 21's explicit distinction), then checks comparability (`symbol`, `timeframe`, `sourceAdapter` family, `dataSource` kind — if any hard mismatch: `NOT_DIRECTLY_COMPARABLE` with reasons listed, never a forced/normalized comparison), and only when both checks pass does it compute `METRIC_CHANGE` (previous/new/delta/pctChange for PF, drawdown, expectancy — reported plainly, with no automatic good/bad label).

## 13. Real G01: one observation, stated as exactly that (section 24/28)

G01 currently has exactly one genuine, independently verified Evidence/Validation/RiskAnalysis chain (the frozen v0.1 baseline). This sprint does **not** invent a second observation, a live/forward-test data point, or a synthetic "improvement" to demonstrate longitudinal features against real data — those features (gap detection, cadence, change detection) are proven correct against synthetic multi-observation fixtures in the test suite instead, and the real report states plainly: *"single verified historical observation; longitudinal performance history not yet established."* This is section 28's hard rule, applied literally.

## 14. What History does NOT decide

No Trust Status, no Trust Badge, no AT24 Score, no Risk Score, no marketplace ranking, no seller reputation, no buyer reviews, no profitability guarantee, no investment recommendation, no automatic strategy selection, no production Prisma migration, no marketplace UI, no live broker connection or live trading, no new G01 backtest, no parameter optimization.
