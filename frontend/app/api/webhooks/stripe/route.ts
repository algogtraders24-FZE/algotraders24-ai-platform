// app/api/webhooks/stripe/route.ts
// Sprint L2.7 - Phase 2/4: real Stripe webhook handler. No user auth check
// here (Stripe calls this directly, not a logged-in user) - the real
// authorization is the signature verification itself
// (stripeProvider.constructWebhookEvent), which rejects any payload that
// isn't genuinely signed by Stripe with this deployment's webhook secret.
// Reads the RAW request body via req.text() - this must happen before any
// JSON parsing, since Stripe's signature covers the exact raw bytes sent.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { stripeProvider } from "@/services/billing/providers/StripeProvider";
import { PaymentProviderError } from "@/lib/payments/errors";
import { subscriptionActionService } from "@/services/billing/SubscriptionActionService";
import { issueLicenseForPurchase } from "@/services/licensing/licenseService";
import {
  sendPurchaseConfirmationEmail,
  sendLicenseIssuanceFailureAlert,
  sendSubscriptionActiveEmail,
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail,
} from "@/services/notifications/EmailService";
import { prisma } from "@/lib/prisma";
import type { PlatformName } from "@/types/marketplace-factory";
import type Stripe from "stripe";

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

// Shared by both the first-subscribe (checkout.session.completed) and
// every renewal (customer.subscription.updated) path, since both call
// subscriptionActionService.activateFromPayment() and both genuinely mean
// "tell the buyer their plan is active through this date." Best-effort -
// never allowed to fail the webhook.
async function notifySubscriptionActive(userId: string, planId: string, periodEnd: Date): Promise<void> {
  try {
    const [buyer, plan] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      prisma.plan.findUnique({ where: { id: planId }, select: { name: true, price: true } }),
    ]);
    if (!buyer || !plan) return;
    await sendSubscriptionActiveEmail({
      to: buyer.email,
      buyerName: buyer.name || "there",
      planName: plan.name,
      amount: plan.price,
      currency: "USD",
      periodEnd,
    });
  } catch (error) {
    console.error("[webhook:stripe] subscription active email failed:", error);
  }
}

