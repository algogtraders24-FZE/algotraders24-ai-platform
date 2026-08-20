# M3 — Evidence Integrity & Verification Layer

**Status:** Contract + engine built and run against the real M2.1 G01 evidence. See `M3_evidence_verification_report.md` for the actual result.

**Scope discipline:** this document and the engine it describes answer exactly one question — *can AT24 trust the integrity and provenance of an Evidence artifact before passing it downstream?* No profitability judgment, no statistical validity, no OOS/WFA, no robustness, no Trust Status, no Score. Those remain M4/M5/M6/M7, untouched here.

---

## 1. What M3 verifies, and against what input

M3 operates on the **output of M2** — a `{"evidence": {...}, "trades": [...]}` JSON package produced by `evidence_engine.py` — plus two things the package cannot supply about itself: the *current* state of its source artifact (M3.2), and the identity the caller expects this Evidence to be bound to (M3.5). The verifier is **read-only**: it never modifies the Evidence package or the original `.htm` report, and never regenerates or "fixes" anything it finds wrong.

## 2. Evidence identity — and two deliberate judgment calls, documented rather than hidden

M3's brief asks the verifier to check: Evidence ID, TradingSystem ID, Version ID, Evidence type, source artifact, source artifact SHA-256, generator/adapter, generator version, created timestamp, content hash. Two of these don't map onto the M2.1 artifact's actual shape one-for-one, because M1's schema is normalized and M2 is a pre-database flat-file prototype. Rather than silently inventing fields or silently failing real evidence that has nothing wrong with it, both gaps are resolved explicitly here:

- **Evidence ID.** M1's `Evidence` model has a database-assigned `id` (`@id @default(cuid())`). M2's flat-file prototype never had a database to assign one from. The content hash (`_contentHash`) already serves as a unique, immutable identity key for the artifact — every Evidence file is already named and addressed by it. M3 treats `_contentHash` as the Evidence ID. This does **not** modify the existing M2 artifact (the field was already there); it's a naming decision in how M3 reads it.
- **TradingSystem ID.** M1's schema deliberately does *not* store `tradingSystemId` redundantly on `Evidence` — it's reachable transitively via `Evidence.versionId → Version.tradingSystemId` (normalized design, not an oversight). M2's artifact correctly reflects this: it has `versionId`, not `tradingSystemId`. Since there is no real Version/TradingSystem database yet, M3 introduces a small, separate **version registry** (`version_registry.json`, not part of the Evidence artifact) that stands in for that future table — it maps a `versionId` to its `tradingSystemId` and a human name. The "TradingSystem ID" check passes when the Evidence's `versionId` resolves to a registry entry; it does not invent or write a `tradingSystemId` field onto the Evidence itself.

## 3. Provenance completeness — hard-required vs. soft-required, and why

The brief lists commission, swap, and spread assumptions as required provenance alongside broker/symbol/timeframe/period. Taken as a flat list where every field must be non-null, the *real* G01 evidence would fail — because M2 (correctly, per M0.1 principle 2: never guess) left `spreadModel`, `commissionModel`, `swapModel`, and `tickDataQuality` as explicit `null` when the source `.htm` report doesn't expose a model/description for them. Forcing these to non-null would mean either fabricating a value (violating M0.1) or the real evidence failing M3.9 despite nothing being wrong with it. Both are worse than stating the resolution plainly:

- **Hard-required (missing/null → verification FAILS):** `dataSource.reportFile`, `dataSource.reportFileSha256`, `broker`, `symbol`, `timeframe`, `periodStart`, `periodEnd`, `executionAssumptions.initialDeposit`, `generatedBy`, `sourceAdapter`. These are always knowable from a real backtest run; their absence means something is actually wrong with the Evidence.
- **Soft-required (must exist as a field; `null` is accepted and recorded as a warning, never a failure, and never silently dropped from the report):** `spreadModel`, `commissionModel`, `swapModel`, `tickDataQuality`. Actual per-trade commission and swap *values* (as opposed to a model/description) are separately verified to exist in §5 (Trade consistency) — so cost data is not actually missing from this Evidence, only a textual description of the cost *model* is, which the source report genuinely doesn't provide.

This distinction is a judgment call made to resolve a real tension in the brief, not a relaxation slipped in quietly — it's stated here and repeated in the audit report's own output.

## 4. Source artifact integrity (M3.2)

