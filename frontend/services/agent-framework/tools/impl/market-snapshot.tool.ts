// services/agent-framework/tools/impl/market-snapshot.tool.ts
// AT24 Agent Framework - A2. Tool: market.snapshot
// Wraps the EXISTING shared MarketDataService singleton
// (services/market-data/shared-instance.ts). No new provider, no new cache.

import type { ToolDefinition } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { AgentEvidenceDraft } from "@/types/agent-framework";
import { marketData } from "@/services/market-data/shared-instance";
import type { MarketSnapshot } from "@/types/market-snapshot";
import { placeholderFlatCost } from "../tool-credit-costs";

interface MarketSnapshotInput {
  symbol: string;
}

const definition: ToolDefinition = {
  id: "market.snapshot",
  name: "Market Snapshot",
  description:
    "Latest verified quote (price/bid/ask/OHLC) for one instrument from AT24's multi-provider market-data service, with provider/freshness provenance.",
  version: "1.0.0",
  category: "MARKET_DATA",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { symbol: { type: "string", minLength: 1 } },
    required: ["symbol"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_MARKET_DATA"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("market.snapshot") },
  executionMode: "sync",
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["market_data"],
    provenanceProducer: "market-data-service",
  },
  status: "active",
  wraps: "services/market-data/shared-instance.ts (MarketDataService.getSnapshot)",
};

function parseInput(raw: unknown): ToolInputParseResult<MarketSnapshotInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const symbol = raw.symbol;
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    return { ok: false, violations: [{ path: "symbol", message: "symbol is required (non-empty string)." }] };
  }
  return { ok: true, value: { symbol: symbol.trim().toUpperCase() } };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (typeof value.price !== "number") return contractResult([{ path: "price", message: "output.price must be a number." }]);
  if (typeof value.provider !== "string") return contractResult([{ path: "provider", message: "output.provider must be a string." }]);
  if (typeof value.timestamp !== "string") return contractResult([{ path: "timestamp", message: "output.timestamp must be a string." }]);
  return contractOk();
}

function toEvidence(snapshot: MarketSnapshot): AgentEvidenceDraft[] {
  const cached = snapshot.cached === true;
  return [
    {
      type: "market_data",
      claim: `${snapshot.symbol} last ${snapshot.price} ${snapshot.quoteCurrency} (${snapshot.provider}${cached ? ", cached" : ", live"})`,
      source: snapshot.provider,
      sourceId: snapshot.symbol,
      timestamp: snapshot.timestamp,
      data: snapshot,
      relevance: 1,
      confidence: cached ? 0.85 : 0.97,
      provenance: {
        producer: "market-data-service",
        retrievedAt: snapshot.retrievedAt,
        freshness: cached ? "cached" : "live",
        reliability: snapshot.fallbackUsed ? "fallback" : "primary",
      },
    },
  ];
}

export const marketSnapshotTool: ToolImplementation<MarketSnapshotInput, MarketSnapshot> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    const snapshot = await marketData.getSnapshot({ symbol: input.symbol });
    return { output: snapshot, evidence: toEvidence(snapshot) };
  },
};
