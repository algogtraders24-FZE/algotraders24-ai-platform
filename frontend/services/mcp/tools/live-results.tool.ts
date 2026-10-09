// services/mcp/tools/live-results.tool.ts
// AT24 MCP v1 - tool: live_results.read. Thin adapter over the PUBLIC Live Results data (the same redacted view
// model the public pages and the public JSON API serve). Read-only; public pages only; percent-only summaries.
//   no slug  -> a list of public pages (ResultsSummary, at most 50)
//   slug     -> one public page, compact: summary + periods + months + strategies + integrity + disclosure
// Terminal-reported, NOT independently verified, never advice; there is no ranking by gain.

import type { ToolDefinition } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "@/services/agent-framework/tools/tool-implementation";
import { isRecord } from "@/services/agent-framework/tools/tool-implementation";
import { LISTING_SLUG_RE } from "@/services/live-results/pages";
import { downsample, summarizeResults, SUMMARY_DISCLAIMER, type ResultsSummary } from "@/services/live-results/summary";
import { withoutMoneyText, type PublicResults } from "@/services/live-results/build";

export const LIVE_RESULTS_TOOL_MAX_PAGES = 50;
export const LIVE_RESULTS_TOOL_MAX_MONTHS = 36;

interface LiveResultsToolInput {
  slug?: string;
  limit: number;
}

interface ListOutput {
  mode: "list";
  disclaimer: string;
  source: string;
  count: number;
  pages: ResultsSummary[];
}

interface PageOutput {
  mode: "page";
  disclaimer: string;
  source: string;
  summary: ResultsSummary;
  periods: { today: unknown; week: unknown; month: unknown; year: unknown };
  months: unknown[];
  strategies: PublicResults["strategies"];
  integrity: PublicResults["integrity"];
  edge: { level: string; headline: string } | null;
  growth: number[];
  caveats: string[];
}

type LiveResultsToolOutput = ListOutput | PageOutput;

const definition: ToolDefinition = {
  id: "live_results.read",
  name: "Live Results",
  description:
    "Public, terminal-reported results of trading accounts published on AT24 Live Results. Without a slug: a list of public pages with percent-only summaries (gain, max drawdown, trades, live-forward record, platform). With a slug: one public page in compact form. Not independently verified, not advice, and there is deliberately no ranking by gain.",
  version: "1.0.0",
  category: "RESEARCH",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      slug: { type: "string", minLength: 3, maxLength: 80 },
      limit: { type: "integer", minimum: 1, maximum: LIVE_RESULTS_TOOL_MAX_PAGES },
    },
  },
  outputSchema: { type: "object" },
  requiredPermissions: [],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: 0 },
  executionMode: "sync",
  evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "live-results" },
  status: "active",
  wraps: "services/live-results/prisma-store.ts (public pages only)",
};

function parseInput(raw: unknown): ToolInputParseResult<LiveResultsToolInput> {
  const obj = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(obj)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  for (const k of Object.keys(obj)) {
    if (k !== "slug" && k !== "limit") return { ok: false, violations: [{ path: k, message: "unknown field." }] };
  }
  const value: LiveResultsToolInput = { limit: 20 };
  if (obj.slug !== undefined) {
    if (typeof obj.slug !== "string" || !LISTING_SLUG_RE.test(obj.slug)) return { ok: false, violations: [{ path: "slug", message: "must be a page slug (lowercase letters, digits and dashes)." }] };
    value.slug = obj.slug;
  }
  if (obj.limit !== undefined) {
    if (!Number.isInteger(obj.limit) || (obj.limit as number) < 1 || (obj.limit as number) > LIVE_RESULTS_TOOL_MAX_PAGES) {
      return { ok: false, violations: [{ path: "limit", message: `must be an integer 1-${LIVE_RESULTS_TOOL_MAX_PAGES}.` }] };
    }
    value.limit = obj.limit as number;
  }
  return { ok: true, value };
}

function checkOutput(value: unknown) {
  if (!isRecord(value) || (value.mode !== "list" && value.mode !== "page")) return contractResult([{ path: "mode", message: "output.mode must be list or page." }]);
  if (typeof value.disclaimer !== "string" || !value.disclaimer.includes("NOT independently verified")) return contractResult([{ path: "disclaimer", message: "the not-verified disclaimer is mandatory." }]);
  return contractOk();
}

/** Compact, percent-only form of one public page for an AI client (no history rows, no amounts block, no open positions). */
export function compactPage(slug: string, r: PublicResults): PageOutput {
  const s = r.stats;
  return {
    mode: "page",
    disclaimer: SUMMARY_DISCLAIMER,
    source: "terminal-reported (not independently verified)",
    summary: summarizeResults(slug, r),
    periods: { today: pctPeriod(s.daily), week: pctPeriod(s.weekly), month: pctPeriod(s.monthly), year: pctPeriod(s.yearly) },
    months: s.monthlyHistory.slice(-LIVE_RESULTS_TOOL_MAX_MONTHS).map((m) => ({ month: m.month, gainPct: m.gainPct, trades: m.trades, winRatePct: m.winRatePct })),
    strategies: r.strategies.map((x) => ({ name: x.name, trades: x.trades, winRatePct: x.winRatePct, profitFactor: x.profitFactor, sharePct: x.sharePct })),
    integrity: r.integrity,
    // The headline can name amounts on a page that shows them; this tool is percent-only, so money sentences are dropped.
    edge: r.edge ? { level: r.edge.level, headline: withoutMoneyText(r.edge.headline, r.currency) || `${r.edge.level} evidence of an edge (see the page for the caveats).` } : null,
    growth: downsample(s.growth.filter((g) => g.growthPct !== null).map((g) => g.growthPct as number), 60),
    caveats: r.disclosure,
  };
}

function pctPeriod(p: { gainPct: number | null; trades: number; winRatePct: number | null }) {
  return { gainPct: p.gainPct, trades: p.trades, winRatePct: p.winRatePct };
}

export const liveResultsTool: ToolImplementation<LiveResultsToolInput, LiveResultsToolOutput> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    // Lazy import: the store pulls in Prisma, which this module must not load at import time (scripts import the registry).
    const { listPublicSummaries, loadPublicResults } = await import("@/services/live-results/prisma-store");
    if (input.slug !== undefined) {
      const found = await loadPublicResults(input.slug);
      if (!found) throw new Error("live_results_not_found");
      return { output: compactPage(found.slug, found.results), evidence: [] };
    }
    const pages = (await listPublicSummaries()).slice(0, input.limit);
    return { output: { mode: "list", disclaimer: SUMMARY_DISCLAIMER, source: "terminal-reported (not independently verified)", count: pages.length, pages }, evidence: [] };
  },
};
