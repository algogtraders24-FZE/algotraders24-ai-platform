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
import type Stripe from "stripe";

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
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
        const userId = session.metadata?.userId;
        const planId = session.metadata?.planId;
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (userId && planId) {
          const now = new Date();
          await subscriptionActionService.activateFromPayment({
            userId,
            planId,
            provider: "stripe",
            currentPeriodStart: now,
            currentPeriodEnd: addMonths(now, session.metadata?.cycle === "yearly" ? 12 : 1),
            stripeSubscriptionId: subscriptionId,
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const planId = sub.metadata?.planId;
        const item = sub.items.data[0];
        if (userId && planId && item) {
          await subscriptionActionService.activateFromPayment({
            userId,
            planId,
            provider: "stripe",
            currentPeriodStart: new Date(item.current_period_start * 1000),
            currentPeriodEnd: new Date(item.current_period_end * 1000),
            stripeSubscriptionId: sub.id,
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await subscriptionActionService.markCanceledByProvider(sub.id);
        break;
      }
      default:
        // Real, deliberate no-op for event types this app doesn't act on -
        // never silently "handled", just not relevant yet.
        break;
    }
  } catch {
    // Stripe retries on non-2xx; a transient DB error here should not be
    // swallowed as success, but should also not leak internals.
    return ApiResponse.error({ code: "WEBHOOK_PROCESSING_FAILED", message: "Could not apply webhook event" }, ctx.requestId, 500, ctx.startedAt);
  }

  return ApiResponse.success({ received: true }, ctx.requestId, 200, ctx.startedAt);
});
