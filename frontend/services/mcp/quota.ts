// services/mcp/quota.ts
// AT24 MCP v1 - per-user daily quotas and a per-token burst limiter.
//
// Daily counts come from the McpCallLog rows (the audit trail doubles as the
// meter), so there is no second counter to drift. Limits are the owner-approved
// v1 defaults and are intentionally conservative.
//
// NOTE (honest scope): credits are NOT debited per MCP call in v1. The A9
// credit ledger is run-scoped (needs a runId). v1 therefore bounds cost with
// hard daily quotas; real credit metering is a separate, owner-priced step.

import type { McpPrincipal, McpQuotaGate } from "./facade";
import type { McpToolName } from "./mcp-tool-map";

/** Calls per user per UTC day. Expensive/provider-backed tools are tight. */
export const MCP_DAILY_LIMITS: Record<McpToolName, number> = {
  market_snapshot: 200,
  market_intelligence: 20,
  quant_backtest: 5,
  news_search: 20,
  economic_calendar: 100,
  strategy_library_search: 100,
  risk_calculator: 1000,
  edge_analysis: 100,
};

export interface McpUsageStore {
  /** Count of this user's logged calls to `tool` at or after `since`. */
  countSince(userId: string, tool: string, since: Date): Promise<number>;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function createDailyQuotaGate(
  usage: McpUsageStore,
  limits: Record<McpToolName, number> = MCP_DAILY_LIMITS,
  now: () => Date = () => new Date(),
): McpQuotaGate {
  return {
    async check(principal: McpPrincipal, tool: McpToolName) {
      const used = await usage.countSince(principal.userId, tool, startOfUtcDay(now()));
      return { allowed: used < limits[tool] };
    },
  };
}

/**
 * Best-effort in-memory sliding-window limiter, per token. On serverless this
 * is per-instance (not a global guarantee) - it blunts bursts; the DB-backed
 * daily quota above is the authoritative cap.
 */
export function createBurstLimiter(maxPerMinute = 60, now: () => number = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string): boolean {
      const t = now();
      const windowStart = t - 60_000;
      const recent = (hits.get(key) ?? []).filter((x) => x > windowStart);
      if (recent.length >= maxPerMinute) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.every((x) => x <= windowStart)) hits.delete(k);
      }
      return true;
    },
  };
}
