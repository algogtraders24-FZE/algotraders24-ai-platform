// services/mcp/tools/edge-analysis.tool.ts
// AT24 MCP - tool: edge.analysis. Returns the caller's most recent SAVED Edge
// Analyzer analysis (or a named one of theirs), condensed for an AI client.
//
// Read-only and strictly per-user (ctx.userId only; the id argument can never
// reach another user's row). PAID-gated at the MCP facade (MCP_PLAN_GATED_TOOLS)
// because saved analyses are a paid feature.
//
// Output hygiene: strings that come from the user's own trade file (EA comment
// tags, symbols) are length-capped and stripped of control characters before they
// are handed to an AI, so a hostile comment cannot smuggle instructions in as
// anything other than a short label inside a typed field. All numbers/headlines
// were computed by AT24; nothing here is recomputed or invented.

import type { ToolDefinition } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "@/services/agent-framework/tools/tool-implementation";
import { isRecord } from "@/services/agent-framework/tools/tool-implementation";
import type { EdgeSavedStore, SavedAnalysisFull } from "@/services/edge-analyzer/saved";
import type { BucketStat } from "@/services/edge-analyzer/analysis/patterns";

interface EdgeAnalysisInput {
  analysisId?: string;
}

export const EDGE_TOOL_NOTE = "Descriptive analysis of the user's own past trades, computed by AT24. Not investment advice and not a trading signal.";
const LABEL_MAX = 40;

/** Cap and clean a label that originated in the user's file. */
export function cleanLabel(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

const definition: ToolDefinition = {
  id: "edge.analysis",
  name: "Saved Edge Analysis",
  description:
    "The user's most recent saved Edge Analyzer analysis of their own MetaTrader trade history: verdict (evidence of edge vs luck), key numbers, risk scenarios, and where results come from (strategy tag, symbol, weekday, hour). Returns status none_saved if nothing is saved. Read-only.",
  version: "1.0.0",
  category: "RESEARCH",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { analysisId: { type: "string", minLength: 1, maxLength: 40 } },
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_RUN_RESEARCH"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: 1 },
  executionMode: "sync",
  evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "edge-analyzer" },
  status: "active",
  wraps: "services/edge-analyzer/saved.ts (EdgeSavedStore.get)",
};

function parseInput(raw: unknown): ToolInputParseResult<EdgeAnalysisInput> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  for (const k of Object.keys(raw)) if (k !== "analysisId") return { ok: false, violations: [{ path: k, message: "unknown field." }] };
  if (raw.analysisId === undefined) return { ok: true, value: {} };
  if (typeof raw.analysisId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(raw.analysisId)) {
    return { ok: false, violations: [{ path: "analysisId", message: "analysisId must be a short id." }] };
  }
  return { ok: true, value: { analysisId: raw.analysisId } };
}

function checkOutput(value: unknown) {
  if (!isRecord(value) || typeof value.status !== "string") return contractResult([{ path: "status", message: "output.status must be a string." }]);
  return contractOk();
}

const group = (b: BucketStat) => ({ name: cleanLabel(b.key.replace(/^\d\s/, "")), trades: b.count, net: b.net, winRatePct: b.winRatePct, avgPerTrade: b.expectancy, fewTrades: b.lowSample });

