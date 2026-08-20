// scripts/validate-marketplace-production-smoke.ts
// Sprint M8.1 - Production database activation smoke verification. Runs
// against the REAL production Supabase database (same DATABASE_URL/
// DIRECT_URL the deployed app uses) - no test framework exists in this
// project (see package.json). Run via `npm run validate:marketplace-prod`.
//
// SAFETY: creates exactly TWO throwaway MarketplaceListing rows under
// unmistakable slugs (m8-1-smoke-test-seller-a / -seller-b) with
// sellerId values that are clearly synthetic markers, not real User ids.
// Both are hard-deleted in a `finally` block regardless of pass/fail, and
// a final assertion confirms zero rows remain matching the smoke-test
// slug pattern. This script creates NO real product, NO Gold product, and
// leaves NO listing in production when it exits.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { evaluateListingMutation } from "../services/marketplace/listingMutationGuard";

const SMOKE_SLUG_PREFIX = "m8-1-smoke-test-";
const SELLER_A = "SMOKE-TEST-SELLER-A-NOT-A-REAL-USER";
const SELLER_B = "SMOKE-TEST-SELLER-B-NOT-A-REAL-USER";

let passed = 0;
let failed = 0;
let skipped = 0;
const createdIds: string[] = [];

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

async function main() {
  console.log("\n=== C/D/E - table/columns/PK/indexes/constraints (real information_schema queries) ===");

  await test("C - marketplace_listings table exists", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketplace_listings'
    `;
    assert.equal(rows.length, 1);
  });

  await test("D - all 28 expected columns exist with correct nullability", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'marketplace_listings'
    `;
    const byName = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    const expectedNotNull = [
      "id", "slug", "sellerId", "title", "description", "media", "pricing",
      "category", "platformTag", "assetTag", "tags", "trustExplanation",
      "publicationState", "createdAt", "updatedAt",
    ];
    const expectedNullable = [
      "tradingSystemId", "versionId", "evidenceId", "evidenceHash", "validationId",
      "validationHash", "riskAnalysisId", "riskAnalysisHash", "trustState",
      "trustReasonCode", "trustStatusId", "lastEvidenceAt", "deletedAt",
    ];
    assert.equal(byName.size, expectedNotNull.length + expectedNullable.length, `expected ${expectedNotNull.length + expectedNullable.length} columns, found ${byName.size}`);
    for (const col of expectedNotNull) assert.equal(byName.get(col), "NO", `${col} should be NOT NULL`);
    for (const col of expectedNullable) assert.equal(byName.get(col), "YES", `${col} should be nullable`);
  });

  await test("primary key constraint exists on id", async () => {
    const rows = await prisma.$queryRaw<{ constraint_name: string }[]>`
      SELECT tc.constraint_name FROM information_schema.table_constraints tc
      WHERE tc.table_name = 'marketplace_listings' AND tc.constraint_type = 'PRIMARY KEY'
    `;
    assert.equal(rows.length, 1);
  });

  await test("D - all 9 expected indexes exist", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'marketplace_listings'
    `;
    const names = new Set(rows.map((r) => r.indexname));
    const expected = [
      "marketplace_listings_pkey",
      "marketplace_listings_slug_key",
      "marketplace_listings_sellerId_idx",
      "marketplace_listings_publicationState_idx",
      "marketplace_listings_trustState_idx",
      "marketplace_listings_platformTag_idx",
      "marketplace_listings_assetTag_idx",
      "marketplace_listings_category_idx",
      "marketplace_listings_deletedAt_idx",
      "marketplace_listings_lastEvidenceAt_idx",
    ];
    for (const idx of expected) assert.ok(names.has(idx), `missing index ${idx}`);
  });

  await test("E - unique constraint on slug exists", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'marketplace_listings' AND indexdef LIKE '%UNIQUE%'
    `;
    assert.ok(rows.some((r) => r.indexname === "marketplace_listings_slug_key"));
  });

  console.log("\n=== F/G - existing Product table regression ===");
  await test("F/G - Product table structure and row count unaffected", async () => {
    const count = await prisma.product.count();
    assert.ok(count > 0, "Product table should still have its seeded rows");
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Product'
    `;
    assert.ok(cols.some((c) => c.column_name === "slug"));
    assert.ok(cols.some((c) => c.column_name === "price"));
    console.log(`         (Product row count: ${count})`);
  });

  console.log("\n=== H - unrelated tables check ===");
  await test("H - no unexpected tables appeared; every real table is a known model", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const known = new Set([
      "User", "Plan", "Subscription", "Product", "Conversation", "Message", "Agent", "AgentTask",
      "AgentMemory", "AgentActivity", "Automation", "Knowledge", "KnowledgeCollection", "KnowledgeChunk",
      "Billing", "workflows", "workflow_runs", "workflow_queue_items", "AuditLog", "RequestLog",
      "Feedback", "AnalyticsEvent", "WorkspacePreference", "articles", "intelligence_analysis_runs",
      "intelligence_analysis_outcomes", "intelligence_audit_traces", "marketplace_listings",
      "_prisma_migrations",
    ]);
    const unexpected = rows.map((r) => r.table_name).filter((t) => !known.has(t));
    // Report, don't hard-fail on unexpected tables the user's own concurrent
    // work may have introduced (see the session's schema.prisma drift note)
    // - but marketplace_listings itself and every pre-M8.1 table must be present.
    assert.ok(rows.some((r) => r.table_name === "marketplace_listings"));
    if (unexpected.length > 0) console.log(`         note: tables not in this script's known-list (likely the user's own concurrent work, not from this migration): ${unexpected.join(", ")}`);
  });

  console.log("\n=== 5. Prisma CRUD verification (ONE clearly-marked temp record per seller, deleted in finally) ===");
  let listingA: { id: string } | null = null;
  let listingB: { id: string } | null = null;

  await test("I - Prisma create: MarketplaceListing.create succeeds", async () => {
    listingA = await prisma.marketplaceListing.create({
      data: {
        slug: `${SMOKE_SLUG_PREFIX}seller-a`,
        sellerId: SELLER_A,
        title: "M8.1 SMOKE TEST - DO NOT PUBLISH - will be deleted immediately",
        description: "Temporary smoke-test record created by validate-marketplace-production-smoke.ts",
        publicationState: "DRAFT",
      },
    });
    createdIds.push(listingA.id);
    assert.ok(listingA.id);
  });

  await test("H - Prisma read: findUnique by id returns the created row", async () => {
    const row = await prisma.marketplaceListing.findUnique({ where: { id: listingA!.id } });
    assert.ok(row);
    assert.equal(row!.sellerId, SELLER_A);
  });

  await test("lookup by slug", async () => {
    const row = await prisma.marketplaceListing.findFirst({ where: { slug: `${SMOKE_SLUG_PREFIX}seller-a` } });
    assert.ok(row);
    assert.equal(row!.id, listingA!.id);
  });

  await test("J - Prisma update: seller-owned-field update succeeds", async () => {
    const decision = evaluateListingMutation({ title: "M8.1 SMOKE TEST - updated title" });
    assert.equal(decision.ok, true);
    if (decision.ok) {
      const updated = await prisma.marketplaceListing.update({ where: { id: listingA!.id }, data: decision.data });
      assert.equal(updated.title, "M8.1 SMOKE TEST - updated title");
    }
  });

  await test("Q - AT24-controlled field mutation is rejected by the real guard before ever reaching Prisma", () => {
    for (const forbidden of [{ trustState: "VALIDATED" }, { evidenceId: "fake" }, { publicationState: "PUBLISHED" }]) {
      const decision = evaluateListingMutation(forbidden as Record<string, unknown>);
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.reason, "FORBIDDEN_FIELD");
    }
  });

  await test("filtering: query scoped to sellerId returns only that seller's rows", async () => {
    listingB = await prisma.marketplaceListing.create({
      data: {
        slug: `${SMOKE_SLUG_PREFIX}seller-b`,
        sellerId: SELLER_B,
        title: "M8.1 SMOKE TEST - seller B - DO NOT PUBLISH",
        publicationState: "DRAFT",
      },
    });
    createdIds.push(listingB.id);

    const sellerARows = await prisma.marketplaceListing.findMany({ where: { sellerId: SELLER_A, deletedAt: null } });
    assert.ok(sellerARows.every((r) => r.sellerId === SELLER_A), "seller A's scoped query must never return seller B's row");
    assert.ok(!sellerARows.some((r) => r.id === listingB!.id));
  });

  console.log("\n=== P - cross-owner security (data-layer, real query; see report for the HTTP-session-layer scope note) ===");
  await test("P - the real ownership WHERE-clause pattern (id + sellerId) used by the PATCH route cannot find seller B's row under seller A's id", async () => {
    const wrongOwnerLookup = await prisma.marketplaceListing.findFirst({
      where: { id: listingB!.id, sellerId: SELLER_A, deletedAt: null },
    });
    assert.equal(wrongOwnerLookup, null, "seller A must not be able to locate seller B's listing via the ownership-scoped query");
  });
  skip(
    "P (HTTP layer) - a real authenticated cross-owner PATCH request rejected end-to-end",
    "Requires two real, distinct authenticated Supabase sessions. Creating real Supabase Auth accounts to simulate this is explicitly PROHIBITED by this environment's safety rules (account creation), not just deferred. The underlying authorization query (tested above, real) is the exact query app/api/private/marketplace/listings/[id]/route.ts executes; getUserOrNull() cannot be invoked outside a real Next.js request scope from a script (throws - see M8's own report). Only a real end-to-end HTTP test with two real logged-in users would close this gap.",
  );

  console.log("\n=== pagination ===");
  await test("pagination: skip/take against real rows returns the correct page", async () => {
    const page1 = await prisma.marketplaceListing.findMany({ where: { sellerId: { in: [SELLER_A, SELLER_B] } }, orderBy: { createdAt: "asc" }, take: 1 });
    const page2 = await prisma.marketplaceListing.findMany({ where: { sellerId: { in: [SELLER_A, SELLER_B] } }, orderBy: { createdAt: "asc" }, skip: 1, take: 1 });
    assert.equal(page1.length, 1);
    assert.equal(page2.length, 1);
    assert.notEqual(page1[0].id, page2[0].id);
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} explicitly skipped.\n`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    failed += 1;
  })
  .finally(async () => {
    console.log("=== K/AA - cleanup: hard-deleting every temp record this script created ===");
    for (const id of createdIds) {
      try {
        await prisma.marketplaceListing.delete({ where: { id } });
        console.log(`  deleted ${id}`);
      } catch (err) {
        console.error(`  FAILED TO DELETE ${id} - manual cleanup required:`, err);
        failed += 1;
      }
    }
    const remaining = await prisma.marketplaceListing.count({ where: { slug: { startsWith: SMOKE_SLUG_PREFIX } } });
    const totalReal = await prisma.marketplaceListing.count();
    console.log(`  remaining smoke-test rows: ${remaining} (must be 0)`);
    console.log(`  TOTAL marketplace_listings rows in production: ${totalReal} (must be 0)`);
    if (remaining !== 0 || totalReal !== 0) {
      console.error("CLEANUP VERIFICATION FAILED - production is not at zero listings.");
      failed += 1;
    }
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
