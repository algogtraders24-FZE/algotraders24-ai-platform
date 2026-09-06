// services/agent-framework/tools/impl/backtest-run.tool.ts
// AT24 Agent Framework - A2. Tool: backtest.run
// Wraps the EXISTING algoTestService (services/algo-test/algo-test.service.ts)
// which itself calls the canonical at24-quant-engine via the already-proven
// P3.2A/P3.2B composition. NOT a second backtest engine.
//
// Narrow surface today (algoTestService's own SS1 scope): strategyId
// "golden", symbol "XAUUSD", timeframe "5m", MAX_RANGE_DAYS 14. Widening is
// additive in that service, not here.

import type { ToolDefinition, AgentEvidenceDraft } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "../tool-implementation";
import { isRecord } from "../tool-implementation";
import { placeholderFlatCost } from "../tool-credit-costs";
import { algoTestService, DEFAULT_INITIAL_BALANCE } from "@/services/algo-test/algo-test.service";
import type { AlgoTestRunRequest, AlgoTestRunView } from "@/types/algo-test";

interface BacktestRunInput {
  strategyId: string;
  symbol: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  initialBalance?: number;
}

const definition: ToolDefinition = {
  id: "backtest.run",
  name: "Backtest Run",
  description:
    "Runs one deterministic historical backtest against the canonical at24-quant-engine (via AT24's Algo Test service) and returns real metrics, trades, equity curve and a reproducibility hash.",
  version: "1.0.0",
  category: "BACKTEST",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      strategyId: { type: "string", minLength: 1 },
      symbol: { type: "string", minLength: 1 },
      timeframe: { type: "string", minLength: 1 },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      initialBalance: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["strategyId", "symbol", "timeframe", "startTime", "endTime"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: ["CAN_RUN_BACKTEST"],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: placeholderFlatCost("backtest.run") },
  executionMode: "sync",
  evidence: {
    producesEvidence: true,
    evidenceTypes: ["backtest"],
    provenanceProducer: "at24-quant-engine",
  },
  status: "active",
  wraps: "services/algo-test/algo-test.service.ts (algoTestService.runAlgoTest) -> at24-quant-engine",
};

function parseInput(raw: unknown): ToolInputParseResult<BacktestRunInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  const str = (k: string) => (typeof raw[k] === "string" && (raw[k] as string).trim().length > 0 ? (raw[k] as string).trim() : null);
  const strategyId = str("strategyId");
  const symbol = str("symbol");
  const timeframe = str("timeframe");
  const startTime = str("startTime");
  const endTime = str("endTime");
  const missing: { path: string; message: string }[] = [];
  if (!strategyId) missing.push({ path: "strategyId", message: "strategyId is required." });
  if (!symbol) missing.push({ path: "symbol", message: "symbol is required." });
  if (!timeframe) missing.push({ path: "timeframe", message: "timeframe is required." });
  if (!startTime || Number.isNaN(Date.parse(startTime))) missing.push({ path: "startTime", message: "startTime must be an ISO-8601 date-time." });
  if (!endTime || Number.isNaN(Date.parse(endTime))) missing.push({ path: "endTime", message: "endTime must be an ISO-8601 date-time." });
  if (raw.initialBalance !== undefined && (typeof raw.initialBalance !== "number" || raw.initialBalance <= 0)) {
    missing.push({ path: "initialBalance", message: "initialBalance must be a positive number when provided." });
  }
  if (missing.length > 0) return { ok: false, violations: missing };
  return {
    ok: true,
    value: {
      strategyId: strategyId!,
      symbol: symbol!,
      timeframe: timeframe!,
      startTime: startTime!,
      endTime: endTime!,
      initialBalance: typeof raw.initialBalance === "number" ? raw.initialBalance : DEFAULT_INITIAL_BALANCE,
    },
  };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (typeof value.testId !== "string") return contractResult([{ path: "testId", message: "output.testId must be a string." }]);
  if (value.status !== "completed" && value.status !== "failed") {
    return contractResult([{ path: "status", message: 'output.status must be "completed" or "failed".' }]);
  }
  return contractOk();
}

function toEvidence(view: AlgoTestRunView): AgentEvidenceDraft[] {
  const now = new Date().toISOString();
  const net = view.metrics?.netProfit;
  return [
    {
      type: "backtest",
      claim:
        view.status === "completed"
          ? `${view.symbol} ${view.strategyId} ${view.timeframe} backtest: net ${net ?? "n/a"}, ${view.trades?.length ?? 0} trades`
          : `${view.symbol} ${view.strategyId} backtest failed`,
      source: "at24-quant-engine",
      sourceId: view.testId,
      timestamp: now,
      data: { status: view.status, metrics: view.metrics, resultHash: view.resultHash, assumptions: view.assumptions },
      relevance: 1,
      confidence: view.status === "completed" ? 0.95 : 0.5,
      provenance: {
        producer: "at24-quant-engine",
        retrievedAt: now,
        datasetId: `${view.symbol}:${view.timeframe}:${view.startTime}..${view.endTime}`,
      },
    },
  ];
}

export const backtestRunTool: ToolImplementation<BacktestRunInput, AlgoTestRunView> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input, ctx) {
    const request: AlgoTestRunRequest = {
      strategyId: input.strategyId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      startTime: input.startTime,
      endTime: input.endTime,
      initialBalance: input.initialBalance,
    };
    const view = await algoTestService.runAlgoTest(ctx.userId, request);
    return { output: view, evidence: toEvidence(view) };
  },
};
