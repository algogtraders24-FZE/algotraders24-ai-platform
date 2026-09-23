// scripts/validate-payment-links.ts
// Shareable Payment Links - standalone validation against the REAL
// database (no test framework in this project - see package.json),
// matching the existing scripts/validate-payment-infrastructure.ts
// convention. Run via `npm run validate:payment-links`.
//
// Deliberately does NOT trigger a real payment or call either payment
// provider - Stripe/NOWPayments network calls only happen inside the
// checkout route (app/api/private/payment-links/[token]/checkout/
// route.ts), which also requires a real authenticated session
// (getUserOrNull -> Supabase cookies), not practical to construct outside
// a real HTTP request in a standalone script - the same reason no existing
// script in this repo calls checkout/route.ts or crypto-invoice/route.ts
// directly either (only the webhook routes, which are signature-authed,
// not session-authed, get called directly - see
// validate-marketplace-purchase-idempotency.ts). This script instead
// covers 100% of paymentLinkService.ts - the layer that actually contains
// every piece of business logic the owner's 3 corrections were about
// (atomic maxUses, price freshness, lifecycle enforcement) - against real
// throwaway fixtures.
//
// Safety: one run-tagged throwaway User + MarketplaceListing +
// ReleaseArtifact + however many PaymentLink rows the tests create, all
// hard-deleted in a `finally` block regardless of pass/fail.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import {
  createPaymentLink,
  resolvePaymentLink,
  recordPaymentLinkUse,
  revokePaymentLink,
  listPaymentLinks,
} from "../services/marketplace/paymentLinkService";

