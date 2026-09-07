// services/agent-framework/credits/allowance-resolver.ts
// AT24 Agent Framework - A9. Resolves a user's period credit ALLOWANCE
// (entitlement) - the top of the accounting: allowance - ledger debits =
// balance.
//
// LOCKED (owner P3 / A9): no pricing changes. The allowance is exactly the
// existing PLAN_LIMITS[plan].aiCredits. A9 does NOT unify this pool with the
// aiMessages entitlement (services/billing/*) - that is a deliberate,
// separately-scoped billing follow-on.

import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS, isPlanId } from "@/config/plan-limits";

export interface PeriodAllowance {
  /** PLAN_LIMITS[plan].aiCredits */
  allowance: number;
  planId: string;
  /** ISO - the ledger sums entries with periodStart >= this. */
  periodStart: string;
  periodEnd: string;
}

export interface AllowanceResolver {
  resolve(userId: string): Promise<PeriodAllowance>;
}

/** Calendar-month period boundaries in UTC (matches the billing convention
 *  used elsewhere when no real Subscription period is present). */
function monthBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Reads the user's plan from the User row, then PLAN_LIMITS. Falls back to
 *  the "free" plan for an unknown / missing user. */
export class PlanAllowanceResolver implements AllowanceResolver {
  async resolve(userId: string): Promise<PeriodAllowance> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { planId: true } });
    const [sub] = user
      ? await prisma.subscription.findMany({
          where: { userId, deletedAt: null, status: "active" },
          orderBy: { currentPeriodEnd: "desc" },
          take: 1,
          select: { planId: true, currentPeriodStart: true, currentPeriodEnd: true },
        })
      : [];

    const planId = isPlanId(sub?.planId ?? user?.planId ?? "free") ? (sub?.planId ?? user?.planId ?? "free") : "free";
    const allowance = PLAN_LIMITS[planId as keyof typeof PLAN_LIMITS].aiCredits;

    if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
      return {
        allowance,
        planId,
        periodStart: sub.currentPeriodStart.toISOString(),
        periodEnd: sub.currentPeriodEnd.toISOString(),
      };
    }
    const m = monthBounds();
    return { allowance, planId, periodStart: m.start, periodEnd: m.end };
  }
}

/** A fixed allowance, for tests. */
export class FixedAllowanceResolver implements AllowanceResolver {
  constructor(private readonly allowance: number, private readonly planId = "test") {}
  async resolve(): Promise<PeriodAllowance> {
    const m = monthBounds();
    return { allowance: this.allowance, planId: this.planId, periodStart: m.start, periodEnd: m.end };
  }
}
