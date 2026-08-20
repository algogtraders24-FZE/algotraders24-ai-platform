# M9 — Marketplace Product Factory & Submission Pipeline — Sprint Report

**Status: COMPLETE.** M10, Gold, and the 100-product campaign are **not started** and will not begin without explicit approval.

---

## 1. What was built

A generic, platform-neutral submission/ingestion/eligibility layer on top of M8's existing `MarketplaceListing` schema — **zero new Prisma models, zero migration** (confirmed necessary and sufficient in `M9_architecture_audit.md` §5, executed with no schema changes).

| Layer | File(s) |
|---|---|
| Types | `frontend/types/marketplace-factory.ts` |
| Platform adapter registry (6 platforms) | `frontend/services/marketplace/factory/adapters.ts` |
| MT5 evidence discovery (real snapshot reader) | `frontend/services/marketplace/factory/mt5EvidenceAdapter.ts` |
| Derived submission lifecycle | `frontend/services/marketplace/factory/submissionState.ts` |
| Eligibility policy (`M9-eligibility-v1`) | `frontend/services/marketplace/factory/eligibility.ts` |
| Stage-observable ingestion pipeline | `frontend/services/marketplace/factory/ingestion.ts` |
| Audit trail (reuses `AuditLog`) | `frontend/services/marketplace/factory/auditTrail.ts`, extended `AuditAction` union in `frontend/services/admin/AuditLogService.ts` |
| API — create draft | `POST /api/private/marketplace/listings` (new) |
| API — submit for review | `POST /api/private/marketplace/listings/[id]/submit` (new) |
| Seller UI — submission form | `frontend/app/marketplace/sell/{page,SellClient}.tsx` |
| Seller UI — "My Products" dashboard | `frontend/app/marketplace/my-products/{page,MyProductsClient}.tsx` |
| Real G01 snapshot bridge | `generate_g01_integration_snapshot.py` → `frontend/data/marketplace-evidence/g01-integration-snapshot.json` (real M3/M4/M5/M7 output, not fabricated) |
| Test suite | `frontend/scripts/validate-marketplace-factory.ts` (`npm run validate:marketplace-factory`) |
| Architecture docs | `M9_architecture_audit.md`, `M9_product_factory.md` |

## 2. Real test results

**36 passed, 0 failed, 7 explicitly skipped** (exact reasons below — never silently converted to a pass).

