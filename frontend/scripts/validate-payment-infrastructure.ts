// scripts/validate-payment-infrastructure.ts
// Sprint L2.7 - Standalone validation for the payment infrastructure
// against the REAL database (no test framework exists in this project -
// see package.json). Run via `npm run validate:payments`.
//
// Covers: honest "unconfigured" behavior for both providers in an
// environment with no real keys (this one), real HMAC-SHA512 IPN signature
// verification (NOWPayments) and real Stripe webhook signature
// verification using temporarily-set test credentials (both are pure local
// cryptography - no network call to either provider is made anywhere in
// this script), the real SubscriptionActionService.activateFromPayment/
// markCanceledByProvider mutations, real RequestLogService counters, and
// the real 6-subsystem HealthService report.
//
// Safety: creates exactly one throwaway User (+ synthetic Subscription,
// RequestLog rows) under a clearly-marked synthetic email, exercises every
// case, then hard-deletes everything it created in a `finally` block
// regardless of pass/fail. Temporarily-set env vars (STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET, NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET) are
// always restored to their original value, even on failure.
import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { stripeProvider } from "../services/billing/providers/StripeProvider";
import { nowPaymentsProvider } from "../services/billing/providers/NowPaymentsProvider";
import { PaymentProviderError } from "../lib/payments/errors";
import { subscriptionActionService } from "../services/billing/SubscriptionActionService";
import { requestLogService } from "../services/tracking/RequestLogService";
import { healthService } from "../services/backend/HealthService";

const RUN_TAG = `l2-7-${Date.now()}`;

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

