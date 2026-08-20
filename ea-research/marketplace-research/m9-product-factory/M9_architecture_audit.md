# M9 — Architecture Audit (section 1 deliverable)

**Status: audit complete. No Prisma changes proposed as a result — see the finding in §5 below.**

---

## 1. Current `MarketplaceListing` model (read directly from `frontend/prisma/schema.prisma`, live in production since M8.1)

Confirmed present exactly as M8 designed it: `id, slug, sellerId, title, description, media, pricing, category, platformTag, assetTag, tags, tradingSystemId, versionId, evidenceId, evidenceHash, validationId, validationHash, riskAnalysisId, riskAnalysisHash, trustState, trustReasonCode, trustExplanation, trustStatusId, lastEvidenceAt, publicationState, createdAt, updatedAt, deletedAt`.

## 2. Current APIs

- `GET /api/marketplace/search` (public) — real search/filter/sort/pagination against `PUBLICLY_VISIBLE_STATES` (`READY`, `PUBLISHED`).
- `GET /api/private/marketplace/listings` (auth-gated) — caller's own listings, all states.
- `PATCH /api/private/marketplace/listings/[id]` (auth-gated, ownership-checked) — seller-mutable fields only (`title, description, media, pricing, category, platformTag, assetTag, tags`), enforced by `evaluateListingMutation` in `services/marketplace/listingMutationGuard.ts`, which explicitly rejects every AT24-controlled field (`trustState, evidenceId, validationId, riskAnalysisId, publicationState, tradingSystemId, versionId, lastEvidenceAt, sellerId, id, slug`) with `FORBIDDEN_FIELD`.
- No `POST` (create) endpoint exists yet — confirmed in M8's own file header comment: deliberately absent to guarantee no path could create a real listing during M8/M8.1.

## 3. Current pages

`/marketplace` (catalog), `/marketplace/[slug]` (detail) — both real, both regression-tested through M8.1, both currently serving 0 real listings. No `/marketplace/sell` or seller dashboard page exists yet.

## 4. Is M8's reference-only ID design sufficient for the Factory? — Yes, with one addition

M8's `evidenceId`/`validationId`/`riskAnalysisId`/`trustState` etc. are correctly reference-only (M8_entity_relationship.md §3 already established this — no duplication of Evidence/Validation/Risk/History/Score content). What M8 did **not** yet build is a *mechanism that populates those references from a real source* — M8/M8.1 never wrote anything into them (every listing created during M8/M8.1 testing left them `null`, by design, since no real TradingSystem existed). **This is exactly M9's job**: the Factory's ingestion pipeline is the first real writer of those fields. No field is missing from the schema for this purpose — confirmed by walking through §7-13 of the M9 brief against the existing column list, field by field.

## 5. Finding: no new Prisma model is required for M9 — reusing two existing ones

Two things M9 needs (a submission workflow-state concept, and an audit trail) initially looked like they might need new tables. On inspection, both are already covered:

- **Audit trail (§19):** `AuditLog` (`id, actorUserId, action, targetType, targetId, metadata Json?, createdAt`) already exists, is already append-only by design (no update path, no `deletedAt`), and is already used by `services/admin/AuditLogService.ts` for exactly this kind of event log. `AuditAction` there is a closed string union — extending it with new `marketplace.*` action names is an additive TypeScript change, not a schema change. Reused directly rather than building a parallel table.
- **Submission lifecycle state (§5 of the brief):** re-examined against `MarketplaceListing`'s existing columns and found to be fully **derivable** from them (`evidenceId` presence → past `INGESTION_PENDING`; `validationId` presence → past `EVIDENCE_PENDING`; `riskAnalysisId` presence → past `VALIDATION_PENDING`; `trustState` presence → past `RISK_ANALYSIS_PENDING`/`TRUST_PENDING`; `publicationState` for `PUBLISHED`/`UNPUBLISHED`) rather than needing a new persisted column. A derived value can never drift from the fields it's derived from, which is a stronger correctness property than a redundant stored column would have had.

**Conclusion: M9 requires zero new Prisma models and zero migration.** This is stated here explicitly, per §25/§33's "STOP before applying, report the exact migration" instruction — the honest report is that no migration is being proposed, not merely that none was applied. If this conclusion turns out to be wrong once the ingestion pipeline is actually built, that will be reported as a discovered requirement, not silently worked around.

## 6. The one real cross-boundary gap: no machine-readable snapshot of M3-M7's G01 result exists

M3's `verify_evidence_package`, M4's `run_validation_suite`, M5's `run_risk_analysis`, and M7's `derive_trust_status` are real, working, deterministic Python functions — but their `run_real_*.py` driver scripts only ever wrote **Markdown reports** for human reading (`M3...md` doesn't even exist as a separate file — M3's real report is embedded in M6/M7's reports; `M4_validation_report.md`, `M5_risk_analysis_report.md`, `M7_trust_status_report.md`) plus console output. Nothing was ever serialized as JSON for a second, non-Python consumer to read. The Node/TypeScript Factory needs exactly that: a real, reproducible JSON snapshot of G01's actual verification/validation/risk/trust result, to serve as the "MT5 evidence ingestion adapter"'s data source for the integration fixture test (§28) — without re-implementing M2-M7's logic in TypeScript (which would violate "Use the existing M5 Risk Analysis contract" / "must NOT redefine M7's state machine" from §11/§12) and without modifying any M2-M7 file (the STOP condition in §34).

**Resolution:** one new, additive Python script, `generate_g01_integration_snapshot.py`, added to `ea-research/marketplace-research/m9-product-factory/` (not inside any M2-M7 directory), imports and calls the exact same real functions M3/M4/M5/M7's own `run_real_*.py` scripts already call — no new logic, no new computation, just serialization of the same real, already-established result — and writes the output to `frontend/data/marketplace-evidence/g01-integration-snapshot.json` for the TypeScript Factory to read. This is real G01 data, not a fixture in the "fabricated" sense — it is the actual, deterministic, already-verified M3-M7 result, packaged for a second consumer.
