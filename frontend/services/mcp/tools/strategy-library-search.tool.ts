// services/mcp/tools/strategy-library-search.tool.ts
// AT24 MCP v1 - tool: strategy.library_search. Searches the static Quant Lite
// library sample (data/quant-lite-library-sample.ts).
//
// HONESTY (claims policy): every row is LEGACY-BACKTEST-EVIDENCE from the
// pre-fix legacy engine - NEVER "validated". The caveat is part of every
// response and the metrics are returned as-is, never ranked as "best".

import type { ToolDefinition } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "@/services/agent-framework/tools/tool-implementation";
import { isRecord } from "@/services/agent-framework/tools/tool-implementation";
import { LIBRARY_SAMPLE } from "@/data/quant-lite-library-sample";
import type { LibraryEntry } from "@/types/quant-lite";

export const LIBRARY_LEGACY_CAVEAT =
  "Legacy backtest evidence from AT24's earlier engine, generated before later execution fixes. Not validated, not a forward-looking claim, not a recommendation. Re-test any idea before relying on it.";

export const LIBRARY_TOOL_MAX_RESULTS = 20;

interface LibrarySearchInput {
  symbol?: string;
  timeframe?: string;
  triggerKey?: string;
  minProfitFactor?: number;
  minTrades?: number;
  limit: number;
}

interface LibrarySearchRow {
  id: string;
  symbol: string;
  timeframe: string;
  triggerKey: string;
  filterKey: string;
  riskPreset: string;
  tradesTotal: number;
  winRatePct: number;
  profitFactor: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  wfPctProfitable: number | null;
  wfRobustnessScore: number | null;
}

interface LibrarySearchOutput {
  evidenceLabel: "LEGACY-BACKTEST-EVIDENCE";
  caveat: string;
  totalMatches: number;
  results: LibrarySearchRow[];
}

const definition: ToolDefinition = {
  id: "strategy.library_search",
  name: "Strategy Library Search",
  description:
    "Search AT24's static library of 100 legacy backtest results by symbol, timeframe, trigger family and minimum profit factor/trades. Results are legacy evidence, never validated, and are not ranked as best.",
  version: "1.0.0",
  category: "STRATEGY_LIBRARY",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 20 },
      timeframe: { type: "string", minLength: 1, maxLength: 5 },
      triggerKey: { type: "string", minLength: 1, maxLength: 40 },
      minProfitFactor: { type: "number", minimum: 0, maximum: 100 },
      minTrades: { type: "integer", minimum: 0, maximum: 100000 },
      limit: { type: "integer", minimum: 1, maximum: LIBRARY_TOOL_MAX_RESULTS },
    },
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_RUN_RESEARCH"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: 1 },
  executionMode: "sync",
  evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "strategy-library" },
  status: "active",
  wraps: "data/quant-lite-library-sample.ts (static read-only snapshot)",
};

const KEYS = ["symbol", "timeframe", "triggerKey", "minProfitFactor", "minTrades", "limit"] as const;

function parseInput(raw: unknown): ToolInputParseResult<LibrarySearchInput> {
  const obj = raw === undefined || raw === null ? {} : raw;
  if (!isRecord(obj)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  for (const k of Object.keys(obj)) {
    if (!(KEYS as readonly string[]).includes(k)) return { ok: false, violations: [{ path: k, message: "unknown field." }] };
  }
  const value: LibrarySearchInput = { limit: 10 };
  for (const k of ["symbol", "timeframe", "triggerKey"] as const) {
    const v = obj[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.trim().length === 0 || v.length > 40) return { ok: false, violations: [{ path: k, message: "must be a short non-empty string." }] };
    value[k] = v.trim();
  }
  if (obj.minProfitFactor !== undefined) {
    if (typeof obj.minProfitFactor !== "number" || !Number.isFinite(obj.minProfitFactor) || obj.minProfitFactor < 0 || obj.minProfitFactor > 100) {
      return { ok: false, violations: [{ path: "minProfitFactor", message: "must be a number 0-100." }] };
    }
    value.minProfitFactor = obj.minProfitFactor;
  }
  if (obj.minTrades !== undefined) {
    if (!Number.isInteger(obj.minTrades) || (obj.minTrades as number) < 0 || (obj.minTrades as number) > 100000) {
      return { ok: false, violations: [{ path: "minTrades", message: "must be an integer 0-100000." }] };
    }
    value.minTrades = obj.minTrades as number;
  }
  if (obj.limit !== undefined) {
    if (!Number.isInteger(obj.limit) || (obj.limit as number) < 1 || (obj.limit as number) > LIBRARY_TOOL_MAX_RESULTS) {
      return { ok: false, violations: [{ path: "limit", message: `must be an integer 1-${LIBRARY_TOOL_MAX_RESULTS}.` }] };
    }
    value.limit = obj.limit as number;
  }
  return { ok: true, value };
}

function checkOutput(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.results)) return contractResult([{ path: "results", message: "output.results must be an array." }]);
  if (value.evidenceLabel !== "LEGACY-BACKTEST-EVIDENCE") return contractResult([{ path: "evidenceLabel", message: "legacy label is mandatory." }]);
  return contractOk();
}

function toRow(e: LibraryEntry): LibrarySearchRow {
  return {
    id: e.id,
    symbol: e.symbol,
    timeframe: e.timeframe,
    triggerKey: e.triggerKey,
    filterKey: e.filterKey,
    riskPreset: e.riskPreset,
    tradesTotal: e.tradesTotal,
    winRatePct: e.winRatePct,
    profitFactor: e.profitFactor,
    totalReturnPct: e.totalReturnPct,
    maxDrawdownPct: e.maxDrawdownPct,
    wfPctProfitable: e.wfPctProfitable,
    wfRobustnessScore: e.wfRobustnessScore,
  };
}

export function searchLibrary(input: LibrarySearchInput, entries: LibraryEntry[] = LIBRARY_SAMPLE): LibrarySearchOutput {
  const sym = input.symbol?.toUpperCase();
  const tf = input.timeframe?.toLowerCase();
  const trig = input.triggerKey?.toLowerCase();
  const matches = entries.filter((e) => {
    if (sym && !e.symbol.toUpperCase().startsWith(sym)) return false;
    if (tf && e.timeframe.toLowerCase() !== tf) return false;
    if (trig && e.triggerKey.toLowerCase() !== trig) return false;
    if (input.minProfitFactor !== undefined && e.profitFactor < input.minProfitFactor) return false;
    if (input.minTrades !== undefined && e.tradesTotal < input.minTrades) return false;
    return true;
  });
  // Stable, neutral order (library id), deliberately NOT ranked by performance.
  const ordered = [...matches].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return {
    evidenceLabel: "LEGACY-BACKTEST-EVIDENCE",
    caveat: LIBRARY_LEGACY_CAVEAT,
    totalMatches: matches.length,
    results: ordered.slice(0, input.limit).map(toRow),
  };
}

export const strategyLibrarySearchTool: ToolImplementation<LibrarySearchInput, LibrarySearchOutput> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    return { output: searchLibrary(input), evidence: [] };
  },
};
