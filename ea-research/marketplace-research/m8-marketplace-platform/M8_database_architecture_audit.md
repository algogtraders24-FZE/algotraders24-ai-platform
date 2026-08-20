# M8 — Database Architecture Audit (section 23 deliverable)

**Status: audit complete, decision pending user sign-off. No Prisma schema changes have been made. No migration has been run.**

This document exists because the M8 brief requires it explicitly *before* any Prisma modification: "Before modifying Prisma: inspect the existing schema... Document: existing model, required marketplace model, relationships, migration strategy, backwards compatibility" (§23), and "If a production schema change is required: STOP and document it before applying it" (§41). This is that stop.

---

## 1. Why this is a real decision, not a formality

`frontend/prisma/schema.prisma` is not a research prototype — it is migration-managed (21 real, sequentially applied migrations, `20260711114634_init` through `20260813090000_add_outcome_idempotency_guard`) against a **live Supabase Postgres database** (`DATABASE_URL`/`DIRECT_URL` in `.env` point at a real `aws-0-ap-northeast-1.pooler.supabase.com` instance), deployed via Vercel. Any schema change here requires a real `prisma migrate` against production, not a throwaway local change. That is exactly the kind of hard-to-reverse, shared-system-affecting action this program's own safety rules say to pause and confirm before doing — so this audit stops here, at a decision, rather than proceeding straight to a migration.

## 2. What exists today

- **`Product`** (`frontend/prisma/schema.prisma`): `slug, name, category, price, images[], features[], specifications(Json), faqs(Json), version, rating, downloads, featured, status, ...` plus standard `deletedAt` soft-delete. **No seller/owner field** — it's a single-vendor catalog model, not a marketplace-with-distinct-sellers model.
- **Live consumer**: `/products` and `/products/[slug]` (`app/products/`), reading via `services/products/ProductCatalogue.ts` (`server-only`, direct Prisma, ISR `revalidate=300`). This page already carries the "Marketplace" brand heading today.
- **Data reality**: every row in `Product` today originates from `prisma/seed.ts` upserting the static array in `data/products.ts` (10 entries). `rating`/`downloads` are static seed numbers, not computed from any real review/order pipeline — **there is no `Order`, `Review`, or `Download` Prisma model at all**; `services/review.service.ts` / `order.service.ts` / `download.service.ts` read from separate static in-memory arrays, disconnected from Postgres.
- **Dead scaffolding**: a paginated, auth-gated `/api/private/products` route, a repository-pattern layer (`ProductRepository`/`PrismaProductRepository`/`RepositoryFactory`), and a client-side `product.service.ts`/`ProductsApi.ts` all exist but have **zero live callers** — earlier sprint work that was never wired to the actual page.
- **No admin UI** manages `Product` at all, despite a `"manage_products"` permission already defined in `lib/permissions.ts` and unused by any route.
- **No search, no real filter, no sort, no pagination** on the live `/products` page — filtering is a client-side array `.filter()` on an unconditionally-fetched full table scan; sort order is fixed at the query (`featured desc, createdAt asc`).

## 3. What M8 needs that `Product` cannot represent

M8's required product-card/detail fields (§7, §10-§14) are: Trust State, reasonCode/explanation, Evidence Tier (deferred but must be representable later), per-Version Evidence/Validation/RiskAnalysis/History, a seller identity distinct from AT24, and a **publication-state lifecycle separate from Trust State** (§17: `DRAFT → SUBMITTED → ... → PUBLISHED`, explicitly *not* the same axis as Trust State). None of this exists on `Product`, and — critically — `Product` has no relationship at all to `TradingSystem`/`Version`/`Evidence`/`Validation`/`RiskAnalysis`/`HistoryEvent`/`TrustStatus`, which live only as the M1 Prisma-conceptual models documented in `M1_schema.prisma` (a standalone draft file, never applied to `frontend/prisma/schema.prisma` — confirmed unchanged throughout M1-M7).

## 4. The three options, evaluated

