// services/billing/SubscriptionActionService.ts
// Sprint L2.5 - Real subscription mutations. No payment provider is wired
// (see the L2.5 audit) - cancel/reactivate never involve money and are
// fully real, immediate DB writes. A plan change is only ever persisted
// when the target plan's price is 0: granting a paid plan without
// collecting payment would be exactly the kind of fabrication this
// project's entire billing rework exists to remove, so those requests are
// rejected with PaymentRequiredError instead of silently succeeding.
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
}

export const subscriptionActionService = new SubscriptionActionService();
