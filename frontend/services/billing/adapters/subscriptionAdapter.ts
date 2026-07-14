// services/billing/adapters/subscriptionAdapter.ts
// Sprint 14E - Maps the database Subscription row onto the UI Subscription type.
// Period, status, plan and cancellation come from the database. Billing cycle,
// provider and price are derived; provider-specific fields (trial, autoRenew)
// become real when Stripe lands in Sprint 15A.
import type {
  Subscription,
  SubscriptionStatus,
  PlanId,
  BillingCycle,
} from "@/types/billing";
import type { ApiSubscription } from "@/services/api/BillingApi";
import { PLAN_LIMITS, isPlanId } from "@/config/plan-limits";

function toStatus(value: string): SubscriptionStatus {
  switch (value) {
    case "trialing":
    case "past_due":
    case "canceled":
    case "paused":
      return value;
    default:
      return "active";
  }
}

function toCycle(start: string, end: string): BillingCycle {
  const days =
    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
  return days > 200 ? "yearly" : "monthly";
}

export function toSubscription(
  row: ApiSubscription,
  monthlyPrice: number
): Subscription {
  const planId: PlanId = isPlanId(row.planId) ? row.planId : "free";
  const cycle = toCycle(row.currentPeriodStart, row.currentPeriodEnd);
  const status = toStatus(row.status);

  const price =
    cycle === "yearly" ? PLAN_LIMITS[planId].priceYearly : monthlyPrice;

  return {
    id: row.id,
    userId: row.userId,
    planId,
    status,
    billingCycle: cycle,
    currentPrice: price,
    startedAt: row.createdAt,
    renewalDate: row.currentPeriodEnd,
    canceledAt: status === "canceled" ? row.updatedAt : null,
    trialEndsAt: null,
    provider: "mock",
    autoRenew: !row.cancelAtPeriodEnd,
  };
}

// Used when a user has no Subscription row yet (e.g. free tier).
export function fallbackSubscription(
  userId: string,
  planId: PlanId
): Subscription {
  const now = new Date();
  const renewal = new Date(now);
  renewal.setMonth(renewal.getMonth() + 1);

  return {
    id: "",
    userId,
    planId,
    status: "active",
    billingCycle: "monthly",
    currentPrice: 0,
    startedAt: now.toISOString(),
    renewalDate: renewal.toISOString(),
    canceledAt: null,
    trialEndsAt: null,
    provider: "mock",
    autoRenew: true,
  };
}