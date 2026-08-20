# M9 — Marketplace Product Factory & Submission Pipeline

**Status:** COMPLETE. Architecture + engine + API routes + minimal seller UI built, TypeScript/ESLint clean, 36 real automated tests passed (0 failed) against the real G01 integration fixture and every pure-function code path, 7 HTTP/DB-dependent tests explicitly skipped with exact reasons (this sandbox has no DB egress this session — see the M9 sprint report). **Zero schema changes, zero migration** — see `M9_architecture_audit.md` §5 for why none was needed.

---

## 1. Architecture — reuses M8's schema, adds a pure application layer

The Factory does not introduce a parallel data model. It is a TypeScript application layer (`frontend/services/marketplace/factory/`) that:
- Reads/writes the **existing** `MarketplaceListing` reference columns (`evidenceId`, `validationId`, `riskAnalysisId`, `trustState`, etc.) — the actual "binding" the brief asks for.
- **Derives** submission lifecycle state from those columns rather than storing a redundant one (§5 below).
- Reuses the **existing** `AuditLog` model (extending its closed `AuditAction` union additively) for the audit trail (§19 below).
- Reads a **real, generated** JSON snapshot of G01's actual M3/M4/M5/M7 result (`frontend/data/marketplace-evidence/g01-integration-snapshot.json`, produced by a new, additive Python script that only calls M3-M7's existing functions — never modifies them) as the MT5 platform's evidence-ingestion source.

## 2. Platform adapter contract

```ts
interface PlatformAdapter {
  platform: string;
  productTypes: string[];
  sourceFormats: string[];          // e.g. adapter identifiers Evidence packages declare (sourceAdapter field)
  evidenceIngestionSupported: boolean;
  validationCapability: "AVAILABLE" | "UNAVAILABLE";
  requiredArtifacts: string[];
  supportedMarkets: string[];
  supportedTimeframes: string[];
}
```

No MT5-specific field exists on this interface — `sourceFormats`/`requiredArtifacts` are generic strings any adapter can populate with its own vocabulary. Six adapters registered (`services/marketplace/factory/adapters.ts`): **MT5** is the only one with `evidenceIngestionSupported: true` / `validationCapability: "AVAILABLE"` — because M2/M2.1 is the only adapter that actually exists. MT4, cTrader, NinjaTrader, Crypto, and AI Engine are registered with `evidenceIngestionSupported: false`, `validationCapability: "UNAVAILABLE"`, `requiredArtifacts: []` — explicit absence, never fabricated support. `ProductFactory`/`ValidationBinding`/`RiskBinding`/`TrustBinding`/`HistoryBinding` contain **zero** platform-conditional branches — each reads only the adapter object's declared capabilities, proven by Test AF (platform-neutrality) running the identical code path for all six.

## 3. Submission lifecycle — derived, not stored (§5 of the brief resolved)

`deriveSubmissionState(listing): SubmissionState` (`services/marketplace/factory/submissionState.ts`) computes one of `DRAFT, SUBMITTED, INGESTION_PENDING, EVIDENCE_PENDING, VALIDATION_PENDING, RISK_ANALYSIS_PENDING, TRUST_PENDING, ELIGIBLE, REJECTED, PUBLISHED, UNPUBLISHED` purely from the listing's existing columns — no new column, so it can never drift from what's actually stored. `ELIGIBLE`/`REJECTED` further depend on the eligibility gate (§5 below), not just field presence.

## 4. Ingestion pipeline — stage-observable, never a vague failure

`runIngestionPipeline(listing, adapter)` (`services/marketplace/factory/ingestion.ts`) walks: schema validation → platform validation → TradingSystem binding → Version binding → Evidence discovery → Validation discovery → Risk discovery → History discovery → Trust evaluation → eligibility decision. Every stage returns `{ stage, status, detail }`; a failure is always `FAILED_AT_<STAGE>` (e.g. `FAILED_AT_EVIDENCE`), never a generic `PRODUCT_INVALID`. For MT5, "Evidence discovery" reads the real snapshot (§1); for every other platform, it returns `FAILED_AT_EVIDENCE` with `EVIDENCE_INGESTION_UNAVAILABLE` — an honest, explicit, expected failure (not a bug) since no non-MT5 adapter has ingestion built yet.

## 5. Publication eligibility — a named, versioned, categorical policy (not a numeric threshold)

