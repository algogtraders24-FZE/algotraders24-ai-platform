// services/billing/SubscriptionActionService.ts
// Sprint L2.5 - Real subscription mutations. changePlan() only ever
// persists a transition to a $0 plan (self-service, no payment provider
// wired at the time) - granting a paid plan without collecting payment
// would be fabrication, so those requests throw PaymentRequiredError
// instead of silently succeeding.
//
// Sprint L2.7 - activateFromPayment() is the one legitimate way to bypass
// that restriction: it is called exclusively by the Stripe/NOWPayments
// webhook handlers (app/api/webhooks/*), after the provider's signature has
// already been verified - i.e. only in response to a REAL, confirmed
// payment event, never from a user-facing or admin route. It's the same
// Subscription/User tables changePlan() writes to (no parallel state per
// this sprint's "prefer extending existing services" rule) - the only
// difference is which columns it also stamps (provider,
// stripeSubscriptionId/nowPaymentsInvoiceId) to record which real payment
// authorized the change.
import { prisma } from "@/lib/prisma";
import { isPlanId } from "@/config/plan-limits";
import type { PlanId } from "@/types/billing";

export class PaymentRequiredError extends Error {
  constructor(message = "This change requires payment processing, which is not yet connected.") {
    super(message);
    this.name = "PaymentRequiredError";
  }
}

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super("No active subscription to update");
    this.name = "SubscriptionNotFoundError";
  }
}

export class InvalidPlanError extends Error {
  constructor(planId: string) {
    super(`Unknown plan: ${planId}`);
    this.name = "InvalidPlanError";
  }
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export class SubscriptionActionService {
  private async findActive(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async setCancelAtPeriodEnd(userId: string, cancelAtPeriodEnd: boolean) {
    const existing = await this.findActive(userId);
    if (!existing) throw new SubscriptionNotFoundError();
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { cancelAtPeriodEnd, status: cancelAtPeriodEnd ? existing.status : "active" },
    });
  }

  // Real only for a transition to a $0 plan (no payment required). Any
  // transition to a plan priced above $0 throws PaymentRequiredError -
  // the route maps that to HTTP 402 with an honest message, never a fake
  // success.
  async changePlan(userId: string, targetPlanId: string) {
    if (!isPlanId(targetPlanId)) throw new InvalidPlanError(targetPlanId);
    const plan = await prisma.plan.findUnique({ where: { id: targetPlanId } });
    if (!plan) throw new InvalidPlanError(targetPlanId);

    if (plan.price > 0) {
      throw new PaymentRequiredError(
        `Switching to ${plan.name} requires payment processing, which is not yet connected. Contact support to complete this change.`
      );
    }

    const existing = await this.findActive(userId);
    const now = new Date();
    const periodEnd = addMonths(now, 1);
    const planId: PlanId = targetPlanId;

    const subscription = existing
      ? await prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planId,
            status: "active",
            cancelAtPeriodEnd: false,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        })
      : await prisma.subscription.create({
          data: {
            userId,
            planId,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

    await prisma.user.update({ where: { id: userId }, data: { planId } });

    return subscription;
  }

  // Sprint L2.7 - called only from a verified webhook handler after a real
  // payment/subscription event. Unlike changePlan(), this may activate any
  // plan (including paid ones) because it is never reachable from a
  // request the payment provider hasn't already confirmed.
  async activateFromPayment(params: {
    userId: string;
    planId: string;
    provider: "stripe" | "nowpayments";
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    stripeSubscriptionId?: string;
    nowPaymentsInvoiceId?: string;
  }) {
    if (!isPlanId(params.planId)) throw new InvalidPlanError(params.planId);
    const planId: PlanId = params.planId;

    const existing = await this.findActive(params.userId);
    const data = {
      planId,
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodStart: params.currentPeriodStart,
      currentPeriodEnd: params.currentPeriodEnd,
      provider: params.provider,
      stripeSubscriptionId: params.stripeSubscriptionId,
      nowPaymentsInvoiceId: params.nowPaymentsInvoiceId,
    };

    const subscription = existing
      ? await prisma.subscription.update({ where: { id: existing.id }, data })
      : await prisma.subscription.create({ data: { userId: params.userId, ...data } });

    await prisma.user.update({ where: { id: params.userId }, data: { planId } });
    return subscription;
  }

  // Sprint L2.7 - real webhook-driven cancellation (e.g. Stripe
  // `customer.subscription.deleted`), distinct from the user-facing
  // setCancelAtPeriodEnd(true) (which only schedules a future cancellation)
  // - this marks the subscription canceled immediately, matching what the
  // provider has already done.
  async markCanceledByProvider(stripeSubscriptionId: string) {
    const existing = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
    if (!existing) return null;
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { status: "canceled", cancelAtPeriodEnd: false },
    });
  }

  async findByStripeSubscriptionId(stripeSubscriptionId: string) {
    return prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
  }
}

export const subscriptionActionService = new SubscriptionActionService();
