// services/agent-framework/tools/impl/market-intelligence.tool.ts
// AT24 Agent Framework - A2. Tool: market.intelligence
// Wraps the EXISTING deterministic orchestrator
// RealTimeIntelligenceService (services/intelligence/orchestration/
// real-time-intelligence.service.ts) - the production D2.6.5 path. NO LLM.
// NOT a second intelligence implementation - it calls the one that exists.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";
import {
  RealTimeIntelligenceService,
  type RealTimeIntelligenceRequest,
} from "@/services/intelligence/orchestration/real-time-intelligence.service";
import type { VerifiedRealTimeIntelligenceContext } from "@/types/real-time-intelligence";

interface MarketIntelligenceInput {
  symbol: string;
  timeframe?: string;
  question?: string;
}

const VALID_STATUSES = new Set(["resolved", "clarification-required", "insufficient-data"]);

const definition: ToolDefinition = {
  id: "market.intelligence",
  name: "Market Intelligence",
  description:
    "Runs AT24's deterministic real-time intelligence pipeline (market state, regime, hypotheses, evidence, risk, confidence, intelligence score) for one instrument. Zero LLM content.",
  version: "1.0.0",
  category: "MARKET_DATA",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      symbol: { type: "string", minLength: 1 },
      timeframe: { type: "string" },
      question: { type: "string", maxLength: 500 },
    },
    required: ["symbol"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_MARKET_DATA"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("market.intelligence") },
  executionMode: "sync",
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["market_data", "regime", "news", "derived"],
    provenanceProducer: "intelligence-pipeline",
  },
  status: "active",
  wraps: "services/intelligence/orchestration/real-time-intelligence.service.ts (RealTimeIntelligenceService.build)",
};

function parseInput(raw: unknown): ToolInputParseResult<MarketIntelligenceInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const symbol = raw.symbol;
  if (typeof symbol !== "string" || symbol.trim().length === 0) {
    return { ok: false, violations: [{ path: "symbol", message: "symbol is required (non-empty string)." }] };
  }
  if (raw.timeframe !== undefined && typeof raw.timeframe !== "string") {
    return { ok: false, violations: [{ path: "timeframe", message: "timeframe must be a string when provided." }] };
  }
  if (raw.question !== undefined && (typeof raw.question !== "string" || raw.question.length > 500)) {
    return { ok: false, violations: [{ path: "question", message: "question must be a string <= 500 chars." }] };
  }
  return {
    ok: true,
    value: {
      symbol: symbol.trim().toUpperCase(),
      timeframe: typeof raw.timeframe === "string" ? raw.timeframe : undefined,
      question: typeof raw.question === "string" ? raw.question : undefined,
    },
  };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (typeof value.status !== "string" || !VALID_STATUSES.has(value.status)) {
    return contractResult([{ path: "status", message: `output.status must be one of ${[...VALID_STATUSES].join(", ")}.` }]);
  }
  if (!isRecord(value.query)) return contractResult([{ path: "query", message: "output.query must be present." }]);
  if (typeof value.generatedAt !== "string") return contractResult([{ path: "generatedAt", message: "output.generatedAt must be a string." }]);
  return contractOk();
}

/** Real evidence, drawn ONLY from the deterministic envelope - never
 *  fabricated. An unresolved context yields zero evidence (an honest
 *  absence), exactly like the pipeline itself. */
function toEvidence(ctx: VerifiedRealTimeIntelligenceContext): AgentEvidenceDraft[] {
  const drafts: AgentEvidenceDraft[] = [];
  const envelope = ctx.envelope;
  if (!envelope) return drafts;

  const retrievedAt = ctx.generatedAt;
  const producer = "intelligence-pipeline";
  const pipelineVersion = envelope.pipelineVersion;

  if (envelope.regime) {
    drafts.push({
      type: "regime",
      claim: `${envelope.symbol} regime: ${envelope.regime.regimeType}`,
      source: "intelligence-envelope",
      sourceId: `${envelope.symbol}:regime`,
      timestamp: envelope.generatedAt,
      data: envelope.regime,
      relevance: 1,
      // Regime.confidence is 0-100; normalise to the evidence draft's [0,1].
      confidence: Math.max(0, Math.min(1, envelope.regime.confidence / 100)),
      provenance: { producer, retrievedAt, pipelineVersion },
    });
  }

  for (const item of envelope.evidence?.items ?? []) {
    drafts.push({
      type: item.type === "news" ? "news" : "market_data",
      claim: item.claim,
      source: item.source,
      sourceId: `${envelope.symbol}:${item.type}`,
      timestamp: item.asOf ?? envelope.generatedAt,
      data: item,
      relevance: 0.9,
      confidence: 0.85,
      provenance: { producer, retrievedAt, pipelineVersion },
    });
  }

  return drafts;
}

export const marketIntelligenceTool: ToolImplementation<MarketIntelligenceInput, VerifiedRealTimeIntelligenceContext> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input, ctx) {
    const service = new RealTimeIntelligenceService();
    const request: RealTimeIntelligenceRequest = {
      requestId: globalThis.crypto.randomUUID(),
      userId: ctx.userId,
      question: input.question ?? `What is the current market intelligence picture for ${input.symbol}?`,
      symbol: input.symbol,
      timeframe: input.timeframe as RealTimeIntelligenceRequest["timeframe"],
      requestedAt: new Date().toISOString(),
    };
    const result = await service.build(request);
    return { output: result, evidence: toEvidence(result) };
  },
};
