// services/billing/EntitlementService.ts
// Sprint L2.5 - The single, centralized place that answers "what is this
// user entitled to, and how much have they used" (Phase 3: feature gating).
// Combines the plan's static limits (config/plan-limits.ts - product
// configuration, not user data) with UsageMeteringService's real, live
// Prisma counts. This is the only place that combines the two; every
// consumer (today: the Billing dashboard) reads the same computed
// Entitlements object, so there is no duplicated gating logic.
//
// Enforcement inside the AI Assistant / Knowledge / Market Intelligence
// pipelines themselves is intentionally NOT wired in this sprint - those
// files are off-limits per the L2.5 brief. This service is built so a
// future, explicitly-scoped sprint can call it from those pipelines
// without any changes here.
//
// Sprint L2.7 - marketAnalysisRequests/searchRequests are now real,
// period-scoped counts from RequestLogService (Phase 6), closing the gap
// this file's own header used to describe as untracked.
import type { Entitlement, Entitlements, PlanId } from "@/types/billing";
import { PLAN_LIMITS, isPlanId } from "@/config/plan-limits";
import { usageMeteringService } from "./UsageMeteringService";
import { requestLogService } from "@/services/tracking/RequestLogService";

const BYTES_PER_MB = 1024 * 1024;

function toEntitlement(used: number, limit: number): Entitlement {
  const remaining = Math.max(0, limit - used);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return { used, limit, remaining, pct, atLimit: limit > 0 && used >= limit };
}

export class EntitlementService {
  async getEntitlements(
    userId: string,
    rawPlanId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Entitlements> {
    const planId: PlanId = isPlanId(rawPlanId) ? rawPlanId : "free";
    const limits = PLAN_LIMITS[planId];
    const [usage, marketAnalysisRequests, searchRequests] = await Promise.all([
      usageMeteringService.getUsage(userId, periodStart, periodEnd),
      requestLogService.countForUser(userId, "market_analysis", periodStart, periodEnd),
      requestLogService.countForUser(userId, "knowledge_search", periodStart, periodEnd),
    ]);
    const storageMbUsed = Math.round((usage.storageBytes / BYTES_PER_MB) * 100) / 100;

    return {
      planId,
      periodStart: usage.periodStart,
      periodEnd: usage.periodEnd,
      aiMessages: toEntitlement(usage.aiMessages, limits.aiCredits),
      knowledgeDocuments: toEntitlement(usage.knowledgeDocuments, limits.maxKnowledgeDocuments),
      storageMb: toEntitlement(storageMbUsed, limits.storageLimit),
      conversations: { used: usage.conversations },
      marketAnalysisRequests: { used: marketAnalysisRequests },
      searchRequests: { used: searchRequests },
      apiAccess: limits.apiAccess,
      prioritySupport: limits.prioritySupport,
      customBranding: limits.customBranding,
      teamMembers: limits.teamMembers,
    };
  }
}

export const entitlementService = new EntitlementService();