`MARKETPLACE_ELIGIBILITY_RULESET_VERSION = "M9-eligibility-v1"`. Eligibility requires: TradingSystem + Version bound, Evidence/Validation/Risk all present, **`trustState` in `{VALIDATED, UNDER_OBSERVATION}`**, ownership valid, required marketing fields present. This is the one real policy decision M9 makes, and it is deliberately **categorical** (a named allowlist of M7's own existing state values) rather than numeric (no "PF > 1", no score cutoff) — consistent with §10/§13's explicit prohibition. It is exactly why the real G01 fixture (`trustState = INCONCLUSIVE`) is *not* eligible: `INCONCLUSIVE` is not in the allowlist, full stop — not because any number was checked. Every other trust state (`UNVERIFIED`, `VALIDATION_PENDING`, `INCONCLUSIVE`, `LIMITED`, `INVALIDATED`, `SUPERSEDED`) blocks with `TRUST_STATUS_BLOCKED`, naming the actual state in the detail message.

## 6. Rejection system

Every non-eligible outcome carries `{ status: "NOT_ELIGIBLE", reasons: [...] }` where each reason is one of `MISSING_EVIDENCE, VALIDATION_INCONCLUSIVE, RISK_ANALYSIS_INCOMPLETE, TRUST_STATUS_BLOCKED, VERSION_INVALID, OWNERSHIP_FAILURE` — never a free-text "something went wrong."

## 7. Audit trail — reusing `AuditLog`, not a new table

`AuditAction` (`services/admin/AuditLogService.ts`) extended additively with `marketplace.submission_created`, `.submission_updated`, `.submitted_for_review`, `.ingestion_started`, `.ingestion_completed`, `.validation_completed`, `.risk_analysis_completed`, `.trust_evaluated`, `.eligibility_evaluated`, `.published`, `.unpublished`, `.rejected`. Every Factory transition calls `auditLogService.record()` — append-only by the existing model's own design (no update/delete path).

## 8. Seller vs. AT24 boundary — unchanged from M8, reused directly

`evaluateListingMutation` (M8) already rejects every AT24-controlled field, and this sprint's new `POST /api/private/marketplace/listings` (create draft) reuses it directly on the create body too — a create request containing `trustState` is rejected the same way a PATCH would be. `tradingSystemId`/`versionId` are the one deliberate exception: accepted **only** at creation, as a one-shot "which product is this" declaration (never re-settable afterward — PATCH's guard still forbids them, per §9 Version immutability).

M9 adds exactly one new narrow **transition** endpoint, `POST /api/private/marketplace/listings/[id]/submit`, which performs `DRAFT → SUBMITTED` after checking required marketing fields are present, then synchronously runs `runIngestionPipeline` + `evaluateEligibility` and writes their outcome back to the row's AT24-only columns (`publicationState` becomes `READY` if eligible, `UNDER_REVIEW` otherwise) — there is no separate AT24-admin trigger this sprint, so the submit request itself is what causes AT24's processing to happen. It is still not a general field-setter: the request body carries no fields at all, and the endpoint can only ever write what the ingestion pipeline itself discovered. Seller claims (a title like "90% win rate") are stored only in `title`/`description` (free text) — never parsed into, or allowed to populate, any AT24-computed field. `types/marketplace-factory.ts` keeps a `SellerClaim` type structurally distinct from `EvidenceSummary`/`ValidationSummary`/etc. so the two can never be assigned to each other without a compile error.

A minimal seller-facing UI exists for both: `/marketplace/sell` (draft creation form) and `/marketplace/my-products` (lists the caller's own listings, derives real `SubmissionState`, and exposes the submit action) — both server-gated with `requireUser`, matching the admin dashboard's own `requireRole` pattern.

**Correction made during implementation:** the first draft of `ingestion.ts` read `if (adapter.platform === "MT5")` to decide whether to call MT5's evidence discovery — a real platform-conditional branch, contradicting this section's own zero-branching claim. Fixed by moving evidence discovery onto the adapter object itself: `PlatformAdapter.discoverEvidence(tradingSystemId, versionId): PlatformEvidenceSnapshot | null`, which every adapter implements (the five non-MT5 adapters just return `null`). `ingestion.ts` now contains zero platform-name string literals — verified by Test AD, which greps the file for every `PLATFORM_NAMES` literal and asserts none appear.

## 9. Version immutability

The Factory never copies `evidenceId`/`validationId`/`riskAnalysisId`/`trustState` from one `versionId` to another — `bindVersion()` only ever sets these fields from the ingestion pipeline's own fresh discovery for *that* submission's declared `versionId`, and Test S/T prove a second version's listing starts with all four `null` even when a first version's listing (same `tradingSystemId`) already has them populated.

## 10. Third-party readiness

`sellerId` remains a plain, unconstrained string (no `sellerId === "AT24"` check anywhere in the Factory) — AT24-owned submissions flow through the exact same `runIngestionPipeline`/`evaluateEligibility` code as a hypothetical future third-party seller's would. No AT24 bypass exists (Test AT24-no-bypass proves this by running an AT24-attributed submission through the identical pipeline).

## 11. Explicitly deferred (per the brief's own hard rules)

No AT24 Score, no ranking, no payment/commission/payout/refund/affiliate system, no KYC/onboarding UI, no new numeric quality thresholds, no `/marketplace/sell` publish-to-production of any real system, no Gold product, no 100-product campaign. `Score` remains absent from every type/field in this sprint's code (checked by the same grep-based test M8 used).
