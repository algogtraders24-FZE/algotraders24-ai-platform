// services/agent-framework/tools/impl/portfolio-read.tool.ts
// AT24 Agent Framework - A2. Tool: portfolio.read
// Wraps the EXISTING PaperTradingService (services/paper-trading/
// paper-trading.service.ts). READ-ONLY: getSummary only. openPosition /
// closePosition are L2 paper-execution and are NOT exposed in v1
// (every agent type is autonomy-capped at 1).

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";
import { PaperTradingService } from "@/services/paper-trading/paper-trading.service";
import type { PaperAccountSummary } from "@/types/paper-trading";

type PortfolioReadInput = Record<string, never>;

const definition: ToolDefinition = {
  id: "portfolio.read",
  name: "Portfolio Read",
  description:
    "Reads the owning user's paper-trading account summary (balance, leverage, used margin, open/pending positions). Read-only - never opens or closes a position.",
  version: "1.0.0",
  category: "PORTFOLIO",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_READ_PORTFOLIO"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("portfolio.read") },
  executionMode: "sync",
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["derived"],
    provenanceProducer: "paper-trading-service",
  },
  status: "active",
  wraps: "services/paper-trading/paper-trading.service.ts (PaperTradingService.getSummary)",
};

function parseInput(raw: unknown): ToolInputParseResult<PortfolioReadInput> {
  if (raw !== undefined && raw !== null && !(isRecord(raw) && Object.keys(raw).length === 0)) {
    return { ok: false, violations: [{ path: "", message: "portfolio.read takes no input." }] };
  }
  return { ok: true, value: {} as PortfolioReadInput };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (typeof value.balance !== "number") return contractResult([{ path: "balance", message: "output.balance must be a number." }]);
  if (!Array.isArray(value.positions)) return contractResult([{ path: "positions", message: "output.positions must be an array." }]);
  return contractOk();
}

function toEvidence(summary: PaperAccountSummary, userId: string): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  return [
    {
      type: "derived",
      claim: `Paper account: balance ${summary.balance}, used margin ${summary.usedMargin}, ${summary.positions.length} position(s), ${summary.leverage}x leverage`,
      source: "paper-trading-service",
      sourceId: `paper-account:${userId}`,
      timestamp: now,
      data: summary,
      relevance: 1,
      confidence: 1,
      provenance: { producer: "paper-trading-service", retrievedAt: now },
    },
  ];
}

export const portfolioReadTool: ToolImplementation<PortfolioReadInput, PaperAccountSummary> = {
  definition,
  parseInput,
  checkOutput,
  async handler(_input, ctx) {
    const service = new PaperTradingService();
    const summary = await service.getSummary(ctx.userId);
    return { output: summary, evidence: toEvidence(summary, ctx.userId) };
  },
};
