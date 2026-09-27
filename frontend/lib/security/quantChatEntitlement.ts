// lib/security/quantChatEntitlement.ts
// AT24 Security Hardening P1.1 - enforces the EXISTING aiCredits/aiMessages
// plan configuration (config/plan-limits.ts) for Quant Chat. This is not a
// new credit system and not a new number: aiCredits (500 free / 10k pro /
// 50k elite / 500k enterprise) and the aiMessages usage count
// (services/billing/UsageMeteringService.ts, unmodified) already existed
// and were already computed correctly - services/billing/
// EntitlementService.ts just never turned that into a gate anywhere
// (config/plan-limits.ts's own header: "until entitlement enforcement
// lands in Sprint 15A"). This file is that enforcement, kept deliberately
// separate from EntitlementService.ts/billing/usage/route.ts so this
// sprint's explicit "no changes to Entitlement" boundary stays literal -
// the period-resolution logic below is a small, intentional duplicate of
// app/api/private/billing/usage/route.ts's existing logic, not a shared
// refactor of it.
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS, isPlanId } from "@/config/plan-limits";
import { usageMeteringService } from "@/services/billing/UsageMeteringService";

export interface QuantChatEntitlementResult {
  allowed: boolean;
}

export async function checkQuantChatMonthlyEntitlement(
  userId: string,
  fallbackPlanId: string,
): Promise<QuantChatEntitlementResult> {
  const sub = await prisma.subscription.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  let periodStart: Date;
  let periodEnd: Date;
  if (sub) {
    periodStart = sub.currentPeriodStart;
    periodEnd = sub.currentPeriodEnd;
  } else {
    const now = new Date();
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const rawPlanId = sub?.planId ?? fallbackPlanId;
  const planId = isPlanId(rawPlanId) ? rawPlanId : "free";
  const usage = await usageMeteringService.getUsage(userId, periodStart, periodEnd);

  return { allowed: usage.aiMessages < PLAN_LIMITS[planId].aiCredits };
}

export const QUANT_CHAT_MONTHLY_LIMIT_MESSAGE =
  "You've reached your plan's monthly AI message limit. Upgrade your plan or wait for your next billing period.";
