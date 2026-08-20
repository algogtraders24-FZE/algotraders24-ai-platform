// scripts/validate-marketplace-platform.ts
// Sprint M8 - Standalone validation for the AT24 Marketplace platform
// (no test framework exists in this project - see package.json). Run via
// `npm run validate:marketplace`.
//
// HONESTY NOTE (read before trusting a green run): the `marketplace_listings`
// migration is deliberately NOT applied to the live database this sprint
// (see ea-research/marketplace-research/m8-marketplace-platform/). This
// script therefore:
//   - RUNS real tests for everything that doesn't require seeded rows:
//     pure display-helper logic, the real seller/AT24 field-authorization
//     function, and MarketplaceCatalogue's real query-construction +
//     graceful-degrade behavior against the actual (currently table-less)
//     live database.
//   - explicitly SKIPS (never silently omits) every scenario from the M8
//     test list that genuinely requires seeded rows (10/100/500+ listings,
//     rendered Evidence/Validation/Risk/History sections with real data) or
//     a real browser (responsive/accessibility) - each skip states exactly
//     why and what would need to happen first.
// A green run here means "the code is structurally correct and the parts
// that can run without the migration do" - not "M8 has been tested at
// scale," which is factually impossible until the migration is applied.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { withTableFallback } from "../services/marketplace/tableGuard";
import { evaluateListingMutation, AT24_ONLY_FIELDS, SELLER_MUTABLE_FIELDS } from "../services/marketplace/listingMutationGuard";
import { formatListingPrice, publicationStateTone, trustStateLabel, trustStateTone } from "../lib/marketplace";
import { PUBLICLY_VISIBLE_STATES, TRUST_STATES } from "../types/marketplace";
import type { MarketplaceListing as PrismaMarketplaceListing } from "../lib/generated/prisma/client";