export const POST = withContext(async (req, ctx) => {
  if (!stripeProvider.isConfigured()) {
    return ApiResponse.error({ code: "PROVIDER_UNCONFIGURED", message: "Stripe is not configured" }, ctx.requestId, 503, ctx.startedAt);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return ApiResponse.error({ code: "VALIDATION", message: "Missing stripe-signature header" }, ctx.requestId, 400, ctx.startedAt);
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripeProvider.constructWebhookEvent(rawBody, signature);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return ApiResponse.error({ code: "INVALID_SIGNATURE", message: error.message }, ctx.requestId, 400, ctx.startedAt);
    }
    return ApiResponse.error({ code: "WEBHOOK_ERROR", message: "Could not process webhook" }, ctx.requestId, 400, ctx.startedAt);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Marketplace product purchase (mode: "payment") - distinct flow
        // from the platform-subscription case below, branched on
        // metadata.type so the two never cross. Issues a real, signed
        // License via issueLicenseForPurchase. REQUIRES
        // LICENSE_SIGNING_PRIVATE_KEY/PUBLIC_KEY to be set (see
        // services/licensing/crypto.ts) - without them this throws, the
        // catch below returns 500, and Stripe retries; a buyer could be
        // charged with license issuance stuck retrying until the keys are
        // set. Verify these are set in this deployment's real env before
        // any real purchase can be expected to complete end-to-end.
        //
        // session.id (the Checkout Session id) is passed as providerRef -
        // stable across every retried delivery of this same event, and the
        // one thing issueLicenseForPurchase uses to guarantee a retry never
        // creates a second Purchase/Entitlement/License (see that
        // function's own header comment).
        if (session.metadata?.type === "marketplace_purchase") {
          const m = session.metadata;
          if (m.buyerId && m.listingId && m.tradingSystemId && m.versionId && m.platform && m.releaseId) {
            const amount = (session.amount_total ?? 0) / 100;
            const currency = (session.currency ?? "usd").toUpperCase();
            let result: Awaited<ReturnType<typeof issueLicenseForPurchase>>;
            try {
              result = await issueLicenseForPurchase({
                buyerId: m.buyerId,
                marketplaceListingId: m.listingId,
                tradingSystemId: m.tradingSystemId,
                versionId: m.versionId,
                releaseId: m.releaseId,
                platform: m.platform as PlatformName,
                amount,
                currency,
                expiresAt: null,
                provider: "stripe",
                providerRef: session.id,
              });
            } catch (issueError) {
              // The buyer was already charged by Stripe at this point - see
              // AT24_EMAIL_COMMUNICATION_RECONCILIATION.md's top finding.
              // Alert the team so this gets resolved by hand rather than
              // silently sitting as a charge with no license, and still
              // rethrow so Stripe retries and the outer catch's 500/log
              // behavior is unchanged.
              try {
                const buyer = await prisma.user.findUnique({ where: { id: m.buyerId }, select: { email: true } });
                await sendLicenseIssuanceFailureAlert({
                  buyerEmail: buyer?.email ?? m.buyerId,
                  tradingSystemId: m.tradingSystemId,
                  amount,
                  currency,
                  providerRef: session.id,
                  errorMessage: issueError instanceof Error ? issueError.message : String(issueError),
                });
              } catch (alertError) {
                console.error("[webhook:stripe] license issuance failure alert also failed:", alertError);
              }
              throw issueError;
            }

            // Never let an email failure affect the webhook's success
            // response - Stripe would retry an already-completed purchase.
            if (!result.duplicate) {
              try {
                const [buyer, listing] = await Promise.all([
                  prisma.user.findUnique({ where: { id: m.buyerId }, select: { email: true, name: true } }),
                  prisma.marketplaceListing.findUnique({ where: { id: m.listingId }, select: { title: true } }),
                ]);
                if (buyer) {
                  await sendPurchaseConfirmationEmail({
                    to: buyer.email,
                    buyerName: buyer.name || "there",
                    productName: listing?.title ?? m.tradingSystemId,
                    amount,
                    currency,
                    licenseId: result.license.id,
                  });
                }
              } catch (emailError) {
                console.error("[webhook:stripe] purchase confirmation email failed:", emailError);
              }
            }
          }
          break;
        }

        const userId = session.metadata?.userId;
        const planId = session.metadata?.planId;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (userId && planId) {
          const now = new Date();
          const currentPeriodEnd = addMonths(now, session.metadata?.cycle === "yearly" ? 12 : 1);
          await subscriptionActionService.activateFromPayment({
            userId,
            planId,
            provider: "stripe",
            currentPeriodStart: now,
            currentPeriodEnd,
            stripeSubscriptionId: subscriptionId,
          });
          await notifySubscriptionActive(userId, planId, currentPeriodEnd);
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const planId = sub.metadata?.planId;
        const item = sub.items.data[0];
        // AT24 Email Communication Sprint 2 (P01) - Stripe fires this same
        // event type when a subscription's payment fails and its status
        // moves to "past_due"/"unpaid", not only on a genuine renewal.
        // Before this guard, activateFromPayment() ran unconditionally here
        // and would have immediately overwritten the "past_due" state the
        // invoice.payment_failed case below just wrote (re-activating a
        // subscription Stripe itself still considers unpaid, and silently
        // discarding the payment-failed transition/email decision). Only
        // treat this as "payment succeeded, keep/renew access" when
        // Stripe's own status says so - this does not change behavior for
        // the existing successful-renewal case, which always reports
        // "active" or "trialing" here.
        if (userId && planId && item && (sub.status === "active" || sub.status === "trialing")) {
          const currentPeriodEnd = new Date(item.current_period_end * 1000);
          await subscriptionActionService.activateFromPayment({
            userId,
            planId,
            provider: "stripe",
            currentPeriodStart: new Date(item.current_period_start * 1000),
            currentPeriodEnd,
            stripeSubscriptionId: sub.id,
          });
          await notifySubscriptionActive(userId, planId, currentPeriodEnd);
        }
        break;
      }
      // AT24 Email Communication Sprint 2 (P01) - the canonical Stripe event
      // for a failed subscription-invoice charge (transient/retryable -
      // Stripe keeps retrying per its dunning schedule; the terminal case is
      // the existing customer.subscription.deleted handler above/below).
      // markPastDueByProvider() is the single idempotency gate: it returns
      // null (no email) for a webhook retry of this same event, for a
      // repeated dunning attempt on the same still-unpaid invoice, and for
      // any invoice we have no matching Subscription for (e.g. a one-off,
      // non-subscription invoice, or an id from another environment) - see
      // that method's own header comment.
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        // This Stripe API version nests the generating subscription under
        // parent.subscription_details (the older top-level
        // Invoice.subscription field this app's other code was written
        // against no longer exists on this SDK's types) - a one-off,
        // non-subscription invoice has no parent.subscription_details at
        // all, which is exactly the "not eligible for this notification"
        // case.
        const subscriptionRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
        if (!subscriptionId) break;

        const marked = await subscriptionActionService.markPastDueByProvider(subscriptionId);
        if (marked) {
          try {
            const [buyer, plan] = await Promise.all([
              prisma.user.findUnique({ where: { id: marked.userId }, select: { email: true, name: true } }),
              prisma.plan.findUnique({ where: { id: marked.planId }, select: { name: true } }),
            ]);
            if (buyer && plan) {
              await sendPaymentFailedEmail({
                to: buyer.email,
                buyerName: buyer.name || "there",
                planName: plan.name,
                amount: (invoice.amount_due ?? 0) / 100,
                currency: (invoice.currency ?? "usd").toUpperCase(),
                failedAt: new Date(),
              });
            }
          } catch (error) {
            console.error("[webhook:stripe] payment failed email failed:", error);
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const canceled = await subscriptionActionService.markCanceledByProvider(sub.id);
        if (canceled) {
          try {
            const [buyer, plan] = await Promise.all([
              prisma.user.findUnique({ where: { id: canceled.userId }, select: { email: true, name: true } }),
              prisma.plan.findUnique({ where: { id: canceled.planId }, select: { name: true } }),
            ]);
            if (buyer && plan) {
              await sendSubscriptionCancelledEmail({ to: buyer.email, buyerName: buyer.name || "there", planName: plan.name });
            }
          } catch (error) {
            console.error("[webhook:stripe] subscription cancelled email failed:", error);
          }
        }
        break;
      }
      default:
        // Real, deliberate no-op for event types this app doesn't act on -
        // never silently "handled", just not relevant yet.
        break;
    }
  } catch (error) {
    // Stripe retries on non-2xx; a transient DB error here should not be
    // swallowed as success, but should also not leak internals.
    console.error("[webhook:stripe] processing failed:", error);
    return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply webhook event" }, ctx.requestId, 500, ctx.startedAt);
  }

  return ApiResponse.success({ received: true }, ctx.requestId, 200, ctx.startedAt);
});
