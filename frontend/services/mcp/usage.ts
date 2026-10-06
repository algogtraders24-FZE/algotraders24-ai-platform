// services/mcp/usage.ts
// AT24 MCP v1 - the per-user usage summary shown on /dashboard/mcp.
// Pure builder (testable without a DB); the route feeds it McpCallLog data.
// Only metadata is ever involved - never arguments or results.

import { MCP_TOOL_NAMES, type McpToolName } from "./mcp-tool-map";
import { MCP_DAILY_LIMITS, startOfUtcDay } from "./quota";

export interface McpUsageRecentCall {
  tool: string;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  createdAt: Date;
}

export interface McpUsageToolRow {
  name: McpToolName;
  used: number;
  limit: number;
  remaining: number;
}

export interface McpUsageSummary {
  serviceEnabled: boolean;
  /** Next UTC midnight - when daily counts reset. */
  resetsAt: string;
  tools: McpUsageToolRow[];
  recent: { tool: string; ok: boolean; errorCode: string | null; durationMs: number; at: string }[];
}

export function nextUtcMidnight(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
}

/**
 * @param counts  today's logged call count per tool name (unknown names ignored)
 * @param recent  newest-first; only calls to KNOWN tools are shown, capped at 20
 */
export function buildUsageSummary(input: {
  serviceEnabled: boolean;
  counts: Record<string, number>;
  recent: McpUsageRecentCall[];
  now?: Date;
}): McpUsageSummary {
  const now = input.now ?? new Date();
  const known = new Set<string>(MCP_TOOL_NAMES);
  const tools = MCP_TOOL_NAMES.map((name) => {
    const used = Math.max(0, Math.floor(input.counts[name] ?? 0));
    const limit = MCP_DAILY_LIMITS[name];
    return { name, used, limit, remaining: Math.max(0, limit - used) };
  });
  const recent = input.recent
    .filter((r) => known.has(r.tool))
    .slice(0, 20)
    .map((r) => ({ tool: r.tool, ok: r.ok, errorCode: r.errorCode, durationMs: Math.max(0, Math.round(r.durationMs)), at: r.createdAt.toISOString() }));
  return { serviceEnabled: input.serviceEnabled, resetsAt: nextUtcMidnight(now).toISOString(), tools, recent };
}
