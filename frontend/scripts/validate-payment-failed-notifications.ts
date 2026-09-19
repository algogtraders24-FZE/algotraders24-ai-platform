// scripts/validate-payment-failed-notifications.ts
// AT24 Email Communication Sprint 2 (P01) - Standalone validation against
// the REAL database (no test framework in this project - see package.json),
// matching the existing scripts/validate-marketplace-purchase-idempotency.ts
// convention: exercises the REAL app/api/webhooks/stripe/route.ts POST
// handler directly (constructed Request objects, real Stripe test-mode
// signature verification via testClient.webhooks.generateTestHeaderString -
// pure local crypto, no network call to Stripe), against a real, throwaway
// User + Subscription fixture, then asserts the real Subscription row's
// state transitions.
//
// Run via `npm run validate:payment-failed`. Must run with
// `--conditions=react-server` (wired into the npm script, same technique as
// validate-marketplace-purchase-idempotency.ts) so `import "server-only"` in
// services/notifications/EmailService.ts resolves to its empty stub instead
// of throwing outside an RSC context - this script imports the real webhook
// route directly, not a reimplementation.
//
// Email dispatch is verified WITHOUT ever contacting Resend's real API: the
// Resend SDK calls the global `fetch`, so this script temporarily replaces
// `globalThis.fetch` with a spy for the duration of each webhook call that
// might attempt to send an email, then restores the original. No real email
// is ever sent (Section 19 of the sprint brief: no real customer emails from
// a test). One finding worth recording here: Resend's own SDK
// (node_modules/resend/dist/index.mjs, `fetchRequest`) already wraps every
// `fetch` call in its own try/catch and NEVER throws - a failed send (bad
// key, network error, 4xx/5xx) resolves to `{ data: null, error }`, which
// EmailService.ts's callers don't even inspect. This means "email failure
// must not corrupt payment state" is already structurally guaranteed one
// layer below the webhook's own try/catch for every email in this file, not
// something this sprint had to newly add - the "email failure" test below
// proves the real state transition survives a genuine simulated Resend
// failure end-to-end, rather than asserting an exception is caught (there
// isn't one to catch).
//
// Safety: every fixture is tagged with one run-unique string and
// hard-deleted in a `finally` block regardless of pass/fail, mirroring
// validate-payment-infrastructure.ts's own safety convention. Temporarily
// -set env vars (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/RESEND_API_KEY) are
// always restored.
import "dotenv/config";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { prisma } from "../lib/prisma";
import { subscriptionActionService } from "../services/billing/SubscriptionActionService";
import { POST as stripeWebhook } from "../app/api/webhooks/stripe/route";

const RUN_TAG = `email2-${Date.now()}`;
const STRIPE_TEST_SECRET = "sk_test_fake";
const STRIPE_TEST_WEBHOOK_SECRET = "whsec_test_fake";

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

// ---- Real Stripe test-mode signature verification (pure local crypto) ----

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

function invoicePaymentFailedEvent(evtId: string, invoiceId: string, subscriptionId: string | null, amountDue: number) {
  return {
    id: evtId,
    object: "event",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        amount_due: amountDue,
        currency: "usd",
        parent: subscriptionId
          ? { type: "subscription_details", subscription_details: { subscription: subscriptionId } }
          : null,
      },
    },
  };
}

function subscriptionUpdatedEvent(
  evtId: string,
  subscriptionId: string,
  status: string,
  userId: string,
  planId: string,
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: evtId,
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        status,
        metadata: { userId, planId },
        items: {
          object: "list",
          data: [{ current_period_start: now, current_period_end: now + 30 * 24 * 60 * 60 }],
        },
      },
    },
  };
}

// ---- fetch spy: intercepts the Resend SDK's own `fetch` call, no real
// network call to Resend is ever made ----

interface FetchCall {
  url: string;
  body: unknown;
}

let fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function installFetchSpy(mode: "success" | "authFailure" | "networkError"): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    fetchCalls.push({ url, body });
    if (mode === "networkError") {
      throw new Error("simulated network failure - no real request was made");
    }
    if (mode === "authFailure") {
      return new Response(
        JSON.stringify({ name: "restricted_api_key", statusCode: 401, message: "simulated invalid API key" }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ id: `email_test_${RUN_TAG}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `${RUN_TAG}@internal.test`, name: "Email Sprint 2 Validation User", planId: "pro" },
  });
  const plan = await prisma.plan.findUnique({ where: { id: "pro" } });
  assert.ok(plan, "the 'pro' plan must exist - same fixture assumption as validate-payment-infrastructure.ts");

  const stripeSubscriptionId = `sub_test_${RUN_TAG}`;
  await subscriptionActionService.activateFromPayment({
    userId: user.id,
    planId: "pro",
    provider: "stripe",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    stripeSubscriptionId,
  });

  try {
    await withEnv(
      { STRIPE_SECRET_KEY: STRIPE_TEST_SECRET, STRIPE_WEBHOOK_SECRET: STRIPE_TEST_WEBHOOK_SECRET, RESEND_API_KEY: "re_test_fake" },
      async () => {
        // ---- Case 1: eligible payment failure -> real state transition + real (spied) email dispatch ----
        await test("Case 1 - invoice.payment_failed for a known subscription: Subscription -> past_due, exactly one email dispatch attempt with the right recipient/plan", async () => {
          installFetchSpy("success");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_1`, `in_${RUN_TAG}_1`, stripeSubscriptionId, 2900);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);

            const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
            assert.equal(sub.status, "past_due", "Subscription must transition to the existing past_due status");

            assert.equal(fetchCalls.length, 1, "exactly one outbound email dispatch attempt");
            const sentBody = fetchCalls[0].body as { to: string | string[]; subject: string; html: string };
            const to = Array.isArray(sentBody.to) ? sentBody.to[0] : sentBody.to;
            assert.equal(to, user.email, "email must go to the affected account's real address");
            assert.ok(sentBody.subject.includes(plan!.name), "subject must reference the real affected plan");
            assert.ok(!sentBody.html.includes("Error"), "must never leak an internal error string into the email body");
          } finally {
            restoreFetch();
          }
        });

        // ---- Case 2: webhook retry of the identical event must not re-send ----
        await test("Case 2a - retried delivery of the SAME invoice.payment_failed event: no second email, status unchanged", async () => {
          installFetchSpy("success");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_1`, `in_${RUN_TAG}_1`, stripeSubscriptionId, 2900);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            assert.equal(fetchCalls.length, 0, "a retried delivery must not attempt a second email");

            const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
            assert.equal(sub.status, "past_due");
          } finally {
            restoreFetch();
          }
        });

        // ---- Case 2b: a further dunning-retry attempt on the SAME still-unpaid invoice (different event/invoice id, same subscription) must also not re-send ----
        await test("Case 2b - a further failed-retry attempt on the same subscription while already past_due: no second email", async () => {
          installFetchSpy("success");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_2`, `in_${RUN_TAG}_2`, stripeSubscriptionId, 2900);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            assert.equal(fetchCalls.length, 0, "a repeated dunning attempt on an already-past_due subscription must not re-notify");
          } finally {
            restoreFetch();
          }
        });

        // ---- Case 3: non-eligible events never send a user email ----
        await test("Case 3a - invoice.payment_failed with no subscription (one-off invoice): no email, no Subscription touched", async () => {
          installFetchSpy("success");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_3a`, `in_${RUN_TAG}_3a`, null, 500);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            assert.equal(fetchCalls.length, 0, "a non-subscription invoice must never trigger this notification");
          } finally {
            restoreFetch();
          }
        });

        await test("Case 3b - invoice.payment_failed for an unknown subscription id: no email, no crash", async () => {
          installFetchSpy("success");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_3b`, `in_${RUN_TAG}_3b`, `sub_does_not_exist_${RUN_TAG}`, 500);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            assert.equal(fetchCalls.length, 0, "an invoice for a subscription this app has no record of must never trigger this notification");
          } finally {
            restoreFetch();
          }
        });

        // ---- Regression guard: customer.subscription.updated must not clobber the past_due state Stripe itself is reporting ----
        await test("Guard - customer.subscription.updated reporting status=past_due does NOT reactivate the subscription", async () => {
          const evt = subscriptionUpdatedEvent(`evt_${RUN_TAG}_upd_pd`, stripeSubscriptionId, "past_due", user.id, "pro");
          const res = await stripeWebhook(signedRequest(evt));
          assert.equal(res.status, 200);
          const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
          assert.equal(sub.status, "past_due", "a subscription.updated event that itself reports past_due must not silently reactivate the subscription");
        });

        // ---- Recovery: a genuine successful-status subscription.updated DOES reactivate ----
        // (this path also fires the existing sendSubscriptionActiveEmail via
        // notifySubscriptionActive - spy fetch so this never makes a real
        // call to Resend's API, same as every other case here)
        await test("Recovery - customer.subscription.updated reporting status=active reactivates the subscription", async () => {
          installFetchSpy("success");
          try {
            const evt = subscriptionUpdatedEvent(`evt_${RUN_TAG}_upd_active`, stripeSubscriptionId, "active", user.id, "pro");
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
            assert.equal(sub.status, "active", "a real status=active update must still reactivate exactly as it did before this sprint");
          } finally {
            restoreFetch();
          }
        });

        // ---- Case 4: a genuinely NEW failure after recovery can notify again, and a failing email dispatch never corrupts the already-persisted state ----
        await test("Case 4 - after recovery, a new payment failure transitions again even when the email dispatch itself fails (401 from Resend)", async () => {
          installFetchSpy("authFailure");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_4`, `in_${RUN_TAG}_4`, stripeSubscriptionId, 2900);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200, "the webhook must still report success even when the email dispatch itself fails");
            assert.equal(fetchCalls.length, 1, "the email dispatch must still be attempted");

            const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
            assert.equal(sub.status, "past_due", "the real payment-failed state transition must persist regardless of the email outcome");
          } finally {
            restoreFetch();
          }
        });

        await test("Case 4b - a full network-level failure (fetch itself throws) during email dispatch also never corrupts state or crashes the webhook", async () => {
          // Reset back to active so this is a fresh, real transition, not a
          // no-op against an already-past_due row.
          await subscriptionActionService.activateFromPayment({
            userId: user.id,
            planId: "pro",
            provider: "stripe",
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            stripeSubscriptionId,
          });
          installFetchSpy("networkError");
          try {
            const evt = invoicePaymentFailedEvent(`evt_${RUN_TAG}_4b`, `in_${RUN_TAG}_4b`, stripeSubscriptionId, 2900);
            const res = await stripeWebhook(signedRequest(evt));
            assert.equal(res.status, 200);
            const sub = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId } });
            assert.equal(sub.status, "past_due");
          } finally {
            restoreFetch();
          }
        });
      },
    );
  } finally {
    restoreFetch();
    await prisma.subscription.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });

    const leftoverSub = await prisma.subscription.count({ where: { userId: user.id } });
    const leftoverUser = await prisma.user.count({ where: { id: user.id } });
    if (leftoverSub > 0 || leftoverUser > 0) {
      console.error("  WARNING: some validation rows were not cleaned up");
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (user, subscription)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  restoreFetch();
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