function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `${RUN_TAG}@internal.test`, name: "L2.7 Validation User", planId: "free" },
  });

  try {
    // ---- Honest "unconfigured" behavior (this environment has no real keys) ----

    await test("StripeProvider: isConfigured() is false with no keys set", async () => {
      assert.equal(stripeProvider.isConfigured(), false);
    });

    await test("NowPaymentsProvider: isConfigured() is false with no keys set", async () => {
      assert.equal(nowPaymentsProvider.isConfigured(), false);
    });

    await test("StripeProvider.createCheckoutSession: throws unconfigured, never a fake checkout URL", async () => {
      await assert.rejects(
        () => stripeProvider.createCheckoutSession({ userId: user.id, planId: "pro", cycle: "monthly" }),
        (err: unknown) => err instanceof PaymentProviderError && err.kind === "unconfigured",
      );
    });

    await test("NowPaymentsProvider.createInvoice: throws unconfigured, never a fake invoice", async () => {
      await assert.rejects(
        () => nowPaymentsProvider.createInvoice({ userId: user.id, planId: "pro", priceUsd: 29, orderId: "test" }),
        (err: unknown) => err instanceof PaymentProviderError && err.kind === "unconfigured",
      );
    });

    // ---- Real cryptographic verification (pure local crypto, no network) ----

    await test("NowPaymentsProvider.verifyIpnSignature: real HMAC-SHA512, matches a correctly-signed payload", async () => {
      withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: "test-ipn-secret" }, () => {
        const payload = { payment_id: "123", payment_status: "finished", order_id: `${user.id}:pro:monthly:1` };
        const sortedSerialized = JSON.stringify(
          Object.keys(payload)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = (payload as Record<string, unknown>)[k];
              return acc;
            }, {}),
        );
        const validSig = crypto.createHmac("sha512", "test-ipn-secret").update(sortedSerialized).digest("hex");
        assert.equal(nowPaymentsProvider.verifyIpnSignature(payload, validSig), true);
      });
    });

    await test("NowPaymentsProvider.verifyIpnSignature: rejects a tampered payload", async () => {
      withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: "test-ipn-secret" }, () => {
        const original = { payment_id: "123", payment_status: "finished", order_id: `${user.id}:pro:monthly:1` };
        const sortedSerialized = JSON.stringify(Object.keys(original).sort().reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (original as Record<string, unknown>)[k];
          return acc;
        }, {}));
        const validSig = crypto.createHmac("sha512", "test-ipn-secret").update(sortedSerialized).digest("hex");
        const tampered = { ...original, payment_status: "failed" };
        assert.equal(nowPaymentsProvider.verifyIpnSignature(tampered, validSig), false);
      });
    });

    await test("NowPaymentsProvider.verifyIpnSignature: rejects a missing signature header", async () => {
      withEnv({ NOWPAYMENTS_API_KEY: "test-key", NOWPAYMENTS_IPN_SECRET: "test-ipn-secret" }, () => {
        assert.equal(nowPaymentsProvider.verifyIpnSignature({ a: 1 }, null), false);
      });
    });

    await test("StripeProvider.constructWebhookEvent: real signature verification accepts a correctly-signed event", async () => {
      withEnv({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_test_fake" }, () => {
        const testClient = new Stripe("sk_test_fake");
        const payload = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed", data: { object: {} } });
        const header = testClient.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_fake" });
        const event = stripeProvider.constructWebhookEvent(payload, header);
        assert.equal(event.type, "checkout.session.completed");
      });
    });

    await test("StripeProvider.constructWebhookEvent: rejects a signature signed with the wrong secret", async () => {
      withEnv({ STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_test_fake" }, () => {
        const testClient = new Stripe("sk_test_fake");
        const payload = JSON.stringify({ id: "evt_test", object: "event", type: "checkout.session.completed", data: { object: {} } });
        const header = testClient.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong_secret" });
        assert.throws(
          () => stripeProvider.constructWebhookEvent(payload, header),
          (err: unknown) => err instanceof PaymentProviderError && err.kind === "invalid_signature",
        );
      });
    });

    // ---- Real subscription synchronization (Phase 4) ----

    await test("SubscriptionActionService.activateFromPayment: real DB write, records the real provider reference", async () => {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const sub = await subscriptionActionService.activateFromPayment({
        userId: user.id,
        planId: "pro",
        provider: "stripe",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        stripeSubscriptionId: `sub_test_${RUN_TAG}`,
      });
      assert.equal(sub.planId, "pro");
      assert.equal(sub.provider, "stripe");
      assert.equal(sub.stripeSubscriptionId, `sub_test_${RUN_TAG}`);
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      assert.equal(freshUser?.planId, "pro", "User.planId must be kept in sync");
    });

    await test("SubscriptionActionService.activateFromPayment: unknown plan throws InvalidPlanError, no DB write", async () => {
      const before = await prisma.subscription.findFirst({ where: { userId: user.id } });
      await assert.rejects(() =>
        subscriptionActionService.activateFromPayment({
          userId: user.id,
          planId: "not-a-real-plan",
          provider: "stripe",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        }),
      );
      const after = await prisma.subscription.findFirst({ where: { userId: user.id } });
      assert.equal(after?.planId, before?.planId);
    });

    await test("SubscriptionActionService.markCanceledByProvider: real DB write, found by stripeSubscriptionId", async () => {
      const canceled = await subscriptionActionService.markCanceledByProvider(`sub_test_${RUN_TAG}`);
      assert.equal(canceled?.status, "canceled");
    });

    await test("SubscriptionActionService.findByStripeSubscriptionId: real lookup by the provider reference", async () => {
      const found = await subscriptionActionService.findByStripeSubscriptionId(`sub_test_${RUN_TAG}`);
      assert.ok(found);
      assert.equal(found!.userId, user.id);
    });

    // ---- Real request tracking (Phase 6) ----

    await test("RequestLogService: record + countForUser are real and period-scoped", async () => {
      const now = new Date();
      const periodStart = new Date(now.getTime() - 1000);
      const periodEnd = new Date(now.getTime() + 1000);
      const outsidePeriod = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2);

      await requestLogService.record(user.id, "market_analysis");
      await requestLogService.record(user.id, "market_analysis");
      await prisma.requestLog.create({ data: { userId: user.id, type: "market_analysis", createdAt: outsidePeriod } });

      const count = await requestLogService.countForUser(user.id, "market_analysis", periodStart, periodEnd);
      assert.equal(count, 2);
    });

    await test("RequestLogService: countAll is a real platform-wide total", async () => {
      const total = await requestLogService.countAll("market_analysis");
      assert.ok(total >= 2);
    });

    // ---- Real system health (Phase 5) ----

    await test("HealthService.getSystemStatusAsync: reports all 6 real subsystems, database is operational", async () => {
      const status = await healthService.getSystemStatusAsync();
      assert.equal(status.database.health, "operational");
      assert.ok(status.vectorStore);
      assert.ok(status.aiProvider);
      assert.ok(status.paymentProvider);
      assert.ok(status.storage);
      assert.ok(status.backgroundJobs);
      assert.ok(["operational", "degraded", "down"].includes(status.overallHealth));
    });

    await test("HealthService: backgroundJobs is honestly 'unknown', never fabricated as operational", async () => {
      const status = await healthService.getSystemStatusAsync();
      assert.equal(status.backgroundJobs.health, "unknown");
    });

    await test("HealthService: paymentProvider reflects real config presence (unknown when neither provider is configured)", async () => {
      const status = await healthService.getSystemStatusAsync();
      assert.equal(status.paymentProvider.health, "unknown");
    });
  } finally {
    await prisma.requestLog.deleteMany({ where: { userId: user.id } });
    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });

    const leftoverSub = await prisma.subscription.count({ where: { userId: user.id } });
    const leftoverLogs = await prisma.requestLog.count({ where: { userId: user.id } });
    if (leftoverSub > 0 || leftoverLogs > 0) {
      console.error("  WARNING: some validation rows were not cleaned up");
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, subscription, request logs)");
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
