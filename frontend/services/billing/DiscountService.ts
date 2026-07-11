// services/billing/DiscountService.ts
// Sprint 13A — Subscription & Billing Foundation
// Discount code validation + application (mock).

import type { Discount, PlanId } from "@/types/billing";
import { MOCK_DISCOUNTS } from "@/data/mock-billing";

export interface DiscountResult {
  valid: boolean;
  reason?: string;
  discount?: Discount;
  finalPrice: number;
  amountSaved: number;
}

export class DiscountService {
  private discounts: Discount[];

  constructor(discounts: Discount[] = MOCK_DISCOUNTS) {
    this.discounts = discounts;
  }

  getAll(): Discount[] {
    return [...this.discounts];
  }

  getActive(): Discount[] {
    return this.discounts.filter((d) => d.active && !this.isExpired(d));
  }

  findByCode(code: string): Discount | null {
    const norm = code.trim().toUpperCase();
    return this.discounts.find((d) => d.code.toUpperCase() === norm) ?? null;
  }

  private isExpired(d: Discount): boolean {
    if (!d.validUntil) return false;
    return new Date(d.validUntil).getTime() < Date.now();
  }

  apply(code: string, planId: PlanId, basePrice: number): DiscountResult {
    const discount = this.findByCode(code);

    if (!discount) {
      return { valid: false, reason: "Code not found", finalPrice: basePrice, amountSaved: 0 };
    }
    if (!discount.active || this.isExpired(discount)) {
      return { valid: false, reason: "Code expired", finalPrice: basePrice, amountSaved: 0 };
    }
    if (!discount.appliesToPlans.includes(planId)) {
      return { valid: false, reason: "Not valid for this plan", discount, finalPrice: basePrice, amountSaved: 0 };
    }

    let amountSaved = 0;
    if (discount.percentOff != null) {
      amountSaved = Math.round(basePrice * (discount.percentOff / 100) * 100) / 100;
    } else if (discount.amountOff != null) {
      amountSaved = Math.min(basePrice, discount.amountOff);
    }

    const finalPrice = Math.max(0, Math.round((basePrice - amountSaved) * 100) / 100);
    return { valid: true, discount, finalPrice, amountSaved };
  }
}

export const discountService = new DiscountService();