**Option A — `Product` becomes/references `MarketplaceListing`.** Widen `Product` in place (add `sellerId`, `versionId`, `trustState`, `publicationState`, etc.) or rename it. **Rejected.** `Product` is live, migration-managed, and actively serving `/products` in production. Widening a live model to carry a fundamentally different domain (evidence-backed trading systems vs. a simple seeded catalog) risks the one real, working page in this whole audit, for a feature that (per M8's own hard rule) will hold **zero real rows** by the end of this sprint. The blast radius doesn't match the payoff.

**Option B — `MarketplaceListing` becomes a separate marketplace layer, `Product` untouched.** New models (`MarketplaceListing`, and thin `TradingSystem`/`Version`/`Seller`-relationship stand-ins only as far as the Marketplace UI actually needs to query them — **not** a full re-implementation of M1's TradingSystem/Evidence/Validation/RiskAnalysis/HistoryEvent/TrustStatus chain, which remains the `ea-research/` flat-file prototype it has been through M1-M7), additive-only migration, `/products` and its live traffic completely undisturbed. **Recommended.**

**Option C — controlled migration/reconciliation.** Eventually correct (Marketplace and `/products` probably *should* converge on one product-catalog concept long-term), but requires a data-migration/backward-compatibility plan for real production rows and real page URLs (`/products/[slug]` is presumably indexed/bookmarked) — genuinely out of scope for a sprint whose own hard rule is "no products, no Gold, platform preparation only." Flagged as the eventual direction, explicitly deferred, not attempted now.

## 5. Recommendation: Option B, with the narrowest schema footprint that still lets the UI be real (not mocked)

Add exactly the models the Marketplace UI needs to genuinely query (real `0/1/10/100+`-row behavior, not a hardcoded empty state), and nothing from the M1 evidence chain that M8 doesn't directly render:

- **`MarketplaceListing`** — `id, sellerId (→ User.id, plain indexed column per this codebase's existing userId-denormalization convention — see KnowledgeChunk/Message/AgentTask), tradingSystemId, versionId, title, description, category(platform/asset/strategy tags), media[], pricing(Json), publicationState, trustState, trustReasonCode, trustExplanation, evidenceSummary(Json — a read-only projection, not the M1 Evidence record itself), createdAt, updatedAt, deletedAt`. `publicationState` and `trustState` are **separate columns**, per §17/§25's explicit instruction not to overload one status field.
- **No new `TradingSystem`/`Evidence`/`Validation`/`RiskAnalysis`/`HistoryEvent`/`TrustStatus` tables in `frontend/prisma/schema.prisma` this sprint.** M8 has no real TradingSystem to list (product creation is forbidden), so there is nothing genuine to populate those tables with yet — adding them now would mean either leaving them permanently empty or seeding them with exactly the "fake performance record" this sprint explicitly forbids (§6, §36). `MarketplaceListing.evidenceSummary`/`trustState`/`trustReasonCode` are the minimum surface needed to prove the UI genuinely renders AT24-computed-shaped data end-to-end, sourced (once a real listing exists) from a future ingestion step that reads the `ea-research/` engines' output — not reimplemented here.
- **Backwards compatibility:** fully additive migration (`CREATE TABLE`, no `ALTER`/`DROP` on any existing model). `/products` is untouched and continues serving exactly as it does today. Zero risk to existing production traffic.

## 6. What this means for the rest of M8

The Marketplace pages/routes/UI described in §4-§22 of the brief are built against `MarketplaceListing`, genuinely empty in production (0 rows) at the end of this sprint — satisfying §6's "empty marketplace must stay honest" requirement by construction, not by a special-cased UI branch. Search/filter/sort/pagination are real Prisma queries (`skip`/`take`, indexed `where` clauses) against a real, currently-empty table — proven at 0/1/10/100+ synthetic-but-clearly-marked-demo rows in a local/dev-only seed path per §36, never in the production dataset.

## 7. Decision required before proceeding

1. Confirm Option B (additive `MarketplaceListing` model, `Product` untouched) is the right call, or redirect.
2. **Explicit go-ahead to run a real `prisma migrate dev` (and eventually `deploy`) against the live Supabase database** — this audit does not do that on its own authority.
