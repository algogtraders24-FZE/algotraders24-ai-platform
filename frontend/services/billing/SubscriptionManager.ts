// services/billing/SubscriptionManager.ts
// Sprint 13A — Subscription & Billing Foundation
// Subscription state + plan-change preview logic (mock, no persistence).

import type {
  Subscription,
  PlanId,
  PlanChangePreview,
  BillingCycle,
} from "@/types/billing";
import { MOCK_SUBSCRIPTION } from "@/data/mock-billing";
import { planService } from "./PlanService";
import { pricingService } from "./PricingService";

export class SubscriptionManager {
  private subscription: Subscription;

  constructor(subscription: Subscription = MOCK_SUBSCRIPTION) {
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

    const priceDelta = pricingService.getPriceDelta(
      fromPlanId,
      toPlanId,
      cycle
    );

    // Simple mock proration: unused portion of current cycle credited on upgrade
    const prorationCredit =
      direction === "upgrade"
        ? Math.round(pricingService.getPrice(fromPlanId, cycle) * 0.5 * 100) /
          100
        : 0;

    return {
      fromPlanId,
      toPlanId,
      direction,
      priceDelta,
      effectiveDate: this.subscription.renewalDate,
      prorationCredit,
    };
  }

  // Mock mutation — returns a new subscription object, does not persist.
  applyChange(toPlanId: PlanId, cycle?: BillingCycle): Subscription {
    const nextCycle = cycle ?? this.subscription.billingCycle;
    const price = pricingService.getPrice(toPlanId, nextCycle);
    const updated: Subscription = {
      ...this.subscription,
      planId: toPlanId,
      billingCycle: nextCycle,
      currentPrice: price,
    };
    return updated;
  }
}

export const subscriptionManager = new SubscriptionManager();
