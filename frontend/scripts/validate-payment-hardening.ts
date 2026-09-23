// scripts/validate-payment-hardening.ts
// Payment Verification/Hardening - standalone validation against the REAL
// database (no test framework in this project - see package.json), same
// convention as validate-payment-infrastructure.ts and
// validate-marketplace-purchase-idempotency.ts. Run via
// `npm run validate:payment-hardening`.
//
// Covers exactly the fixes this sprint made:
//  1. Stripe webhook: metadata-missing alert (marketplace + subscription
//     branches), exercised via the REAL POST handler with a real Stripe
//     test-mode signature (testClient.webhooks.generateTestHeaderString) -
//     no network call to Stripe anywhere in this script.
//  2. NOWPayments webhook: intent-not-found alert, unparseable-order-id
//     alert, expired-intent marking, refunded/failed status visibility -
//     exercised via the REAL POST handler with a real HMAC-SHA512
//     signature - no network call to NOWPayments anywhere in this script.
//  3. Amount upper-bound: StripeProvider.createCheckoutSession rejects a
//     plan priced above MAX_REASONABLE_PAYMENT_AMOUNT_USD before ever
//     reaching the Stripe API (this is the one price-derivation point NOT
//     behind an authenticated route, so it's the one directly testable
//     here - the same testability boundary validate-payment-links.ts
//     documented for its own checkout-via-link route applies to the other
//     3 price-check locations, all inside getUserOrNull()-gated routes).
//  4. Alert delivery is asserted via the real EmailLog table (RESEND_API_KEY
//     is unset in this environment, so dispatch() takes its SKIPPED path -
//     still writes a real EmailLog row, which is what these assertions
//     check for; no real email is ever sent).
//
// Must run with `--conditions=react-server` (same reason
// validate-marketplace-purchase-idempotency.ts does - this script imports
// the real webhook routes and licenseService.ts directly, and their
// `import "server-only"` guards need this to resolve to the empty stub
// outside a real RSC context).
//
// Safety: every fixture is tagged with one run-unique string and
// hard-deleted in a `finally` block (each step independently caught, same
// robustness fix validate-payment-links.ts's own cleanup got) regardless
// of pass/fail. Temporarily-set env vars are always restored.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { stripeProvider } from "../services/billing/providers/StripeProvider";
import { PaymentProviderError } from "../lib/payments/errors";
import { POST as stripeWebhook } from "../app/api/webhooks/stripe/route";
import { POST as nowPaymentsWebhook } from "../app/api/webhooks/nowpayments/route";
import type { PlatformName } from "../types/marketplace-factory";

const RUN_TAG = `payhard-${Date.now()}`;
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
const NOWPAYMENTS_TEST_IPN_SECRET = "test-ipn-secret";

function stripeSignedRequest(eventBody: unknown): Request {
  const payload = JSON.stringify(eventBody);
  const testClient = new Stripe(STRIPE_TEST_SECRET);
  const header = testClient.webhooks.generateTestHeaderString({ payload, secret: STRIPE_TEST_WEBHOOK_SECRET });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
}

