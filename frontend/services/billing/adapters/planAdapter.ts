// services/billing/adapters/planAdapter.ts
// Sprint 14E - Maps database Plan rows onto the UI Plan domain type.
// Pricing, name, and feature list come from the database; entitlement limits
// come from config (product configuration, not user data).
import type { Plan, PlanId } from "@/types/billing";
import type { ApiPlan } from "@/services/api/BillingApi";
import { PLAN_LIMITS, isPlanId } from "@/config/plan-limits";

export function toPlan(row: ApiPlan): Plan | null {
  if (!isPlanId(row.id)) return null;
  const planId: PlanId = row.id;
  const limits = PLAN_LIMITS[planId];

  return {
    id: planId,
    name: row.name,
    description: limits.description,
    priceMonthly: row.price,
    priceYearly: limits.priceYearly,
    aiCredits: limits.aiCredits,
    maxAgents: limits.maxAgents,
    maxAutomations: limits.maxAutomations,
    maxKnowledgeDocuments: limits.maxKnowledgeDocuments,
    storageLimit: limits.storageLimit,
    apiAccess: limits.apiAccess,
    prioritySupport: limits.prioritySupport,
    customBranding: limits.customBranding,
    teamMembers: limits.teamMembers,
    status: "active",
    highlighted: limits.highlighted,
    features: row.features,
  };
}

export function toPlans(rows: ApiPlan[]): Plan[] {
  return rows.map(toPlan).filter((p): p is Plan => p !== null);
}