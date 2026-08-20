# M8.1 — Marketplace Production DB Activation & Smoke Verification

**Status: CLOSED. Migration applied to live production Supabase database. Production Marketplace contains 0 real listings.**

---

## 1. Migration applied

**YES.** `frontend/prisma/migrations/20260819120000_add_marketplace_listing/migration.sql`, applied via `npx prisma migrate deploy` (the repo's established safe production mechanism — no shadow database involved, unlike `prisma migrate dev`, which a prior migration's own comment documents as broken on this project's pgvector setup).

Pre-migration safety checks (brief §2, A–K) all passed: clean git status (confirmed twice — see §9 on unrelated concurrent activity), migration content read directly and confirmed additive-only (one `CREATE TABLE`, 9 `CREATE INDEX`, zero `ALTER`/`DROP`/`DELETE`/`TRUNCATE`, zero reference to `Product` or any other existing table), `prisma migrate status` confirmed exactly one pending migration (this one) against the correct target (`gyiwxsxgnnigoqpedzfw.supabase.co`, matching the M8 audit's identified project).

## 2. Database verification (real `information_schema`/`pg_indexes` queries, not assumed)

| Check | Result |
|---|---|
| Table exists | PASS — `marketplace_listings` present |
| Columns (28 total) | PASS — every column present with correct NOT NULL/nullable per the Prisma model |
| Primary key | PASS — `marketplace_listings_pkey` on `id` |
| Indexes (9) | PASS — all present: pkey, slug unique, sellerId, publicationState, trustState, platformTag, assetTag, category, deletedAt, lastEvidenceAt |
| Constraints | PASS — unique constraint on `slug` confirmed |
| Product regression | PASS — 10 rows (unchanged), `slug`/`price` columns confirmed present |
| Unrelated tables | PASS — no table introduced by this migration beyond `marketplace_listings`; the user's own concurrent work (see §9) added unrelated tables/columns independently, not from this migration |

## 3. Prisma verification (real CRUD against production, temp rows deleted in `finally`)

Create, read (`findUnique`), lookup-by-slug, update (via the real `evaluateListingMutation` guard), filter-by-seller, pagination (`skip`/`take`) — all PASS, executed by `scripts/validate-marketplace-production-smoke.ts`, 15/15 real tests passed. Two temp rows created under unmistakable `m8-1-smoke-test-*` slugs and synthetic `sellerId` markers (never real User ids), both hard-deleted, verified zero remain.

## 4. Cross-owner security

**Data-layer (real, PASS):** the exact ownership `WHERE { id, sellerId, deletedAt: null }` pattern the PATCH route uses was proven, live, to correctly fail to locate seller B's row under seller A's id.

**HTTP-session-layer (SKIPPED, stated reason):** a genuine end-to-end test would need two real authenticated Supabase sessions. Creating real Supabase Auth accounts to simulate this is **explicitly prohibited** by this environment's safety rules (account creation), not merely deferred — and `getUserOrNull()` cannot run outside a real Next.js request scope from a script (confirmed in M8). This is the one gap in this sprint's security verification, stated plainly rather than glossed over.

## 5. AT24-field protection

Confirmed live: `evaluateListingMutation` rejects `trustState`, `evidenceId`, `publicationState` (and by extension every other AT24-only field) with `FORBIDDEN_FIELD`, before Prisma is ever touched.

## 6. Trust State / Evidence / Validation / Risk / History safety — verified by actually viewing a real rendered page

One temporary `PUBLISHED` listing (`m8-1-smoke-test-detail-page-check`) was created, viewed live in a browser at `/marketplace/m8-1-smoke-test-detail-page-check` against the running app, and its full rendered text captured. Every AT24 section rendered its honest unavailable state — **Trust State: "Not Yet Verified"** (never a fabricated `VALIDATED`), Evidence/Validation/Risk/History all stated "not attached/run/recorded yet," no numbers anywhere. Purchase CTA correctly disabled ("Purchasing coming soon"). Risk disclosure present. The listing was then deleted; `/marketplace/m8-1-smoke-test-detail-page-check` now correctly 404s, and an unrelated invalid slug also 404s.

## 7. Public API / page results (all against the real production database, live)

| Endpoint | Result |
|---|---|
| `GET /marketplace` | 200, real empty catalog |
| `GET /api/marketplace/search` | 200, `{"items":[],"total":0}` — real |
| `GET /api/private/marketplace/listings` (unauthenticated) | 401 — rejected at the edge by `proxy.ts` (Next 16's renamed `middleware.ts` — see §10) before even reaching route code |
| `PATCH /api/private/marketplace/listings/[id]` (unauthenticated) | 401 — same edge rejection |
| `GET /products`, `/products/[slug]` | 200 — regression-clean |

## 8. Final production state

**0 real listings.** Confirmed four independent ways: the smoke script's own post-cleanup count, the detail-page script's post-delete count, `next build`'s static-generation output (`/marketplace/[slug]` shows zero sub-paths, unlike `/products/[slug]`'s 10), and a final live `GET /api/marketplace/search` call returning `"total":0`.

## 9. Unrelated concurrent activity, noted transparently

During this sprint, `git status` twice showed files this session never touched (`NativeChart.tsx`, `viewport.ts`, later `drawing/store.ts`, a new `chart-drawings` API route, a new chart-drawing migration folder) appearing and changing. This is the user's own live, concurrent development work in the same repository — confirmed by watching the diff change between two consecutive `git status` calls with no action from this session in between. Not caused by, and not interfered with by, this sprint's work. Called out here for the record, per the brief's own pre-migration "confirm no unexpected changes" instruction, exactly as instructed rather than silently ignored.

## 10. Real finding: Next.js 16 renamed `middleware.ts` → `proxy.ts`

Not previously documented in this program. `PROTECTED_API_PREFIX = "/api/private"` with matcher `/api/private/:path*` means every route under `/api/private/marketplace/*` inherited edge-level auth rejection automatically, with zero additional wiring — genuine defense-in-depth (edge layer + route-level `getUserOrNull()` check), confirmed by the unauthenticated-request response shape (`{"success":false,"error":"Unauthorized"}`) differing from this sprint's own `ApiResponse.error()` shape, meaning the edge layer answered first.

## 11. M2–M7 protection

Untouched — confirmed via `find -newer` against this sprint's own start marker, same check as M8.

## 12. Files added this sprint

`ea-research/marketplace-research/m8-marketplace-platform/M8_1_production_activation.md` (this file), `frontend/scripts/validate-marketplace-production-smoke.ts`, one `validate:marketplace-prod` entry in `package.json`. One fix to the pre-existing `validate-marketplace-platform.ts` (its AQ "not applied" test was stale the moment the migration landed — corrected to check table-existence directly via `information_schema` instead of inferring it from an ambiguous empty-result).
