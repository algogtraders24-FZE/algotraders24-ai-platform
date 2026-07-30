// services/billing/UsageService.ts
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - Rewritten to wrap the real Entitlements object from
// /api/private/billing/usage (see EntitlementService) instead of
// MOCK_USAGE. Two of the six Phase 4 metrics (Market Analysis Requests,
// Search Requests) have no durable per-request record anywhere in the
// schema yet and would require editing the Market Intelligence/Knowledge
// route files this sprint may not touch - they're surfaced with
// `tracked: false` so the UI shows an honest "not yet tracked" state
// instead of a fabricated number. See the L2.5 report.
import type { Entitlements, UsageMetric } from "@/types/billing";

const EMPTY_ENTITLEMENTS: Entitlements = {
  planId: "free",
  periodStart: new Date(0).toISOString(),
  periodEnd: new Date(0).toISOString(),
  aiMessages: { used: 0, limit: 0, remaining: 0, pct: 0, atLimit: false },
  knowledgeDocuments: { used: 0, limit: 0, remaining: 0, pct: 0, atLimit: false },
  storageMb: { used: 0, limit: 0, remaining: 0, pct: 0, atLimit: false },
  conversations: { used: 0 },
  marketAnalysisRequests: { tracked: false },
  searchRequests: { tracked: false },
  apiAccess: false,
  prioritySupport: false,
  customBranding: false,
  teamMembers: 1,
};

export class UsageService {
  private entitlements: Entitlements;

  constructor(entitlements: Entitlements = EMPTY_ENTITLEMENTS) {
    this.entitlements = entitlements;
  }

  hydrate(entitlements: Entitlements): void {
    this.entitlements = entitlements;
  }

  get(): Entitlements {
    return this.entitlements;
  }

  pct(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  level(used: number, limit: number): "ok" | "warning" | "critical" {
    const p = this.pct(used, limit);
    if (p >= 90) return "critical";
    if (p >= 75) return "warning";
    return "ok";
  }

  getMetrics(): UsageMetric[] {
    const e = this.entitlements;
    return [
      { label: "AI Messages (this cycle)", used: e.aiMessages.used, limit: e.aiMessages.limit, unit: "messages", tracked: true },
      { label: "Knowledge Documents", used: e.knowledgeDocuments.used, limit: e.knowledgeDocuments.limit, unit: "docs", tracked: true },
      { label: "Storage", used: e.storageMb.used, limit: e.storageMb.limit, unit: "MB", tracked: true },
      { label: "Conversations", used: e.conversations.used, limit: -1, unit: "conversations", tracked: true },
      { label: "Market Analysis Requests", used: 0, limit: -1, unit: "requests", tracked: false },
      { label: "Search Requests", used: 0, limit: -1, unit: "requests", tracked: false },
    ];
  }

  getCreditsRemaining(): number {
    return this.entitlements.aiMessages.remaining;
  }

  getCreditsTotal(): number {
    return this.entitlements.aiMessages.limit;
  }

  getStorageUsedMb(): number {
    return this.entitlements.storageMb.used;
  }

  getStorageLimitMb(): number {
    return this.entitlements.storageMb.limit;
  }

  getConversationCount(): number {
    return this.entitlements.conversations.used;
  }
}

export const usageService = new UsageService();