Covered, all real (no mocks):
- Adapter registry: exactly 6 platforms, only MT5 has real ingestion, every other adapter explicitly `UNAVAILABLE`, `getAdapter` returns `null` (never a guess) for unknown platforms.
- Derived submission lifecycle: all 10 reachable states (`DRAFT` → ... → `ELIGIBLE`/`REJECTED` → `PUBLISHED`/`UNPUBLISHED`), each proven by a distinct scenario.
- Eligibility policy: all 6 reason codes triggered individually and verified against the real `M9-eligibility-v1` ruleset; confirmed `INCONCLUSIVE` is blocked and `UNDER_OBSERVATION`/`VALIDATED` are not (the one real policy decision this sprint makes); confirmed no numeric/PF-style threshold exists anywhere in the source.
- Ingestion pipeline: every one of the 9 stages fails independently and observably (`FAILED_AT_<STAGE>`, never a generic error) when its precondition is missing; all 5 non-MT5 platforms fail honestly at `EVIDENCE_DISCOVERY` with `EVIDENCE_INGESTION_UNAVAILABLE`; an unknown `tradingSystemId`/`versionId` on MT5 itself also fails honestly (no fabricated lookup).
- **Real G01 integration fixture (§28 of the original brief):** the actual G01/v0.1 evidence chain runs the full pipeline to `TRUST_EVALUATION` (`failedAt: null`), and every returned id/hash matches the real snapshot file exactly. Eligibility for that real chain is **NOT eligible**, with exactly the three reasons the real M3–M7 output actually supports: `VALIDATION_INCONCLUSIVE` (M4 `overallStatus=INCONCLUSIVE`), `RISK_ANALYSIS_INCOMPLETE` (M5 `status=PARTIAL`), `TRUST_STATUS_BLOCKED` (M7 `status=INCONCLUSIVE`, not in the `{VALIDATED, UNDER_OBSERVATION}` allowlist). This is exactly the outcome the brief predicted and exactly why it matters: the Factory doesn't fabricate eligibility, it reports what M3–M7 actually found.
- Platform-neutrality: `ingestion.ts` source contains **zero** platform-name string literals (verified by direct grep of the real file, not an assertion about intent) — see the correction in §3 below.
- Version immutability: a second, non-existent version of G01 starts with every reference field `null` — the Factory never copies from one version to another.
- Seller/AT24 boundary: `SellerClaim`'s structural discriminant, and confirmation that M8's `AT24_ONLY_FIELDS` guard still covers every Factory-computed column (so the new `submit` endpoint can't be bypassed via `PATCH`).
- No `Score` anywhere in any Factory source file (comment-stripped grep, same method M8 used).

**Honestly skipped (7), each with the exact technical reason — see §4.**

## 3. A real design bug I found and fixed mid-build

The first draft of `ingestion.ts` decided which evidence-discovery function to call with `adapter.platform === "MT5"` — a literal platform-conditional branch, directly contradicting the architecture doc's own "zero platform-conditional branching" claim (§27 of the original brief). I caught this before finalizing and fixed it properly rather than just softening the doc's language: moved evidence discovery onto the adapter object itself as `discoverEvidence(tradingSystemId, versionId): PlatformEvidenceSnapshot | null`, which **every** adapter implements (the five non-MT5 adapters trivially return `null`). `ingestion.ts` now calls `adapter.discoverEvidence(...)` generically and contains no platform-name string literals at all — Test AD proves this by grepping the actual source file for every registered platform name and asserting none appear, then running the identical pipeline for all 6 platforms and confirming only MT5 doesn't fail at `EVIDENCE_DISCOVERY`.

## 4. Honest environment limitation (read before trusting the green test run)

This tool sandbox has **no outbound TCP reachability to the production Supabase Postgres port**, confirmed two independent ways: (1) `next build`'s static-generation phase failed with Prisma `P1001 DatabaseNotReachable` against the real pooler host — for both the new `MarketplaceListing` query and the pre-existing `Product` query on `/products/[slug]`, i.e. not something new to M9; (2) a raw `/dev/tcp` connect to that same host:5432 timed out in the same shell where an unrelated HTTPS request succeeded immediately — a port-level egress restriction, not a DNS or general-connectivity failure.

The **only** live DB connection reachable this session is the user's own separately-running `next dev` process (a long-lived process this sandbox did not spawn), reachable only through the Browser tool. Its `/api/private/*` routes correctly require an authenticated seller session — which this assistant must not create, since that would mean handling the user's real login credentials (prohibited regardless of instruction).

Consequently, 7 tests are **explicitly skipped**, never silently passed:
1. Unauthenticated `POST /api/private/marketplace/listings` → 401 — **partially verified anyway**: confirmed live via the Browser tool against the running dev server (`{"success":false,"error":"Unauthorized"}`), just not re-executed by the automated script.
2. A real draft listing can be created via `POST` and persists with `publicationState=DRAFT`.
3. `POST .../[id]/submit` actually transitions `DRAFT→SUBMITTED`, runs ingestion, writes the AT24 columns back, and lands on `UNDER_REVIEW` for the real (ineligible) G01 fixture.
4. Cross-owner rejection (404, not 403) — same, unchanged ownership-check code path M8 already verified, but not independently re-provable here.
5. A second `submit` call on an already-submitted listing returns 409, not a silent re-run.
6. Final production listing count remains unchanged — **verified anyway**: `GET /api/marketplace/search` on the live dev server returned `{"total":0}` immediately before the test script was written, and this session created zero DB rows (no DB access), so nothing could have changed it.
7. `next build`'s static-generation phase — blocked by the same P1001 limitation, not a code defect (TypeScript/compile phase of the same build passed with 0 errors; the pre-existing `/products/[slug]` route hit the identical wall first).

## 5. Static checks — all real, all run, all clean

- `npx tsc --noEmit` — 0 errors, run 4 times across the session as code evolved.
- `npx eslint` on every new/changed file — 0 errors, 0 warnings (one real finding fixed: an `<a>` tag flagged by `@next/next/no-html-link-for-pages`, replaced with `next/link`).
- `next build`'s compile + TypeScript phase — passed ("Finished TypeScript" with 0 errors); build only fails later, at static-generation, on the pre-existing DB-reachability limitation in §4.

## 6. Live regression checks (via the Browser tool, against the user's running dev server)

- `GET /api/marketplace/search` → `{"total":0}` — public catalog unaffected, 0 real listings, matching M8.1's end state.
- `/marketplace` renders correctly: filters, empty state ("No systems listed yet"), no console errors.
- `/products` renders correctly, fully unaffected (pre-existing demo catalog, unrelated code path).
- `/marketplace/sell` and `/marketplace/my-products` both compile and correctly redirect an unauthenticated visitor to `/login?redirect=...` via `requireUser` — server-side auth gate confirmed live, not just by reading the code.
- No unexpected console errors on any of the above (the one 401 logged is the expected, deliberate unauthenticated-API check).

## 7. Hard rules honored

No AT24 Score/ranking/badge anywhere (grep-verified). No payment/commission/payout system. No KYC/onboarding UI. No numeric quality threshold in the eligibility policy (grep-verified: no bare numeric comparison in `eligibility.ts`). No real Gold product, no 100-product campaign, no production migration. `sellerId` remains a plain unconstrained string — no AT24 bypass path exists in the Factory. Every prior sprint's artifacts (M2–M8.1) were read, never modified, except the one additive, backward-compatible extension to `AuditAction` in `AuditLogService.ts` (new union members only, nothing removed or changed).

## 8. What is explicitly NOT done (deferred, not forgotten)

Per the brief's own hard rules: no AT24 Score, no ranking, no payment/commission/payout/refund/affiliate system, no KYC/onboarding UI, no publish-to-production of any real system, no Gold product, no 100-product campaign. The seller UI built this sprint is minimal and functional, not polished — sufficient to exercise the real Factory end-to-end, not a finished consumer experience.

---

**Stopping here.** Awaiting explicit approval before any further work — M10, Gold, or the 100-product campaign are not started.
