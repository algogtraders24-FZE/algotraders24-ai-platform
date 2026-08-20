# M8 — Entity Relationship: Product, TradingSystem, Version, MarketplaceListing

**Status: written before any Prisma changes, per instruction #6.** This is the required documentation gate; `frontend/prisma/schema.prisma` is not touched until this is in place.

---

## 1. The four entities and what each one actually is

| Entity | Where it lives | What it is | Owner |
|---|---|---|---|
| **Product** | `frontend/prisma/schema.prisma` (live, migration-managed) | The existing, single-vendor public catalog row powering `/products`. Seed-originated (`prisma/seed.ts` ← `data/products.ts`). No seller, no evidence chain, no Trust State. | AT24 (first-party only) |
| **TradingSystem** | `ea-research/marketplace-research/M1_schema.prisma` (draft only, never applied) | The root identity of a strategy (G01, a future G02, a third-party seller's EA, etc.), independent of any backtest. | Conceptually seller-or-AT24-owned; not yet a real Prisma table anywhere |
| **Version** | Same M1 draft | An immutable snapshot of one TradingSystem's logic/parameters. Owns zero performance data itself — Evidence/Validation/RiskAnalysis/History/TrustStatus all key off `Version.id`. | Same as TradingSystem |
| **MarketplaceListing** | **New this sprint** — `frontend/prisma/schema.prisma`, additive, unapplied migration | The buyer-facing, publishable presentation of one TradingSystem Version. What M8 actually builds pages/routes/UI against. | Seller-authored presentation fields; AT24-authored reference/outcome fields (see §3) |

## 2. The relationship, precisely

```
TradingSystem (M1 draft — not a real table yet)
      │  1:N
      ▼
Version (M1 draft — not a real table yet)
      │
      ├──► Evidence / Validation / RiskAnalysis / HistoryEvent / TrustStatus
      │    (all M1 draft — not real tables yet; live only as the flat-file
      │    JSON artifacts M2-M7 already produced in ea-research/)
      │
      └──► MarketplaceListing (NEW, real table this sprint)
                 references tradingSystemId + versionId as plain string
                 identifiers (no live FK — there is no real TradingSystem/
                 Version table to point a Postgres foreign key at yet)

Product (existing, live table) ─── NOT connected to any of the above.
      No relationship to TradingSystem/Version/MarketplaceListing is
      created or implied this sprint. It continues to power /products,
      untouched, exactly as it does today.
```

**Why `Product` and `MarketplaceListing` stay unconnected this sprint:** the M8 brief is explicit that `Product` must not be deleted, replaced, renamed, or have its live behavior broken (#2), and that the two catalogs are built "alongside" each other (#3). Any FK or shared-identity relationship between them would be exactly the kind of migration/reconciliation work the architecture audit (§4, Option C) already flagged as its own, larger, deliberately-deferred sprint. `MarketplaceListing` this sprint is a parallel, independent table — not a foreign key away from `Product`, not a subtype of it, not a replacement for it.

**Why `MarketplaceListing.tradingSystemId`/`versionId` are plain strings, not real Prisma relations:** `TradingSystem` and `Version` exist only in `M1_schema.prisma` (a draft, never applied — confirmed unchanged through M1-M7). There is nothing in the live database to point a real foreign key at. Adding `TradingSystem`/`Version` as real tables in `frontend/prisma/schema.prisma` this sprint was considered and rejected (see the architecture audit §5) — M8 has no real TradingSystem to populate them with (product creation is forbidden), so they'd sit permanently empty or force exactly the "fake production data" this sprint explicitly forbids. `tradingSystemId`/`versionId` on `MarketplaceListing` are therefore forward-compatible identifiers: string columns that will resolve to real rows once a future ingestion sprint promotes the M1 draft schema to production tables, not enforced relations today.

## 3. The no-duplication rule, applied concretely (#7, #8)

**MarketplaceListing does not store a copy of Evidence, Validation, RiskAnalysis, History, TrustStatus, or Score content.** It stores exactly two kinds of field:

1. **Seller-owned presentation fields** — `title`, `description`, `media[]`, `pricing` (Json), category/platform/asset/strategy tags. Genuinely owned by the listing; nothing to duplicate because nothing authoritative exists elsewhere for these.
2. **Reference + already-computed-outcome fields for AT24 data** — `tradingSystemId`, `versionId` (identifiers, §2), `evidenceId`/`evidenceHash`, `validationId`/`validationHash`, `riskAnalysisId`/`riskAnalysisHash` (pointers into the authoritative M2-M5 artifacts, not copies of their contents), and `trustState`/`trustReasonCode`/`trustExplanation`/`trustStatusId` (the literal M7 output — storing the *result* AT24 already computed once is not duplication in the sense the brief means; re-storing the *underlying* drawdown numbers, trade-by-trade records, or validation sub-results on the listing itself would be).

**Consequence for the detail-page sections (Evidence/Validation/Risk/History, §10-13 of the original brief):** there is currently no live database table or API that can serve the *full* Evidence/Validation/RiskAnalysis/History records to a Next.js page — those remain exactly where M2-M7 left them, as flat-file JSON under `ea-research/marketplace-research/m{2..7}-*/`. This sprint builds the **UI components** for those sections against well-typed interfaces shaped like the real M2/M4/M5/M6 output, ready to render real data — but since zero real `MarketplaceListing` rows will exist in production this sprint (product creation forbidden) and no live "fetch the full Evidence record for listing X" endpoint exists yet, every real render of those sections this sprint shows their honest empty/unavailable state. Wiring a real ingestion path (M2-M7 flat-file output → a queryable production store the detail page can join against) is out of scope for M8 and is logged as an explicit deferred item, not silently faked with mock data.

## 4. Evidence Tier vs. Trust State vs. Publication State vs. Version (#9)

Four axes, four separate fields, never collapsed into one:

- **Trust State** (`MarketplaceListing.trustState`) — the M7 vocabulary (`UNVERIFIED, VALIDATION_PENDING, INCONCLUSIVE, LIMITED, UNDER_OBSERVATION, VALIDATED, INVALIDATED, SUPERSEDED`). Describes AT24's current confidence in the *evidence*, never the strategy's quality.
- **Evidence Tier** — M1's original, different vocabulary (`BACKTEST_VERIFIED, ROBUSTNESS_VERIFIED, PAPER_VERIFIED, LIVE_VERIFIED, AT24_VERIFIED` — this is `ARCH-M1-TRUST-002`, already flagged in M7). **Not implemented as a real column this sprint.** No `evidenceTier` field exists on `MarketplaceListing` yet — see §5 below for why, and what would need to happen first.
- **Publication State** (`MarketplaceListing.publicationState`) — the marketplace workflow (`DRAFT, SUBMITTED, UNDER_REVIEW, EVIDENCE_PENDING, VALIDATION_PENDING, READY, PUBLISHED, SUSPENDED, RETIRED`). Purely about whether a listing is visible in the catalog, unrelated to Trust State — a listing can be `PUBLISHED` with `trustState = INCONCLUSIVE` if AT24's marketplace rules permit it (they do, per the brief's own example), and this sprint's implementation never equates the two.
- **Version** (`MarketplaceListing.versionId`) — which TradingSystem Version this listing presents. A second listing for a later Version is a separate row with its own independent Trust State/Evidence Tier/Publication State — never inherited.

## 5. ARCH-M1-TRUST-002 as a schema migration dependency (#10)

Restated from M7, now framed as what it blocks: **`MarketplaceListing` cannot gain a real `evidenceTier` column until someone decides how M1's original tier vocabulary and M7's trust-state vocabulary actually relate** — are they orthogonal (a listing has both a tier *and* a state, as §1/§9 of the M8 brief implies by listing them separately) or does one supersede the other? That is a product-architecture decision for a future sprint, not something M8 resolves by picking one and quietly discarding the other (M1 is not touched; M7's vocabulary is not touched). Until it's resolved, `MarketplaceListing` has no Evidence Tier field at all — the UI's "Evidence Tier, only if available" card slot (§7 of the original brief) is always in its "not available" state this sprint, which is the honest reflection of an unresolved schema question, not a bug to work around.

## 6. What this sprint does NOT create

No real TradingSystem/Version/Evidence/Validation/RiskAnalysis/HistoryEvent/TrustStatus Prisma tables. No FK between `Product` and `MarketplaceListing`. No `evidenceTier` column. No ingestion pipeline moving `ea-research/` flat-file output into any production table. All of these are logged as explicit, deferred architecture gaps in the final M8 report, not implemented speculatively.
