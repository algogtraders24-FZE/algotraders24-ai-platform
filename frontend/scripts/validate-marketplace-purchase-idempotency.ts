// scripts/validate-marketplace-purchase-idempotency.ts
// Sprint PAY-1 - Marketplace Stripe checkout idempotency hardening.
// Standalone validation against the REAL database (no test framework in
// this project - see package.json), matching the existing
// scripts/validate-payment-infrastructure.ts convention. Run via
// `npm run validate:marketplace-idempotency`.
//
// Exercises the REAL app/api/webhooks/stripe/route.ts POST handler
// directly (constructed Request objects, real Stripe test-mode signature
// verification via testClient.webhooks.generateTestHeaderString - same
// pure-local-crypto technique as validate-payment-infrastructure.ts, no
// network call to Stripe anywhere in this script) against real, throwaway
// MarketplaceListing/ReleaseArtifact/User fixtures, then asserts the real
// Purchase/Entitlement/License rows it produced (or didn't).
//
// Must run with `--conditions=react-server` (wired into the npm script,
// same technique as validate-economic-calendar.ts) so the
// `import "server-only"` guards in services/licensing/* resolve to their
// empty stub instead of throwing outside an RSC context - this script
// imports the real webhook route and licenseService.ts directly, not a
// reimplementation.
//
// Safety: every fixture is tagged with one run-unique string and
// hard-deleted in a `finally` block regardless of pass/fail, mirroring
// validate-payment-infrastructure.ts's own safety convention. Temporarily
// -set env vars (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET) are always
// restored. Real signed license issuance uses this environment's real
// LICENSE_SIGNING_PRIVATE_KEY/PUBLIC_KEY (already configured) - never a
// fabricated signature.
import "dotenv/config";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { issueLicenseForPurchase } from "../services/licensing/licenseService";
import { POST as stripeWebhook } from "../app/api/webhooks/stripe/route";
import type { PlatformName } from "../types/marketplace-factory";

const RUN_TAG = `pay1-${Date.now()}`;
const PLATFORM: PlatformName = "MT5";

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

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

const STRIPE_TEST_SECRET = "sk_test_fake";
const STRIPE_TEST_WEBHOOK_SECRET = "whsec_test_fake";

function marketplaceEvent(evtId: string, sessionId: string, metadata: Record<string, string>) {
  return {
    id: evtId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        amount_total: 4900,
        currency: "usd",
        metadata,
      },
    },
  };
}

function signedRequest(eventBody: unknown): Request {
  const payload = JSON.stringify(eventBody);
  const testClient = new Stripe(STRIPE_TEST_SECRET);
  const header = testClient.webhooks.generateTestHeaderString({ payload, secret: STRIPE_TEST_WEBHOOK_SECRET });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

function badSignatureRequest(eventBody: unknown): Request {
  const payload = JSON.stringify(eventBody);
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=not_a_real_signature", "content-type": "application/json" },
    body: payload,
  });
}

