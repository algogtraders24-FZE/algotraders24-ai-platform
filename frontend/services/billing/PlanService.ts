// services/billing/PlanService.ts
// Sprint 13A — Subscription & Billing Foundation
// Repository + query layer over plan data.

import type { Plan, PlanId } from "@/types/billing";
import { MOCK_PLANS } from "@/data/mock-billing";
import { PLAN_ORDER } from "@/config/billing.config";

export class PlanService {
  private plans: Plan[];

  constructor(plans: Plan[] = MOCK_PLANS) {
    this.plans = plans;
  }

  getAll(): Plan[] {
    return [...this.plans].sort(
      (a, b) => PLAN_ORDER[a.id] - PLAN_ORDER[b.id]
    );
  }

  getActive(): Plan[] {
    return this.getAll().filter((p) => p.status === "active");
  }

  getById(id: PlanId): Plan | null {
    return this.plans.find((p) => p.id === id) ?? null;
  }

  getHighlighted(): Plan | null {
    return this.plans.find((p) => p.highlighted) ?? null;
  }

  getUpgrades(fromId: PlanId): Plan[] {
    const fromRank = PLAN_ORDER[fromId];
    return this.getActive().filter((p) => PLAN_ORDER[p.id] > fromRank);
  }

  getDowngrades(fromId: PlanId): Plan[] {
    const fromRank = PLAN_ORDER[fromId];
    return this.getActive().filter((p) => PLAN_ORDER[p.id] < fromRank);
  }

  compareRank(a: PlanId, b: PlanId): number {
    return PLAN_ORDER[a] - PLAN_ORDER[b];
  }
}

export const planService = new PlanService();