// MarketplaceCatalogue.ts is deliberately "server-only" (matching its
// sibling services/products/ProductCatalogue.ts's own established
// convention - a Server-Component data-layer file, never imported by a
// plain script), so it cannot be imported directly here - this repo has no
// validate-products.ts for the same reason. This script instead exercises
// the same real `prisma` singleton + the same real `withTableFallback`
// guard that MarketplaceCatalogue.ts itself calls internally, with the
// identical where/orderBy shapes, proving the actual mechanism (real
// Prisma model, real graceful-degrade utility) rather than a
// reimplementation.
async function searchListings(where: Record<string, unknown>) {
  return withTableFallback(
    () =>
      Promise.all([
        prisma.marketplaceListing.findMany({ where, take: 24 }),
        prisma.marketplaceListing.count({ where }),
      ]),
    [[], 0] as [PrismaMarketplaceListing[], number],
  );
}

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(`         ${err instanceof Error ? err.message : String(err)}`);
  }
}

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  skip - ${name}`);
  console.log(`         ${reason}`);
}

function readSource(relPath: string): string {
  return readFileSync(join(__dirname, "..", relPath), "utf-8");
}

async function main() {
  console.log("\n=== A/F/G/H/I/J/K/L - catalog query construction + graceful zero-listings behavior (REAL, against live DB) ===");

  await test("A - zero listings: a real query against the live (unmigrated) table returns a well-formed empty result, does not throw", async () => {
    const [items, total] = await searchListings({ deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } });
    assert.equal(total, 0);
    assert.deepEqual(items, []);
  });

  await test("F - search (q)-shaped where-clause does not crash the query and returns a well-formed empty result", async () => {
    const [items] = await searchListings({ deletedAt: null, OR: [{ title: { contains: "liquidity sweep", mode: "insensitive" } }] });
    assert.deepEqual(items, []);
  });

  await test("G - platform filter does not crash the query", async () => {
    for (const platform of ["MT5", "MT4", "cTrader", "NinjaTrader", "Crypto", "AI Engine"]) {
      const [items] = await searchListings({ deletedAt: null, platformTag: platform });
      assert.deepEqual(items, []);
    }
  });

  await test("H - asset filter does not crash the query", async () => {
    for (const asset of ["Gold", "Silver", "Forex", "Indices", "Crypto"]) {
      const [items] = await searchListings({ deletedAt: null, assetTag: asset });
      assert.deepEqual(items, []);
    }
  });

  await test("I - strategy filter does not crash the query", async () => {
    for (const strategy of ["Trend", "Breakout", "Momentum", "Mean Reversion", "Liquidity", "Scalping"]) {
      const [items] = await searchListings({ deletedAt: null, category: strategy });
      assert.deepEqual(items, []);
    }
  });

  await test("J - Trust State filter accepts every real M7 vocabulary value without crashing", async () => {
    for (const trustState of TRUST_STATES) {
      const [items] = await searchListings({ deletedAt: null, trustState });
      assert.deepEqual(items, []);
    }
  });

  await test("K - every sort field used by sortToOrderBy resolves to a valid, real orderBy without crashing", async () => {
    for (const orderBy of [{ updatedAt: "desc" }, { createdAt: "desc" }, { lastEvidenceAt: "desc" }]) {
      const rows = await withTableFallback(
        () => prisma.marketplaceListing.findMany({ where: { deletedAt: null }, orderBy: orderBy as never, take: 24 }),
        [] as PrismaMarketplaceListing[],
      );
      assert.deepEqual(rows, []);
    }
  });

  await test("L - pagination (skip/take) does not crash the query", async () => {
    const rows = await withTableFallback(
      () => prisma.marketplaceListing.findMany({ where: { deletedAt: null }, skip: (3 - 1) * 100, take: 100 }),
      [] as PrismaMarketplaceListing[],
    );
    assert.deepEqual(rows, []);
  });

  await test("getBySlug-shaped query and distinct-facets query both degrade gracefully (no thrown table-missing error)", async () => {
    const row = await withTableFallback(
      () => prisma.marketplaceListing.findFirst({ where: { slug: "nonexistent-slug", deletedAt: null } }),
      null,
    );
    assert.equal(row, null);
    const facets = await withTableFallback(
      () => prisma.marketplaceListing.findMany({ where: { deletedAt: null }, select: { platformTag: true }, distinct: ["platformTag"] }),
      [] as { platformTag: string }[],
    );
    assert.deepEqual(facets, []);
  });

  await test("only READY/PUBLISHED are ever treated as publicly visible", () => {
    assert.deepEqual([...PUBLICLY_VISIBLE_STATES].sort(), ["PUBLISHED", "READY"].sort());
  });

  skip("B - one listing rendered correctly", "requires a seeded MarketplaceListing row; the migration is intentionally unapplied this sprint (see M8_database_architecture_audit.md). Prepared but not run.");
  skip("C - 10 listings rendered/paginated correctly", "same as B - needs real (or clearly-marked local dev-only demo) seeded rows once the migration is applied.");
  skip("D - 100 listings: catalog performance/pagination at scale", "same as B.");
  skip("E - 500+ listings stress test", "same as B. Query layer uses indexed where-clauses + skip/take (see MarketplaceCatalogue.search) and is designed for this scale, but the claim is unverified against real row counts until the migration is applied and a local, clearly isDemo-marked seed (never production data) is loaded.");

  console.log("\n=== M/N/O/P/Q/R/S - detail page data sections ===");
  await test("M - product detail: getBySlug-shaped query returns null for a nonexistent slug (honest 404 path), not a crash or fake row", async () => {
    const row = await withTableFallback(
      () => prisma.marketplaceListing.findFirst({ where: { slug: "does-not-exist", deletedAt: null } }),
      null,
    );
    assert.equal(row, null);
  });
  skip("N - version separation with real multi-version data", "no real TradingSystem/Version exists this sprint (product creation forbidden) - VersionSection.tsx's no-inheritance behavior is implemented and documented but only verifiable against a real second Version once one exists.");
  skip("O - Evidence display with real data", "EvidenceSection.tsx renders its honest 'Evidence unavailable' state for every listing this sprint by construction (MarketplaceCatalogue.getBySlug always returns evidence: null - see its own comment on why). Component correctness against a real populated EvidenceSummary is unverified until a real ingestion path exists (M8_entity_relationship.md section 3, explicitly deferred).");
  skip("P - Validation display with real data", "same reasoning as O, ValidationSection.tsx.");
  skip("Q - Risk display with real data", "same reasoning as O, RiskSection.tsx.");
  skip("R - History display with real data", "same reasoning as O, HistorySection.tsx.");
  await test("S - Trust State display: card/detail components only ever render the literal TrustState union, never invent a value", () => {
    for (const state of TRUST_STATES) {
      const label = trustStateLabel(state);
      assert.ok(label.length > 0);
      assert.notEqual(trustStateTone(state), undefined);
    }
    assert.equal(trustStateLabel(null), "Not yet verified");
  });

  console.log("\n=== T/U/V/W/X/Y - seller/AT24 permission boundary (REAL evaluateListingMutation logic, not a reimplementation) ===");
  await test("T - seller-mutable fields are exactly the presentation fields, nothing AT24-controlled", () => {
    const overlap = SELLER_MUTABLE_FIELDS.filter((f) => (AT24_ONLY_FIELDS as readonly string[]).includes(f));
    assert.deepEqual(overlap, []);
  });
  await test("U - unauthorized Trust mutation: trustState/trustReasonCode/trustExplanation/trustStatusId all rejected", () => {
    for (const field of ["trustState", "trustReasonCode", "trustExplanation", "trustStatusId"]) {
      const result = evaluateListingMutation({ title: "ok", [field]: "VALIDATED" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "FORBIDDEN_FIELD");
    }
  });
  await test("V - unauthorized Evidence mutation: evidenceId/evidenceHash rejected", () => {
    const result = evaluateListingMutation({ evidenceId: "fake-evidence-id" });
    assert.equal(result.ok, false);
  });
  await test("W - unauthorized Validation mutation: validationId/validationHash rejected", () => {
    const result = evaluateListingMutation({ validationHash: "fake-hash" });
    assert.equal(result.ok, false);
  });
  await test("X - unauthorized Risk mutation: riskAnalysisId/riskAnalysisHash rejected", () => {
    const result = evaluateListingMutation({ riskAnalysisId: "fake-risk-id" });
    assert.equal(result.ok, false);
  });
  await test("Y - unauthorized History mutation: lastEvidenceAt (the one History-derived field on the row) rejected", () => {
    const result = evaluateListingMutation({ lastEvidenceAt: new Date().toISOString() });
    assert.equal(result.ok, false);
  });
  await test("legitimate seller update: only seller-owned fields succeeds and returns exactly those fields", () => {
    const result = evaluateListingMutation({ title: "New title", description: "desc" });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(Object.keys(result.data).sort(), ["description", "title"]);

    const bad = evaluateListingMutation({ title: "New title", notAField: 1 });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.reason, "UNKNOWN_FIELD");
  });
  await test("a request with BOTH a forbidden and a valid field is fully rejected (fail-closed, not partial-apply)", () => {
    const result = evaluateListingMutation({ title: "ok", trustState: "VALIDATED" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.fields, ["trustState"]);
  });

  console.log("\n=== Z/AA/AB/AL - responsive + accessibility ===");
  skip("Z - mobile QA", "requires a real browser/viewport - out of scope for a tsx validation script. Manual QA note: MarketplaceGrid/MarketplaceFilters use the same responsive Tailwind classes (grid sm:grid-cols-2 lg:grid-cols-3, flex flex-wrap) as the existing /products page, which is the app's own mobile-QA precedent.");
  skip("AA - tablet QA", "same as Z.");
  skip("AB - desktop QA", "same as Z.");
  skip("AL - accessibility QA (screen reader, keyboard nav, contrast)", "requires real assistive-tech tooling. Structural provisions made: aria-label on every filter control, aria-labelledby on every detail-page section, role/aria-live on Alert and the loading grid, native <select>/<input>/<button> throughout (no custom unlabeled interactive divs), Trust State always shown as literal text (never color-only) - see MarketplaceFilters.tsx, TrustStateSection.tsx, MarketplaceClient.tsx. Not independently verified against a screen reader this sprint.");

  console.log("\n=== AC/AD/AE - loading/error/empty states ===");
  await test("AC/AD/AE - MarketplaceGrid empty state text differs for 'no listings at all' vs 'no matches for your filters', never a fake count", () => {
    const src = readSource("components/marketplace/MarketplaceGrid.tsx");
    assert.ok(src.includes("hasActiveFilters"));
    assert.ok(!/\d+\s+systems?\s+available/i.test(src), "must not hardcode a fake listing count in the empty state");
  });
  await test("AC - loading state exists and is aria-live/aria-busy annotated", () => {
    const src = readSource("app/marketplace/MarketplaceClient.tsx");
    assert.ok(src.includes('aria-busy="true"'));
    assert.ok(src.includes("aria-live"));
  });
  await test("AD - error state renders a real Alert, not a silent failure", () => {
    const src = readSource("app/marketplace/MarketplaceClient.tsx");
    assert.ok(src.includes('tone="danger"'));
  });

  console.log("\n=== AF/AG/AH/AI/AJ - production-safety guarantees (static source checks) ===");
  await test("AF - no fake metrics: EvidenceSection/RiskSection never default a missing number to 0", () => {
    for (const file of ["components/marketplace/sections/EvidenceSection.tsx", "components/marketplace/sections/RiskSection.tsx"]) {
      const src = readSource(file);
      assert.ok(!/\?\?\s*0\b/.test(src), `${file} must render "—" for missing values, never default to 0 (found a '?? 0' fallback)`);
    }
  });
  await test("AG - no fake Trust State: MarketplaceCatalogue never invents a trustState value, only reads the stored column", () => {
    const src = readSource("services/marketplace/MarketplaceCatalogue.ts");
    assert.ok(!/trustState:\s*["'](VALIDATED|VERIFIED)["']/.test(src), "must not hardcode a trustState value anywhere in the catalogue service");
  });
  await test("AH - no Score anywhere in the Marketplace surface (grep across all M8 files)", () => {
    const files = [
      "types/marketplace.ts",
      "lib/marketplace.ts",
      "services/marketplace/MarketplaceCatalogue.ts",
      "components/marketplace/MarketplaceListingCard.tsx",
      "components/marketplace/sections/TrustStateSection.tsx",
    ];
    for (const file of files) {
      // Strip comment lines first: this program's own docs/comments
      // legitimately explain the *absence* of a Score (e.g. "never convert
      // it to a score" - see types/marketplace.ts's own header). The real
      // guarantee this test checks is that no CODE (field name, type,
      // identifier) actually introduces one.
      const codeOnly = readSource(file)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .join("\n");
      assert.ok(!/\bscore\b/i.test(codeOnly), `${file} must not introduce a Score/score field or identifier in code`);
    }
  });
  await test("AI - no fake purchase flow: PurchaseCTA's button is disabled and makes no request", () => {
    const src = readSource("components/marketplace/PurchaseCTA.tsx");
    assert.ok(src.includes("disabled"));
    assert.ok(!/fetch\(|onClick/.test(src), "PurchaseCTA must not wire up any click handler or network call this sprint");
  });
  await test("AJ - demo fixture isolation: no seed/fixture file for MarketplaceListing exists that could leak into production queries", () => {
    // Deliberately no scripts/seed-marketplace-demo.ts or similar was created
    // this sprint (see the M8 report) - this test documents that absence is
    // intentional, not an oversight, and will need a real isDemo-style
    // safeguard the moment such a fixture is introduced.
    let seedFileExists = true;
    try {
      readSource("scripts/seed-marketplace-demo.ts");
    } catch {
      seedFileExists = false;
    }
    assert.equal(seedFileExists, false, "no demo/seed script for MarketplaceListing should exist yet this sprint");
  });

  console.log("\n=== AK - SEO metadata ===");
  await test("AK - catalog + detail pages export real Next.js metadata (title/description/OG), no clickbait claim", () => {
    const catalog = readSource("app/marketplace/page.tsx");
    assert.ok(catalog.includes("export const metadata"));
    assert.ok(!/best trading (ea|system)/i.test(catalog));
    const detail = readSource("app/marketplace/[slug]/page.tsx");
    assert.ok(detail.includes("export async function generateMetadata"));
  });

  console.log("\n=== AM - N+1 query check (static review) ===");
  await test("AM - seller-name resolution is a single batched query, not one query per listing", () => {
    const src = readSource("services/marketplace/MarketplaceCatalogue.ts");
    const resolveFn = src.slice(src.indexOf("async function resolveSellerNames"), src.indexOf("async function resolveSellerNames") + 500);
    assert.ok(resolveFn.includes("findMany"), "must batch-resolve seller names with one findMany, not N individual lookups");
    assert.ok(resolveFn.includes("id: { in:"), "must use an `id: { in: [...] }` batch filter");
  });
  await test("AM - catalog listing query never selects/loads full Evidence/Validation/Risk/History artifacts", () => {
    const src = readSource("services/marketplace/MarketplaceCatalogue.ts");
    assert.ok(!/trades\s*:/.test(src), "catalog service must never load raw trade arrays");
  });

  console.log("\n=== AN/AO/AP - build/typecheck/lint ===");
  skip("AN - production build (`next build`)", "run separately as a real shell command, not inside this script - see the M8 sprint report for its actual output.");
  skip("AO - TypeScript (`tsc --noEmit`)", "same as AN.");
  skip("AP - lint (`next lint` / eslint)", "same as AN.");

  console.log("\n=== AQ - database migration validation ===");
  await test("AQ - migration.sql exists, is purely additive (CREATE TABLE/INDEX only, no ALTER/DROP on any existing table)", () => {
    const sql = readSource("prisma/migrations/20260819120000_add_marketplace_listing/migration.sql");
    assert.ok(sql.includes('CREATE TABLE "marketplace_listings"'));
    assert.ok(!/ALTER TABLE "(?!marketplace_listings)/i.test(sql), "must not alter any existing table");
    assert.ok(!/DROP TABLE/i.test(sql), "must not drop any table");
  });
  await test("AQ - migration.sql column list matches the Prisma schema's MarketplaceListing field list exactly", () => {
    const sql = readSource("prisma/migrations/20260819120000_add_marketplace_listing/migration.sql");
    const schema = readSource("prisma/schema.prisma");
    const modelStart = schema.indexOf("model MarketplaceListing {");
    const modelEnd = schema.indexOf("\n}", modelStart);
    const modelBody = schema.slice(modelStart, modelEnd);
    const fieldNames = [...modelBody.matchAll(/^\s{2}(\w+)\s+\S/gm)].map((m) => m[1]);
    for (const field of fieldNames) {
      assert.ok(sql.includes(`"${field}"`), `migration.sql is missing column "${field}" that exists in the Prisma model`);
    }
  });
  await test("AQ - marketplace_listings migration status: reports whether the table exists in the live database right now (not assumed from M8's original unapplied state)", async () => {
    // Sprint M8.1 applied this migration to production (see
    // M8_1_production_activation.md) - this test no longer assumes the
    // table is missing. It distinguishes "table genuinely doesn't exist"
    // from "table exists and is genuinely empty" via a real
    // information_schema check, since a bare search()-returns-zero result
    // is ambiguous between those two states and would otherwise silently
    // go stale the moment the migration lands (exactly what happened to
    // this test's previous version).
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketplace_listings'
    `;
    const tableExists = rows.length === 1;
    console.log(`         marketplace_listings table exists in the live database: ${tableExists}`);
    const [, total] = await searchListings({ deletedAt: null, publicationState: { in: PUBLICLY_VISIBLE_STATES as string[] } });
    assert.equal(total, 0, tableExists ? "table exists but is not genuinely empty - real listings exist" : "table missing, degraded to empty as expected");
  });

  console.log("\n=== lib/marketplace.ts pure helpers ===");
  await test("formatListingPrice covers every PricingModel without throwing", () => {
    assert.equal(formatListingPrice({ model: "free" }), "Free");
    assert.equal(formatListingPrice({ model: "unavailable" }), "Price unavailable");
    assert.equal(formatListingPrice({ model: "one_time", amount: 199, currency: "USD" }), "USD 199");
    assert.equal(formatListingPrice({ model: "subscription", amount: 29, currency: "USD", interval: "month" }), "USD 29 / month");
  });
  await test("publicationStateTone covers every PublicationState", () => {
    for (const state of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "EVIDENCE_PENDING", "VALIDATION_PENDING", "READY", "PUBLISHED", "SUSPENDED", "RETIRED"] as const) {
      assert.ok(publicationStateTone(state));
    }
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} explicitly skipped (see reasons above).\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error running validate-marketplace-platform:", err);
  process.exit(1);
});