async function main(): Promise<void> {
  const buyer = await prisma.user.create({
    data: { email: `${RUN_TAG}@internal.test`, name: "PAY-1 Validation Buyer", planId: "free" },
  });
  const tradingSystemId = `PAY1-SYS-${RUN_TAG}`;
  const versionId = "v1";

  const listing = await prisma.marketplaceListing.create({
    data: {
      slug: `pay1-test-listing-${RUN_TAG}`,
      sellerId: `seller-${RUN_TAG}`,
      title: "PAY-1 Validation Listing",
      pricing: { model: "one_time", amount: 49, currency: "USD" },
      platformTag: PLATFORM,
      publicationState: "PUBLISHED",
      tradingSystemId,
      versionId,
    },
  });

  const release = await prisma.releaseArtifact.create({
    data: {
      tradingSystemId,
      versionId,
      marketplaceListingId: listing.id,
      platform: PLATFORM,
      artifactVersion: "1.0.0",
      artifactHash: `hash-${RUN_TAG}`,
      releaseStatus: "PUBLISHED",
    },
  });

  const metadata = {
    type: "marketplace_purchase",
    buyerId: buyer.id,
    listingId: listing.id,
    tradingSystemId,
    versionId,
    platform: PLATFORM,
    releaseId: release.id,
  };

  try {
    await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
      // ---- Case A: first delivery creates exactly one Purchase/Entitlement/License ----
      const sessionIdA = `cs_test_${RUN_TAG}_A`;
      const eventA = marketplaceEvent(`evt_test_${RUN_TAG}_A`, sessionIdA, metadata);

      await test("Case A - first webhook delivery: 200 + exactly one Purchase -> Entitlement -> License", async () => {
        const res = await stripeWebhook(signedRequest(eventA));
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, "ok");

        const purchase = await prisma.purchase.findUnique({
          where: { providerRef: sessionIdA },
          include: { entitlements: { include: { licenses: true } } },
        });
        assert.ok(purchase, "Purchase must exist");
        assert.equal(purchase!.status, "COMPLETED");
        assert.equal(purchase!.provider, "stripe");
        assert.equal(purchase!.buyerId, buyer.id);
        assert.equal(purchase!.marketplaceListingId, listing.id);
        assert.equal(purchase!.entitlements.length, 1, "exactly one Entitlement");
        const entitlement = purchase!.entitlements[0];
        assert.equal(entitlement.status, "ACTIVE");
        assert.equal(entitlement.licenses.length, 1, "exactly one License");
        const license = entitlement.licenses[0];
        assert.equal(license.buyerId, buyer.id);
        assert.equal(license.tradingSystemId, tradingSystemId);
        assert.equal(license.releaseId, release.id);
        assert.equal(license.licenseStatus, "ISSUED");

        assert.equal(await prisma.purchase.count({ where: { providerRef: sessionIdA } }), 1);
      });

      // ---- Case B: retried delivery of the SAME event must not duplicate anything ----
      await test("Case B - retried webhook delivery (identical providerRef): still exactly one Purchase/Entitlement/License", async () => {
        const before = await prisma.purchase.findUniqueOrThrow({ where: { providerRef: sessionIdA } });
        const res = await stripeWebhook(signedRequest(eventA));
        assert.equal(res.status, 200);

        assert.equal(await prisma.purchase.count({ where: { providerRef: sessionIdA } }), 1, "retry must not create a second Purchase");
        const entitlements = await prisma.entitlement.findMany({ where: { purchaseId: before.id } });
        assert.equal(entitlements.length, 1, "retry must not create a second Entitlement");
        const licenses = await prisma.license.findMany({ where: { entitlementId: entitlements[0].id } });
        assert.equal(licenses.length, 1, "retry must not create a second License");
      });

      // ---- Bonus: two concurrent deliveries of the same event (genuine DB race, not a sequential retry) ----
      await test("Case B2 - concurrent duplicate deliveries (race): still exactly one Purchase", async () => {
        const sessionIdRace = `cs_test_${RUN_TAG}_race`;
        const eventRace = marketplaceEvent(`evt_test_${RUN_TAG}_race`, sessionIdRace, metadata);
        const [r1, r2] = await Promise.all([stripeWebhook(signedRequest(eventRace)), stripeWebhook(signedRequest(eventRace))]);
        assert.equal(r1.status, 200);
        assert.equal(r2.status, 200);
        assert.equal(await prisma.purchase.count({ where: { providerRef: sessionIdRace } }), 1, "a genuine race between two concurrent deliveries must still yield exactly one Purchase");
      });

      // ---- Case D: invalid signature is rejected, nothing is created ----
      await test("Case D - invalid webhook signature: rejected, zero Purchase created", async () => {
        const sessionIdBad = `cs_test_${RUN_TAG}_bad_sig`;
        const eventBad = marketplaceEvent(`evt_test_${RUN_TAG}_bad_sig`, sessionIdBad, metadata);
        const res = await stripeWebhook(badSignatureRequest(eventBad));
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error.code, "INVALID_SIGNATURE");
        assert.equal(await prisma.purchase.count({ where: { providerRef: sessionIdBad } }), 0, "an unverified signature must never create a Purchase");
      });
    });

    // ---- Case C: ReleaseArtifact guard (service-level, real DB, defense in depth
    // behind the checkout route's own guard - see app/api/private/marketplace/
    // listings/[id]/checkout/route.ts's RELEASE_NOT_AVAILABLE check) ----
    await test("Case C - issueLicenseForPurchase refuses to issue when the release does not match tradingSystemId/versionId/platform", async () => {
      const before = await prisma.purchase.count({ where: { buyerId: buyer.id } });
      await assert.rejects(
        () =>
          issueLicenseForPurchase({
            buyerId: buyer.id,
            marketplaceListingId: listing.id,
            tradingSystemId: "SOME-OTHER-SYSTEM",
            versionId,
            releaseId: release.id,
            platform: PLATFORM,
            amount: 49,
            currency: "USD",
            expiresAt: null,
            provider: "stripe",
            providerRef: `cs_test_${RUN_TAG}_case_c`,
          }),
        /Release does not match/,
      );
      assert.equal(await prisma.purchase.count({ where: { buyerId: buyer.id } }), before, "a rejected release match must create zero Purchase rows");
    });

    await test("Case C2 - issueLicenseForPurchase refuses to issue for a nonexistent releaseId", async () => {
      const before = await prisma.purchase.count({ where: { buyerId: buyer.id } });
      await assert.rejects(
        () =>
          issueLicenseForPurchase({
            buyerId: buyer.id,
            marketplaceListingId: listing.id,
            tradingSystemId,
            versionId,
            releaseId: "does-not-exist",
            platform: PLATFORM,
            amount: 49,
            currency: "USD",
            expiresAt: null,
            provider: "stripe",
            providerRef: `cs_test_${RUN_TAG}_case_c2`,
          }),
        /Release does not match/,
      );
      assert.equal(await prisma.purchase.count({ where: { buyerId: buyer.id } }), before);
    });

    // ---- Direct-call idempotency proof at the service layer (belt-and-
    // suspenders on top of the webhook-level Case A/B/B2 above) ----
    await test("Service-level idempotency: calling issueLicenseForPurchase twice with the same providerRef returns the SAME license; second call is flagged duplicate", async () => {
      const providerRef = `cs_test_${RUN_TAG}_direct`;
      const input = {
        buyerId: buyer.id,
        marketplaceListingId: listing.id,
        tradingSystemId,
        versionId,
        releaseId: release.id,
        platform: PLATFORM,
        amount: 49,
        currency: "USD",
        expiresAt: null,
        provider: "stripe",
        providerRef,
      };
      const first = await issueLicenseForPurchase(input);
      assert.equal(first.duplicate, false);
      assert.ok(first.rawApiKey, "first issuance must return a raw API key");

      const second = await issueLicenseForPurchase(input);
      assert.equal(second.duplicate, true);
      assert.equal(second.rawApiKey, null, "a duplicate call must never mint/return a second raw API key");
      assert.equal(second.license.id, first.license.id, "must be the exact same License row, not a new one");

      const purchase = await prisma.purchase.findUniqueOrThrow({ where: { providerRef } });
      assert.equal(await prisma.license.count({ where: { entitlement: { purchaseId: purchase.id } } }), 1);
    });
  } finally {
    // ---- Cleanup: hard delete every row this script created, regardless
    // of pass/fail (mirrors validate-payment-infrastructure.ts). ----
    const purchases = await prisma.purchase.findMany({
      where: { buyerId: buyer.id },
      include: { entitlements: { include: { licenses: true } } },
    });
    for (const p of purchases) {
      for (const e of p.entitlements) {
        for (const l of e.licenses) {
          await prisma.activation.deleteMany({ where: { licenseId: l.id } });
          await prisma.license.delete({ where: { id: l.id } });
        }
        await prisma.entitlement.delete({ where: { id: e.id } });
      }
      await prisma.purchase.delete({ where: { id: p.id } });
    }
    await prisma.releaseArtifact.delete({ where: { id: release.id } }).catch(() => {});
    await prisma.marketplaceListing.delete({ where: { id: listing.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: buyer.id } }).catch(() => {});

    const leftover =
      (await prisma.purchase.count({ where: { buyerId: buyer.id } })) +
      (await prisma.marketplaceListing.count({ where: { id: listing.id } })) +
      (await prisma.user.count({ where: { id: buyer.id } }));
    if (leftover > 0) {
      console.error("  WARNING: some validation rows were not cleaned up");
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, listing, release, purchases, entitlements, licenses, activations)");
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