The verifier is given the *current* path to the source artifact (it cannot discover this from the Evidence package, which only stores the artifact's filename + the SHA-256 it had at generation time). It recomputes SHA-256 of the file at that path right now and compares to `provenance.dataSource.reportFileSha256`. Any mismatch is `FAIL — SOURCE_ARTIFACT_MISMATCH`, and the verifier does not attempt to regenerate or replace anything.

## 5. Evidence ↔ Trade consistency (M3.3)

Checked per-trade and in aggregate: trade count matches `metricsSummary.tradeCount`; no duplicate trade identity (deals-table evidence identifies a trade by its `(entryDealId, exitDealId)` pair — the actual MT5 deal tickets — which is a stronger identity than a synthetic row number); every required field (`timestamp`, `symbol`, `direction`, `entryPrice`, `exitPrice`, `volume`, `profit`) is present and non-null; `direction` is one of the allowed values; `volume > 0`; prices are positive finite numbers; `profit` is finite (not NaN/Inf).

One deliberate adaptation: M2.1's persisted Trade shape stores a single `timestamp` (the close time) plus `durationSeconds`, not separate entry/exit timestamps (that's what M2 actually assembles — see `reconcile_deals_to_trades`). "Entry precedes exit" is therefore checked via `durationSeconds >= 0`, which is the information the artifact actually carries and is mathematically equivalent (duration was computed as `exit_time - entry_time`; a negative value means exit was recorded before entry).

## 6. Independent metric reconciliation (M3.4)

Metrics are recomputed from the Evidence package's own `trades` array — independent of whatever process originally wrote `metricsSummary` — and compared against the stored (hash-protected) `metricsSummary`. This reuses M2's `compute_metrics` formula module rather than a second, differently-written implementation: the goal here is catching **data tampering** (someone edited `trades` or `metricsSummary` after generation) via disagreement with a formula everyone already agrees is correct and has been validated against the real MT5 report (see M2.1's cross-check) — not re-auditing whether the formula itself is right, which is a separate, already-covered concern (M2's own test suite). AT24-internal agreement (stored vs. recomputed) uses a tight tolerance (0.01 on currency figures, exact on trade count). The separate MT5-report comparison inherited from M2.1 remains informational only, with its already-documented, methodologically-explained deltas (gross vs. net, Sharpe convention) — M3 does not force AT24 numbers toward MT5's, and does not re-litigate deltas M2.1 already explained.

## 7. Version binding (M3.5)

Checked two ways:
1. **Declared identity vs. expectation.** The caller states which `versionId` it expects this Evidence to belong to (exactly how a real ingestion step would invoke this — it already knows which Version record it's attaching Evidence to). A mismatch is an immediate `FAIL`.
2. **Trade-array substitution.** M1's schema does not give `Trade` its own redundant `versionId` (it's reachable transitively via `Trade.evidenceId → Evidence.versionId`, same normalization reasoning as §2). So a trades array silently swapped in from a different Version's Evidence cannot be caught by inspecting a per-trade field that doesn't exist — it's caught because the swapped-in trades will disagree with the original (hash-protected) `metricsSummary` on reconciliation (§6) and/or trade count (§5). This is exercised directly by a dedicated synthetic test (Test E) that constructs exactly this scenario and confirms the verifier's *combination* of checks catches it, since no single field-level check can.

## 8. Hash / immutability verification (M3.6)

The verifier recomputes the same content hash M2 uses (same exclusion rule: `createdAt` and the hash field itself are excluded from the hashed payload, since they're run metadata, not content) and compares to the stored `_contentHash`. Any difference is `FAIL`. A single-field mutation test (changing `netProfit` by one cent) confirms the hash function is actually sensitive to the content it claims to protect.

## 9. Result shape (M3.8)

```
EvidenceVerification
├── evidenceId          (= _contentHash, see §2)
├── verifiedAt
├── verifierVersion
├── sourceArtifactVerified
├── provenanceVerified
├── tradeIntegrityVerified
├── metricIntegrityVerified
├── versionBindingVerified
├── hashVerified
├── status               VERIFIED | FAILED   (no other values — no GOOD/BAD/PROFITABLE/HIGH_QUALITY)
├── failures[]
└── warnings[]           (soft-required provenance gaps only — see §3; never affects status)
```

`warnings[]` is one field beyond the brief's literal list, added to carry the §3 soft-required disclosures without either hiding them or turning them into failures. It never influences `status`.