/** Condense a saved analysis into a bounded, AI-friendly object. Pure. */
export function summarizeAnalysis(saved: SavedAnalysisFull) {
  const r = saved.report;
  const byNet = (rows: BucketStat[]) => [...rows].sort((a, b) => b.net - a.net);
  // "Best" lists only contain groups that made money and "worst" only groups that
  // lost money: calling a profitable group "worst" would mislead an AI client.
  const winners = (rows: BucketStat[]) => byNet(rows).filter((x) => x.net > 0);
  const losers = (rows: BucketStat[]) => byNet(rows).filter((x) => x.net < 0).reverse();
  const s = r.patterns.sizeAfterOutcome;
  return {
    status: "ok" as const,
    analysis: {
      id: saved.id,
      savedAt: saved.createdAt.toISOString(),
      tradeCount: r.core.tradeCount,
      currency: r.meta.currency,
      accountMode: r.meta.accountMode,
      verdict: { level: r.edge.level, headline: r.edge.headline },
      keyNumbers: {
        netProfit: r.core.netProfit,
        winRatePct: r.core.winRatePct,
        profitFactor: r.core.profitFactor,
        averageResultPerTrade: r.core.expectancy,
        payoffRatio: r.core.payoffRatio,
        maxDrawdownPct: r.core.maxDrawdownPct,
        maxDrawdownAmount: r.core.maxDrawdownAbs,
        longestLosingStreak: r.core.maxConsecutiveLosses,
        startBalance: r.core.startBalance,
        endBalance: r.core.endBalance,
      },
      evidence: {
        ci95: r.edge.ci95,
        pValue: r.edge.pValue,
        tradesNeededToTellFromZero: r.edge.tradesNeeded,
        tradesOverlappingPct: r.edge.overlapPct,
        lag1Autocorrelation: r.edge.lag1Autocorrelation,
        dependenceDetected: r.edge.dependenceFlag,
        perLotLevel: r.edge.perLot?.level ?? null,
      },
      risk: r.ruin
        ? r.ruin.scenarios.map((sc) => ({
            scenario: sc.name,
            horizonTrades: sc.horizonTrades,
            probabilityDrawdownReaches: sc.probDrawdownReaches,
            probabilityEndsBelowStart: sc.probFinishBelowStart,
            medianMaxDrawdownPct: sc.medianMaxDrawdownPct,
            finalBalance: { p5: sc.finalBalancePercentiles.p5, median: sc.finalBalancePercentiles.p50, p95: sc.finalBalancePercentiles.p95 },
          }))
        : null,
      whereResultsComeFrom: {
        strategyTagsBest: winners(r.patterns.byTag).slice(0, 3).map(group),
        strategyTagsWorst: losers(r.patterns.byTag).slice(0, 3).map(group),
        symbols: byNet(r.patterns.bySymbol).slice(0, 10).map(group),
        weekdays: r.patterns.byWeekday.map(group),
        bestHours: winners(r.patterns.byHour).slice(0, 3).map(group),
        worstHours: losers(r.patterns.byHour).slice(0, 3).map(group),
        directions: r.patterns.byDirection.map(group),
      },
      habits: {
        averageLotAfterLoss: s.avgVolumeAfterLoss,
        averageLotAfterWin: s.avgVolumeAfterWin,
        lotAfterLossRatio: s.ratio,
        averageHoldMinutesWinners: r.core.avgHoldMsWinners === null ? null : Math.round(r.core.avgHoldMsWinners / 60000),
        averageHoldMinutesLosers: r.core.avgHoldMsLosers === null ? null : Math.round(r.core.avgHoldMsLosers / 60000),
      },
      matchesTerminalSummary: r.reconciled,
      caveats: r.edge.caveats,
      assumptions: r.assumptions,
    },
    note: EDGE_TOOL_NOTE,
  };
}

export type EdgeAnalysisOutput = ReturnType<typeof summarizeAnalysis> | { status: "none_saved"; message: string; note: string };

export function createEdgeAnalysisTool(deps: { store?: EdgeSavedStore } = {}): ToolImplementation<EdgeAnalysisInput, EdgeAnalysisOutput> {
  return {
    definition,
    parseInput,
    checkOutput,
    async handler(input, ctx) {
      // Lazy default keeps this module importable without Prisma (tests inject a store).
      const store = deps.store ?? (await import("@/services/edge-analyzer/prisma-saved-store")).prismaEdgeSavedStore;
      const saved = await store.get(ctx.userId, input.analysisId);
      if (!saved) {
        return {
          output: {
            status: "none_saved",
            message: "No saved analysis found. The user can upload and save a MetaTrader report in the AT24 dashboard (Edge Analyzer).",
            note: EDGE_TOOL_NOTE,
          },
          evidence: [],
        };
      }
      return { output: summarizeAnalysis(saved), evidence: [] };
    },
  };
}