const RUN_TAG = `paylinks-${Date.now()}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

async function createListing(overrides: Partial<{ amount: number; publicationState: string }> = {}) {
  return prisma.marketplaceListing.create({
    data: {
      slug: `${RUN_TAG}-${Math.random().toString(36).slice(2, 8)}`,
      sellerId: `${RUN_TAG}-seller`,
      title: "Validation Listing",
      description: "Throwaway fixture for validate-payment-links.ts",
      pricing: { model: "one_time", amount: overrides.amount ?? 99, currency: "USD" },
      tradingSystemId: `${RUN_TAG}-ts`,
      versionId: `${RUN_TAG}-v1`,
      platformTag: "MT5",
      publicationState: overrides.publicationState ?? "PUBLISHED",
    },
  });
}

async function main(): Promise<void> {
  const admin = await prisma.user.create({
    data: { email: `${RUN_TAG}-admin@internal.test`, name: "Validation Admin", planId: "free", role: "admin" },
  });
  const listing = await createListing();
  await prisma.releaseArtifact.create({
    data: {
      tradingSystemId: listing.tradingSystemId!,
      versionId: listing.versionId!,
      marketplaceListingId: listing.id,
      platform: listing.platformTag,
      artifactVersion: "1.0.0",
      artifactHash: `${RUN_TAG}-hash`,
      releaseStatus: "PUBLISHED",
    },
  });

  const createdLinkIds: string[] = [];
  const createdListingIds = [listing.id];

  try {
    // ---- createPaymentLink ----

    let firstToken = "";
    await test("createPaymentLink: succeeds for a real purchasable listing, token has the expected prefix", async () => {
      const result = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id });
      assert.ok(!("code" in result));
      if (!("code" in result)) {
        createdLinkIds.push(result.id);
        firstToken = result.token;
        assert.ok(result.token.startsWith("at24_pay_"), "token must carry the at24_pay_ prefix");
        assert.ok(result.token.length > 30, "token must be high-entropy, not a short/guessable value");
      }
    });

    await test("createPaymentLink: rejects a nonexistent listing", async () => {
      const result = await createPaymentLink({ listingId: "not-a-real-listing-id", createdByUserId: admin.id });
      assert.ok("code" in result && result.code === "NOT_FOUND");
    });

    await test("createPaymentLink: rejects a listing with no valid one-time price", async () => {
      const badListing = await createListing({ amount: 0 });
      createdListingIds.push(badListing.id);
      const result = await createPaymentLink({ listingId: badListing.id, createdByUserId: admin.id });
      assert.ok("code" in result && result.code === "NOT_PURCHASABLE");
    });

    await test("createPaymentLink: two links for the same listing get distinct tokens", async () => {
      const result = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id });
      assert.ok(!("code" in result));
      if (!("code" in result)) {
        createdLinkIds.push(result.id);
        assert.notEqual(result.token, firstToken);
      }
    });

    // ---- resolvePaymentLink ----

    await test("resolvePaymentLink: an ACTIVE link resolves with the listing's current data", async () => {
      const resolved = await resolvePaymentLink(firstToken);
      assert.ok(!("code" in resolved));
      if (!("code" in resolved)) {
        assert.equal(resolved.listing.id, listing.id);
        assert.equal(resolved.listing.amount, 99);
      }
    });

    await test("resolvePaymentLink: reflects the listing's CURRENT price, never a value frozen at link-creation time", async () => {
      await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { pricing: { model: "one_time", amount: 149, currency: "USD" } } });
      try {
        const resolved = await resolvePaymentLink(firstToken);
        assert.ok(!("code" in resolved));
        if (!("code" in resolved)) {
          assert.equal(resolved.listing.amount, 149, "must reflect the new price, not the 99 it was created against");
        }
      } finally {
        await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { pricing: { model: "one_time", amount: 99, currency: "USD" } } });
      }
    });

    await test("resolvePaymentLink: a nonexistent token resolves to NOT_FOUND", async () => {
      const resolved = await resolvePaymentLink("at24_pay_does-not-exist");
      assert.ok("code" in resolved && resolved.code === "NOT_FOUND");
    });

    let revokedToken = "";
    await test("resolvePaymentLink: a revoked link resolves to NOT_FOUND (no token-enumeration signal)", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        revokedToken = created.token;
        const wasRevoked = await revokePaymentLink(created.id);
        assert.equal(wasRevoked, true);
        const resolved = await resolvePaymentLink(created.token);
        assert.ok("code" in resolved && resolved.code === "NOT_FOUND");
      }
    });

    await test("resolvePaymentLink: an expired link resolves to NOT_FOUND", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id, expiresAt: new Date(Date.now() - 60_000) });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        const resolved = await resolvePaymentLink(created.token);
        assert.ok("code" in resolved && resolved.code === "NOT_FOUND");
      }
    });

    await test("resolvePaymentLink: a listing that's no longer purchasable resolves to LISTING_UNAVAILABLE", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { publicationState: "SUSPENDED" } });
        try {
          const resolved = await resolvePaymentLink(created.token);
          assert.ok("code" in resolved && resolved.code === "LISTING_UNAVAILABLE");
        } finally {
          await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { publicationState: "PUBLISHED" } });
        }
      }
    });

    // ---- recordPaymentLinkUse: atomicity ----

    await test("recordPaymentLinkUse: succeeds and increments usageCount on an ACTIVE link under its cap", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id, maxUses: 3 });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        const ok = await recordPaymentLinkUse(created.token);
        assert.equal(ok, true);
        const row = await prisma.paymentLink.findUnique({ where: { id: created.id } });
        assert.equal(row?.usageCount, 1);
      }
    });

    await test("recordPaymentLinkUse: rejects once maxUses is reached (no over-increment)", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id, maxUses: 2 });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        assert.equal(await recordPaymentLinkUse(created.token), true);
        assert.equal(await recordPaymentLinkUse(created.token), true);
        assert.equal(await recordPaymentLinkUse(created.token), false, "third attempt must be rejected");
        const row = await prisma.paymentLink.findUnique({ where: { id: created.id } });
        assert.equal(row?.usageCount, 2, "usageCount must never exceed maxUses");
      }
    });

    await test("recordPaymentLinkUse: the owner's mandatory correction - concurrent requests against maxUses=1 never both succeed", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id, maxUses: 1 });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        const results = await Promise.all(Array.from({ length: 8 }, () => recordPaymentLinkUse(created.token)));
        const successCount = results.filter(Boolean).length;
        assert.equal(successCount, 1, `exactly 1 of 8 concurrent attempts must succeed against maxUses=1, got ${successCount}`);
        const row = await prisma.paymentLink.findUnique({ where: { id: created.id } });
        assert.equal(row?.usageCount, 1, "usageCount must be exactly 1, never over-counted by the race");
      }
    });

    await test("recordPaymentLinkUse: rejects an expired link", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id, expiresAt: new Date(Date.now() - 60_000) });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        assert.equal(await recordPaymentLinkUse(created.token), false);
      }
    });

    await test("recordPaymentLinkUse: rejects a revoked link", async () => {
      const resolved = await resolvePaymentLink(revokedToken);
      assert.ok("code" in resolved, "sanity check - this token should already be revoked");
      assert.equal(await recordPaymentLinkUse(revokedToken), false);
    });

    // ---- revokePaymentLink ----

    await test("revokePaymentLink: idempotent - revoking an already-revoked link returns false, not an error", async () => {
      const created = await createPaymentLink({ listingId: listing.id, createdByUserId: admin.id });
      assert.ok(!("code" in created));
      if (!("code" in created)) {
        createdLinkIds.push(created.id);
        assert.equal(await revokePaymentLink(created.id), true);
        assert.equal(await revokePaymentLink(created.id), false);
      }
    });

    await test("revokePaymentLink: a nonexistent id returns false", async () => {
      assert.equal(await revokePaymentLink("not-a-real-id"), false);
    });

    // ---- listPaymentLinks ----

    await test("listPaymentLinks: paginates and joins the real listing title/slug", async () => {
      const result = await listPaymentLinks({ page: 1, pageSize: 100 });
      const ours = result.items.filter((i) => createdLinkIds.includes(i.id));
      assert.ok(ours.length > 0, "should find at least the links this run created");
      for (const item of ours) {
        assert.equal(item.listingTitle, "Validation Listing");
        assert.equal(item.listingSlug, listing.slug);
      }
    });
  } finally {
    // Each step is independently caught - one table/row failing to clean up
    // (e.g. this script running before its own migration was applied, as
    // happened once during development) must never block the rest of the
    // cleanup, unlike a bare sequential await chain would.
    const cleanupErrors: string[] = [];
    const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        cleanupErrors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    await safeDelete("payment_links", () => prisma.paymentLink.deleteMany({ where: { id: { in: createdLinkIds } } }));
    await safeDelete("release_artifacts", () => prisma.releaseArtifact.deleteMany({ where: { tradingSystemId: listing.tradingSystemId! } }));
    await safeDelete("marketplace_listings", () => prisma.marketplaceListing.deleteMany({ where: { id: { in: createdListingIds } } }));
    await safeDelete("user", () => prisma.user.deleteMany({ where: { id: admin.id } }));

    if (cleanupErrors.length > 0) {
      console.error("  WARNING: cleanup step(s) failed:");
      for (const e of cleanupErrors) console.error(`    ${e}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, listing, release artifact, payment links)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
