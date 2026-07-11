// services/billing/UsageService.ts
// Sprint 13A — Subscription & Billing Foundation
// Usage overview + derived usage metrics.

import type { UsageOverview, UsageMetric } from "@/types/billing";
import { MOCK_USAGE } from "@/data/mock-billing";
import { USAGE_THRESHOLDS } from "@/config/billing.config";

export class UsageService {
  private usage: UsageOverview;

  constructor(usage: UsageOverview = MOCK_USAGE) {
    this.usage = usage;
  }

  get(): UsageOverview {
    return { ...this.usage };
  }

  pct(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }

  level(used: number, limit: number): "ok" | "warning" | "critical" {
    const p = this.pct(used, limit);
    if (p >= USAGE_THRESHOLDS.critical) return "critical";
    if (p >= USAGE_THRESHOLDS.warning) return "warning";
    return "ok";
  }

  getMetrics(): UsageMetric[] {
    const u = this.usage;
    return [
      { label: "AI Credits", used: u.aiCreditsUsed, limit: u.aiCreditsLimit, unit: "credits" },
      { label: "AI Agents", used: u.agentsUsed, limit: u.agentsLimit, unit: "agents" },
      { label: "Automations", used: u.automationsUsed, limit: u.automationsLimit, unit: "automations" },
      { label: "Knowledge Docs", used: u.knowledgeDocsUsed, limit: u.knowledgeDocsLimit, unit: "docs" },
      { label: "Storage", used: u.storageUsedMb, limit: u.storageLimitMb, unit: "MB" },
      { label: "API Calls", used: u.apiCallsUsed, limit: u.apiCallsLimit, unit: "calls" },
    ];
  }

  getCreditsRemaining(): number {
    return Math.max(0, this.usage.aiCreditsLimit - this.usage.aiCreditsUsed);
  }

  getApiUsagePct(): number {
    return this.pct(this.usage.apiCallsUsed, this.usage.apiCallsLimit);
  }

  getStorageUsedMb(): number {
    return this.usage.storageUsedMb;
  }

  getStorageLimitMb(): number {
    return this.usage.storageLimitMb;
  }
}

export const usageService = new UsageService();
