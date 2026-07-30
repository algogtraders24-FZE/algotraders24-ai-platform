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
import { loadStripeEnv, getSiteUrl } from "@/lib/payments/env";
import { PaymentProviderError } from "@/lib/payments/errors";

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
  async getOrCreateCustomer(userId: string): Promise<string> {
    const stripe = getClient();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new PaymentProviderError("invalid_response", `User not found: ${userId}`, "stripe");
    }
    if (user.stripeCustomerId) return user.stripeCustomerId;

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
    if (!plan || plan.price <= 0) {
      throw new PaymentProviderError("invalid_response", `Plan is not a valid paid plan: ${params.planId}`, "stripe");
    }

    const customerId = await this.getOrCreateCustomer(params.userId);
    const siteUrl = getSiteUrl();
    const unitAmount = Math.round(plan.price * 100);

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
