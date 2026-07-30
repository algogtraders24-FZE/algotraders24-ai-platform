// services/billing/SubscriptionManager.ts
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - Removed the fabricated 50%-flat proration credit and the
// mock applyChange() that mutated in-memory state without persisting
// anything. Plan changes are now real, server-side mutations (see
// SubscriptionActionService + the Billing page's action handlers) -
// this class is read/preview-only. previewChange() now reports
// `requiresPayment` (true whenever the target plan isn't $0) instead of a
// guessed proration number no payment processor backs.
import type { Subscription, PlanId, PlanChangePreview } from "@/types/billing";
import { planService } from "./PlanService";
import { pricingService } from "./PricingService";

const EMPTY_SUBSCRIPTION: Subscription = {
  id: "",
  userId: "",
  planId: "free",
  status: "active",
  billingCycle: "monthly",
  currentPrice: 0,
  startedAt: new Date(0).toISOString(),
  renewalDate: new Date(0).toISOString(),
  canceledAt: null,
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
};

export class SubscriptionManager {
  private subscription: Subscription;

  constructor(subscription: Subscription = EMPTY_SUBSCRIPTION) {
    this.subscription = { ...subscription };
  }

  // Sprint 14E - Replaces the in-memory subscription with the database row.
  hydrate(subscription: Subscription): void {
    this.subscription = { ...subscription };
  }

  get(): Subscription {
    return { ...this.subscription };
  }

  getCurrentPlanId(): PlanId {
    return this.subscription.planId;
  }

  isActive(): boolean {
    return (
      this.subscription.status === "active" ||
      this.subscription.status === "trialing"
    );
  }

  previewChange(toPlanId: PlanId): PlanChangePreview {
    const fromPlanId = this.subscription.planId;
    const cycle = this.subscription.billingCycle;
    const rank = planService.compareRank(fromPlanId, toPlanId);

    const direction: PlanChangePreview["direction"] =
      rank < 0 ? "upgrade" : rank > 0 ? "downgrade" : "same";

    const priceDelta = pricingService.getPriceDelta(fromPlanId, toPlanId, cycle);
    const targetPrice = pricingService.getPrice(toPlanId, cycle);

    return {
      fromPlanId,
      toPlanId,
      direction,
      priceDelta,
      effectiveDate: this.subscription.renewalDate,
      requiresPayment: targetPrice > 0,
    };
  }
}

export const subscriptionManager = new SubscriptionManager();
