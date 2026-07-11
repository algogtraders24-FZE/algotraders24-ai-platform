// services/billing/PricingService.ts
// Sprint 13A — Subscription & Billing Foundation
// Pricing calculations, formatting, and cycle math.

import type { Plan, PlanId, BillingCycle } from "@/types/billing";
import { CURRENCY, YEARLY_DISCOUNT_PCT } from "@/config/billing.config";
import { planService } from "./PlanService";

export class PricingService {
  formatPrice(amount: number): string {
    return new Intl.NumberFormat(CURRENCY.locale, {
      style: "currency",
      currency: CURRENCY.code,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  getPrice(planId: PlanId, cycle: BillingCycle): number {
    const plan = planService.getById(planId);
    if (!plan) return 0;
    return cycle === "monthly" ? plan.priceMonthly : plan.priceYearly;
  }

  getEffectiveMonthly(plan: Plan, cycle: BillingCycle): number {
    if (cycle === "monthly") return plan.priceMonthly;
    return Math.round((plan.priceYearly / 12) * 100) / 100;
  }

  getYearlySavings(plan: Plan): number {
    const fullYear = plan.priceMonthly * 12;
    return Math.max(0, fullYear - plan.priceYearly);
  }

  getYearlySavingsPct(plan: Plan): number {
    const fullYear = plan.priceMonthly * 12;
    if (fullYear === 0) return 0;
    return Math.round(((fullYear - plan.priceYearly) / fullYear) * 100);
  }

  getAdvertisedDiscountPct(): number {
    return YEARLY_DISCOUNT_PCT;
  }

  getPriceDelta(fromId: PlanId, toId: PlanId, cycle: BillingCycle): number {
    return this.getPrice(toId, cycle) - this.getPrice(fromId, cycle);
  }
}

export const pricingService = new PricingService();