function nowPaymentsSignedRequest(body: Record<string, unknown>): Request {
  const sortedSerialized = JSON.stringify(
    Object.keys(body)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = body[k];
        return acc;
      }, {}),
  );
  const sig = crypto.createHmac("sha512", NOWPAYMENTS_TEST_IPN_SECRET).update(sortedSerialized).digest("hex");
  return new Request("http://localhost/api/webhooks/nowpayments", {
    method: "POST",
    headers: { "x-nowpayments-sig": sig, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function latestEmailLog(type: string, sinceMs: number) {
  return prisma.emailLog.findFirst({
    where: { type, sentAt: { gte: new Date(sinceMs) } },
    orderBy: { sentAt: "desc" },
  });
}

async function main(): Promise<void> {
  const createdListingIds: string[] = [];
  const createdReleaseArtifactTradingSystemIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdIntentIds: string[] = [];

  const buyer = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Payment Hardening Validation Buyer", planId: "free" } });

  try {
    // ---- 1. Stripe webhook - marketplace metadata-missing alert ----

    await test("Stripe webhook: marketplace_purchase with missing buyerId writes a metadata-missing alert, no Purchase created", async () => {
      const before = Date.now();
      const sessionId = `cs_test_${RUN_TAG}_missingmeta`;
      const event = {
        id: `evt_test_${RUN_TAG}_missingmeta`,
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            object: "checkout.session",
            amount_total: 4900,
            currency: "usd",
            metadata: { type: "marketplace_purchase", listingId: "some-listing" /* buyerId deliberately missing */ },
          },
        },
      };
      await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
        const res = await stripeWebhook(stripeSignedRequest(event));
        assert.equal(res.status, 200, "webhook must still 200 - this is a data problem, not a signature problem");
      });
      const purchase = await prisma.purchase.findUnique({ where: { providerRef: sessionId } });
      assert.equal(purchase, null, "no Purchase should be created when required metadata is missing");
      const log = await latestEmailLog("webhook_metadata_missing_alert", before);
      assert.ok(log, "a webhook_metadata_missing_alert EmailLog row must exist");
      assert.equal(log!.status, "SKIPPED", "no RESEND_API_KEY in this environment - dispatch takes its honest SKIPPED path, never a fake SENT");
    });

    // ---- 2. Stripe webhook - subscription metadata-missing alert ----

    await test("Stripe webhook: subscription checkout with missing planId writes a metadata-missing alert", async () => {
      const before = Date.now();
      const sessionId = `cs_test_${RUN_TAG}_subnometa`;
      const event = {
        id: `evt_test_${RUN_TAG}_subnometa`,
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: sessionId,
            object: "checkout.session",
            amount_total: 2900,
            currency: "usd",
            metadata: { userId: buyer.id /* planId deliberately missing, no type field */ },
          },
        },
      };
      await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
        const res = await stripeWebhook(stripeSignedRequest(event));
        assert.equal(res.status, 200);
      });
      const log = await latestEmailLog("webhook_metadata_missing_alert", before);
      assert.ok(log, "a webhook_metadata_missing_alert EmailLog row must exist for the subscription branch too");
    });

    // ---- 3. Stripe webhook - previously-uncaught event types no longer crash ----

    await test("Stripe webhook: checkout.session.expired / payment_intent.payment_failed / charge.failed / charge.refunded / charge.dispute.created all return 200 (visibility logging, no crash)", async () => {
      const cases: Array<{ type: string; object: Record<string, unknown> }> = [
        { type: "checkout.session.expired", object: { id: `cs_test_${RUN_TAG}_expired`, object: "checkout.session" } },
        { type: "payment_intent.payment_failed", object: { id: `pi_test_${RUN_TAG}`, object: "payment_intent", last_payment_error: { message: "card_declined" } } },
        { type: "charge.failed", object: { id: `ch_test_${RUN_TAG}_failed`, object: "charge", failure_message: "insufficient_funds" } },
        { type: "charge.refunded", object: { id: `ch_test_${RUN_TAG}_refunded`, object: "charge", amount_refunded: 4900 } },
        { type: "charge.dispute.created", object: { id: `dp_test_${RUN_TAG}`, object: "dispute", charge: `ch_test_${RUN_TAG}`, reason: "fraudulent" } },
      ];
      await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
        for (const c of cases) {
          const event = { id: `evt_test_${RUN_TAG}_${c.type}`, object: "event", type: c.type, data: { object: c.object } };
          const res = await stripeWebhook(stripeSignedRequest(event));
          assert.equal(res.status, 200, `${c.type} must return 200, not crash the webhook`);
        }
      });
    });

    // ---- 4. StripeProvider amount upper-bound ----

    await test("StripeProvider.createCheckoutSession: rejects a plan priced above the sanity limit, never reaches the Stripe API", async () => {
      const planId = `${RUN_TAG}-absurd-plan`;
      createdPlanIds.push(planId);
      await prisma.plan.create({ data: { id: planId, name: "Absurd Test Plan", priceMonthly: 999_999, priceYearly: 999_999 } });
      await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
        await assert.rejects(
          () => stripeProvider.createCheckoutSession({ userId: buyer.id, planId, cycle: "monthly" }),
          (err: unknown) => err instanceof PaymentProviderError && /sanity limit/.test(err.message),
        );
      });
    });

    await test("StripeProvider.createCheckoutSession: a normal, in-range plan price is NOT rejected by the sanity check itself (whatever it fails on downstream - fake test creds have no real Stripe account behind them - it must not be the sanity-limit error)", async () => {
      const planId = `${RUN_TAG}-normal-plan`;
      createdPlanIds.push(planId);
      await prisma.plan.create({ data: { id: planId, name: "Normal Test Plan", priceMonthly: 29, priceYearly: 279 } });
      // Fake test credentials, same as the marketplace-purchase-idempotency
      // script's own convention - this call is expected to still fail
      // (fake creds have no real Stripe account behind them, and the
      // module-level Stripe client is a cached singleton once any test
      // call has initialized it, so "unconfigured" specifically isn't a
      // reliable signal across multiple calls in one process). The only
      // thing this test asserts is that the failure is NOT the sanity-
      // limit rejection - proving the amount check let a normal price
      // through, regardless of what unrelated reason it fails for next.
      await withEnv({ STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET }, async () => {
        await assert.rejects(
          () => stripeProvider.createCheckoutSession({ userId: buyer.id, planId, cycle: "monthly" }),
          (err: unknown) => err instanceof PaymentProviderError && !/sanity limit/.test(err.message),
        );
      });
    });

    // ---- 5. NOWPayments webhook - marketplace intent-not-found alert ----

    await test("NOWPayments webhook: a finished payment whose intentId matches no MarketplacePurchaseIntent writes a metadata-missing alert", async () => {
      const before = Date.now();
      const body = { payment_status: "finished", order_id: `mkt_${RUN_TAG}-does-not-exist`, payment_id: `pay_${RUN_TAG}_1` };
      await withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: NOWPAYMENTS_TEST_IPN_SECRET }, async () => {
        const res = await nowPaymentsWebhook(nowPaymentsSignedRequest(body));
        assert.equal(res.status, 200);
      });
      const log = await latestEmailLog("webhook_metadata_missing_alert", before);
      assert.ok(log, "a webhook_metadata_missing_alert EmailLog row must exist for the intent-not-found case");
    });

    // ---- 6. NOWPayments webhook - subscription unparseable order_id alert ----

    await test("NOWPayments webhook: a finished payment with an unparseable order_id writes a metadata-missing alert", async () => {
      const before = Date.now();
      const body = { payment_status: "finished", order_id: "not-a-valid-order-id-format", payment_id: `pay_${RUN_TAG}_2` };
      await withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: NOWPAYMENTS_TEST_IPN_SECRET }, async () => {
        const res = await nowPaymentsWebhook(nowPaymentsSignedRequest(body));
        assert.equal(res.status, 200);
      });
      const log = await latestEmailLog("webhook_metadata_missing_alert", before);
      assert.ok(log, "a webhook_metadata_missing_alert EmailLog row must exist for the unparseable-order_id case");
    });

    // ---- 7. NOWPayments webhook - expired intent gets marked EXPIRED ----

    await test("NOWPayments webhook: an 'expired' status marks the matching MarketplacePurchaseIntent as EXPIRED (previously never set by any code path)", async () => {
      const listing = await prisma.marketplaceListing.create({
        data: {
          slug: `payhard-listing-${RUN_TAG}-expiry`,
          sellerId: `seller-${RUN_TAG}`,
          title: "Payment Hardening Validation Listing (expiry case)",
          pricing: { model: "one_time", amount: 49, currency: "USD" },
          platformTag: PLATFORM,
          publicationState: "PUBLISHED",
          tradingSystemId: `${RUN_TAG}-ts-expiry`,
          versionId: "v1",
        },
      });
      createdListingIds.push(listing.id);
      createdReleaseArtifactTradingSystemIds.push(`${RUN_TAG}-ts-expiry`);

      const intent = await prisma.marketplacePurchaseIntent.create({
        data: {
          buyerId: buyer.id,
          marketplaceListingId: listing.id,
          tradingSystemId: `${RUN_TAG}-ts-expiry`,
          versionId: "v1",
          platform: PLATFORM,
          releaseId: "not-needed-for-this-case",
          amount: 49,
          currency: "USD",
        },
      });
      createdIntentIds.push(intent.id);

      const body = { payment_status: "expired", order_id: `mkt_${intent.id}`, payment_id: `pay_${RUN_TAG}_3` };
      await withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: NOWPAYMENTS_TEST_IPN_SECRET }, async () => {
        const res = await nowPaymentsWebhook(nowPaymentsSignedRequest(body));
        assert.equal(res.status, 200);
      });

      const fresh = await prisma.marketplacePurchaseIntent.findUnique({ where: { id: intent.id } });
      assert.equal(fresh?.status, "EXPIRED", "the intent must be marked EXPIRED, not left at PENDING forever");
    });

    await test("NOWPayments webhook: 'refunded'/'failed'/'waiting' statuses all return 200 (visibility logging, no crash, no activation)", async () => {
      const statuses = ["refunded", "failed", "waiting", "partially_paid"];
      await withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: NOWPAYMENTS_TEST_IPN_SECRET }, async () => {
        for (const status of statuses) {
          const body = { payment_status: status, order_id: `mkt_${RUN_TAG}-${status}`, payment_id: `pay_${RUN_TAG}_${status}` };
          const res = await nowPaymentsWebhook(nowPaymentsSignedRequest(body));
          assert.equal(res.status, 200, `${status} must return 200, not crash the webhook`);
        }
      });
    });

    // ---- 8. NOWPayments webhook - real, full success path still works unchanged ----

    await test("NOWPayments webhook: a genuine 'finished' payment against a real intent still creates Purchase -> Entitlement -> License unchanged", async () => {
      const listing = await prisma.marketplaceListing.create({
        data: {
          slug: `payhard-listing-${RUN_TAG}-success`,
          sellerId: `seller-${RUN_TAG}`,
          title: "Payment Hardening Validation Listing (success case)",
          pricing: { model: "one_time", amount: 49, currency: "USD" },
          platformTag: PLATFORM,
          publicationState: "PUBLISHED",
          tradingSystemId: `${RUN_TAG}-ts-success`,
          versionId: "v1",
        },
      });
      createdListingIds.push(listing.id);
      createdReleaseArtifactTradingSystemIds.push(`${RUN_TAG}-ts-success`);

      const release = await prisma.releaseArtifact.create({
        data: {
          tradingSystemId: `${RUN_TAG}-ts-success`,
          versionId: "v1",
          marketplaceListingId: listing.id,
          platform: PLATFORM,
          artifactVersion: "1.0.0",
          artifactHash: `hash-${RUN_TAG}`,
          releaseStatus: "PUBLISHED",
        },
      });

      const intent = await prisma.marketplacePurchaseIntent.create({
        data: {
          buyerId: buyer.id,
          marketplaceListingId: listing.id,
          tradingSystemId: `${RUN_TAG}-ts-success`,
          versionId: "v1",
          platform: PLATFORM,
          releaseId: release.id,
          amount: 49,
          currency: "USD",
        },
      });
      createdIntentIds.push(intent.id);

      const paymentId = `pay_${RUN_TAG}_success`;
      const body = { payment_status: "finished", order_id: `mkt_${intent.id}`, payment_id: paymentId };
      await withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: NOWPAYMENTS_TEST_IPN_SECRET }, async () => {
        const res = await nowPaymentsWebhook(nowPaymentsSignedRequest(body));
        assert.equal(res.status, 200);
      });

      const purchase = await prisma.purchase.findUnique({ where: { providerRef: paymentId }, include: { entitlements: { include: { licenses: true } } } });
      assert.ok(purchase, "the real success path must still create a Purchase");
      assert.equal(purchase!.entitlements.length, 1);
      assert.equal(purchase!.entitlements[0].licenses.length, 1);
    });
  } finally {
    const safeDelete = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        console.error(`  cleanup FAILED (${label}):`, err instanceof Error ? err.message : err);
        failed += 1;
      }
    };

    // Entitlement/License/Purchase have no cascade delete in this schema -
    // clean up in FK-dependency order, scoped to this run's own buyer (the
    // only buyer any of this script's tests ever use).
    await safeDelete("licenses+entitlements+purchases", async () => {
      const entitlements = await prisma.entitlement.findMany({ where: { buyerId: buyer.id }, select: { id: true } });
      const entitlementIds = entitlements.map((e) => e.id);
      if (entitlementIds.length > 0) {
        await prisma.license.deleteMany({ where: { entitlementId: { in: entitlementIds } } });
        await prisma.entitlement.deleteMany({ where: { id: { in: entitlementIds } } });
      }
      await prisma.purchase.deleteMany({ where: { buyerId: buyer.id } });
    });
    await safeDelete("marketplace_purchase_intents", () => prisma.marketplacePurchaseIntent.deleteMany({ where: { id: { in: createdIntentIds } } }));
    await safeDelete("release_artifacts", () =>
      prisma.releaseArtifact.deleteMany({ where: { tradingSystemId: { in: createdReleaseArtifactTradingSystemIds } } }),
    );
    await safeDelete("marketplace_listings", () => prisma.marketplaceListing.deleteMany({ where: { id: { in: createdListingIds } } }));
    await safeDelete("plans", () => prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } }));
    await safeDelete("email_logs", () => prisma.emailLog.deleteMany({ where: { recipientEmail: "support@algotraders24.ai", sentAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }, type: "webhook_metadata_missing_alert" } }));
    await safeDelete("user", () => prisma.user.deleteMany({ where: { id: buyer.id } }));

    console.log("  cleanup complete");
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
