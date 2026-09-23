// services/billing/providers/StripeProvider.ts
// Sprint L2.7 - Phase 2: real Stripe Checkout integration. Mirrors the
// AlphaVantageProvider pattern (Sprint 15D.3A): isConfigured() gates every
// method, and every failure mode is a typed PaymentProviderError - never a
// fabricated success. Checkout uses inline `price_data` rather than
// pre-created Stripe Price objects, so the real price shown always matches
// this app's own Plan table (single source of truth, no drift between two
// places a price could live).
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { loadStripeEnv, getSiteUrl, MAX_REASONABLE_PAYMENT_AMOUNT_USD } from "@/lib/payments/env";
import { PaymentProviderError } from "@/lib/payments/errors";
import { getPlanCyclePrice } from "@/services/billing/planPricing";

let client: Stripe | null = null;

function getClient(): Stripe {
  const env = loadStripeEnv();
  if (!env) {
    throw new PaymentProviderError("unconfigured", "Stripe is not configured (missing STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET)", "stripe");
  }
  if (!client) {
    client = new Stripe(env.secretKey);
  }
  return client;
}

export class StripeProvider {
  isConfigured(): boolean {
    return loadStripeEnv() !== null;
  }

  // Real Stripe Customer, reused across checkouts - created once per user
  // and persisted to User.stripeCustomerId, never re-created.
  //
  // A stored customerId is only valid within the Stripe key context (test
  // vs live) it was created under - switching STRIPE_SECRET_KEY from test
  // to live (or vice versa) leaves a stale id on the user record that the
  // *other* mode's API genuinely does not recognize. Blindly trusting it
  // (as this used to) surfaced as a real, confusing "Failed to create
  // Stripe checkout session" once live-mode payments actually went live.
  // Retrieving it first and falling through to a fresh create on any
  // failure makes this resilient to that switch without needing a manual
  // DB fix per affected user.
  async getOrCreateCustomer(userId: string): Promise<string> {
    const stripe = getClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new PaymentProviderError("invalid_response", `User not found: ${userId}`, "stripe");
    }
    if (user.stripeCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(user.stripeCustomerId);
        if (!existing.deleted) return existing.id;
      } catch {
        // Not retrievable in the current key context (e.g. a test-mode id
        // under a live key) - fall through and create a fresh one below.
      }
    }

    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId },
      });
      await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
      return customer.id;
    } catch (error) {
      throw new PaymentProviderError("http_error", "Failed to create Stripe customer", "stripe", error);
    }
  }

  async createCheckoutSession(params: {
    userId: string;
    planId: string;
    cycle: "monthly" | "yearly";
  }): Promise<{ url: string }> {
    const stripe = getClient();
    const plan = await prisma.plan.findUnique({ where: { id: params.planId } });
    const cyclePrice = plan ? getPlanCyclePrice(plan, params.cycle) : 0;
    if (!plan || !cyclePrice || cyclePrice <= 0) {
      throw new PaymentProviderError("invalid_response", `Plan is not a valid paid plan: ${params.planId}`, "stripe");
    }
    if (cyclePrice > MAX_REASONABLE_PAYMENT_AMOUNT_USD) {
      throw new PaymentProviderError("invalid_response", `Plan price exceeds the platform's sanity limit: ${params.planId}`, "stripe");
    }

    const customerId = await this.getOrCreateCustomer(params.userId);
    const siteUrl = getSiteUrl();
    const unitAmount = Math.round(cyclePrice * 100);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: unitAmount,
              recurring: { interval: params.cycle === "yearly" ? "year" : "month" },
              product_data: { name: plan.name },
            },
            quantity: 1,
          },
        ],
        success_url: `${siteUrl}/dashboard/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/dashboard/billing?checkout=cancel`,
        metadata: { userId: params.userId, planId: params.planId, cycle: params.cycle },
        subscription_data: {
          metadata: { userId: params.userId, planId: params.planId },
        },
      });

      if (!session.url) {
        throw new PaymentProviderError("invalid_response", "Stripe did not return a checkout URL", "stripe");
      }
      return { url: session.url };
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError("http_error", "Failed to create Stripe checkout session", "stripe", error);
    }
  }

  // Sprint M12 branding follow-on - one-time Marketplace product purchase
  // (mode: "payment", not "subscription" - a marketplace license is a
  // single purchase, never a recurring charge). Distinguished from the
  // subscription checkout above by metadata.type="marketplace_purchase",
  // which the webhook handler branches on before touching Subscription
  // state - the two flows never cross.
  async createMarketplaceCheckoutSession(params: {
    buyerId: string;
    listingId: string;
    listingSlug: string;
    listingTitle: string;
    tradingSystemId: string;
    versionId: string;
    platform: string;
    releaseId: string;
    amount: number;
    currency: string;
  }): Promise<{ url: string }> {
    const stripe = getClient();
    if (params.amount <= 0) {
      throw new PaymentProviderError("invalid_response", `Listing has no valid price: ${params.listingId}`, "stripe");
    }

    const customerId = await this.getOrCreateCustomer(params.buyerId);
    const siteUrl = getSiteUrl();
    const unitAmount = Math.round(params.amount * 100);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: params.currency.toLowerCase(),
              unit_amount: unitAmount,
              product_data: { name: params.listingTitle },
            },
            quantity: 1,
          },
        ],
        success_url: `${siteUrl}/marketplace/${params.listingSlug}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/marketplace/${params.listingSlug}?checkout=cancel`,
        metadata: {
          type: "marketplace_purchase",
          buyerId: params.buyerId,
          listingId: params.listingId,
          tradingSystemId: params.tradingSystemId,
          versionId: params.versionId,
          platform: params.platform,
          releaseId: params.releaseId,
        },
      });

      if (!session.url) {
        throw new PaymentProviderError("invalid_response", "Stripe did not return a checkout URL", "stripe");
      }
      return { url: session.url };
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError("http_error", "Failed to create Stripe marketplace checkout session", "stripe", error);
    }
  }

  // Real signature verification (Stripe.webhooks.constructEvent) - throws
  // PaymentProviderError("invalid_signature") on a bad/missing signature,
  // never processes an unverified payload.
  constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
    const env = loadStripeEnv();
    if (!env) {
      throw new PaymentProviderError("unconfigured", "Stripe is not configured", "stripe");
    }
    const stripe = getClient();
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, env.webhookSecret);
    } catch (error) {
      throw new PaymentProviderError("invalid_signature", "Stripe webhook signature verification failed", "stripe", error);
    }
  }
}

export const stripeProvider = new StripeProvider();
