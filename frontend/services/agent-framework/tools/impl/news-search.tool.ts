// services/agent-framework/tools/impl/news-search.tool.ts
// AT24 Agent Framework - A11. Tool: news.search
//
// A THIN adapter over the EXISTING AlphaVantageNewsProvider (the same one the
// 15D intelligence pipeline uses for news evidence). NOT a new news system.
// isConfigured()-gated: with no ALPHA_VANTAGE_API_KEY the tool returns an
// honest empty result, never a fabricated headline.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";

interface NewsSearchInput {
  symbol: string;
  asOf?: string;
}

interface NewsHeadline {
  claim: string;
  source: string;
  asOf: string;
}

const definition: ToolDefinition = {
  id: "news.search",
  name: "News Search",
  description:
    "Recent market-moving headlines for an instrument, from AT24's news provider. Each headline is real (never fabricated); an unconfigured provider returns an empty result.",
  version: "1.0.0",
  category: "NEWS",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { symbol: { type: "string", minLength: 1 }, asOf: { type: "string", format: "date-time" } },
    required: ["symbol"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_NEWS"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("news.search") },
  executionMode: "sync",
  evidence: { producesEvidence: true, evidenceTypes: ["news"], provenanceProducer: "alpha-vantage-news" },
  status: "active",
  wraps: "lib/market-data/providers/alpha-vantage-news.provider.ts (AlphaVantageNewsProvider.getNewsEvidence)",
};

function parseInput(raw: unknown): ToolInputParseResult<NewsSearchInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const symbol = raw.symbol;
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    return { ok: false, violations: [{ path: "symbol", message: "symbol is required (non-empty string)." }] };
  }
  if (raw.asOf !== undefined && (typeof raw.asOf !== "string" || Number.isNaN(Date.parse(raw.asOf)))) {
    return { ok: false, violations: [{ path: "asOf", message: "asOf must be an ISO-8601 date-time." }] };
  }
  return { ok: true, value: { symbol: symbol.trim().toUpperCase(), asOf: typeof raw.asOf === "string" ? raw.asOf : undefined } };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (!Array.isArray(value.headlines)) return contractResult([{ path: "headlines", message: "output.headlines must be an array." }]);
  if (typeof value.configured !== "boolean") return contractResult([{ path: "configured", message: "output.configured must be a boolean." }]);
  return contractOk();
}

function toEvidence(headlines: NewsHeadline[]): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  return headlines.map((h) => ({
    type: "news",
    claim: h.claim,
    source: h.source,
    sourceId: `${h.source}:${h.asOf}`,
    timestamp: h.asOf,
    data: h,
    relevance: 0.7,
    confidence: 0.7,
    provenance: { producer: "alpha-vantage-news", retrievedAt: now },
  }));
}

export const newsSearchTool: ToolImplementation<NewsSearchInput, { headlines: NewsHeadline[]; configured: boolean }> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    const { AlphaVantageNewsProvider } = await import("@/lib/market-data/providers/alpha-vantage-news.provider");
    const provider = new AlphaVantageNewsProvider();
    if (!provider.isConfigured()) {
      return { output: { headlines: [], configured: false }, evidence: [] };
    }
    let items: { claim: string; source: string; asOf?: string; retrievedAt: string }[] = [];
    try {
      items = (await provider.getNewsEvidence({ symbol: input.symbol, asOf: input.asOf })) as typeof items;
    } catch {
      // rate-limit / network / malformed - honest empty, never fatal
      return { output: { headlines: [], configured: true }, evidence: [] };
    }
    const headlines: NewsHeadline[] = items.map((i) => ({ claim: i.claim, source: i.source, asOf: i.asOf ?? i.retrievedAt }));
    return { output: { headlines, configured: true }, evidence: toEvidence(headlines) };
  },
};
