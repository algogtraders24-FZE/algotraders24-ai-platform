// services/mcp/tools/risk-calculator.tool.ts
// AT24 MCP v1 - tool: risk.calculator. Pure math (services/mcp/risk-calculator.ts).
// No permission, no I/O, zero credits.

import type { ToolDefinition } from "@/types/agent-framework";
import { contractOk, contractResult } from "@/types/agent-framework";
import type { ToolImplementation, ToolInputParseResult } from "@/services/agent-framework/tools/tool-implementation";
import { isRecord } from "@/services/agent-framework/tools/tool-implementation";
import { calculateRisk, type RiskCalcInput, type RiskCalcResult } from "../risk-calculator";

const definition: ToolDefinition = {
  id: "risk.calculator",
  name: "Risk Calculator",
  description:
    "Deterministic position-size math from the caller's own inputs: lots for a given risk %, stop distance, and optional reward-to-risk. Planning arithmetic only; not advice, never an order.",
  version: "1.0.0",
  category: "RISK_ENGINE",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      accountBalance: { type: "number", exclusiveMinimum: 0 },
      riskPercent: { type: "number", exclusiveMinimum: 0, maximum: 100 },
      entry: { type: "number", exclusiveMinimum: 0 },
      stopLoss: { type: "number", exclusiveMinimum: 0 },
      takeProfit: { type: "number", exclusiveMinimum: 0 },
      valuePerPricePerLot: { type: "number", exclusiveMinimum: 0 },
      lotStep: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["accountBalance", "riskPercent", "entry", "stopLoss", "valuePerPricePerLot"],
  },
  outputSchema: { type: "object" },
  requiredPermissions: [],
  autonomyFloor: 0,
  creditCost: { model: "flat", credits: 0 },
  executionMode: "sync",
  evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "risk-calculator" },
  status: "active",
  wraps: "services/mcp/risk-calculator.ts (pure)",
};

const KEYS = ["accountBalance", "riskPercent", "entry", "stopLoss", "takeProfit", "valuePerPricePerLot", "lotStep"] as const;

function parseInput(raw: unknown): ToolInputParseResult<RiskCalcInput> {
  if (!isRecord(raw)) return { ok: false, violations: [{ path: "", message: "input must be an object." }] };
  for (const k of Object.keys(raw)) {
    if (!(KEYS as readonly string[]).includes(k)) return { ok: false, violations: [{ path: k, message: "unknown field." }] };
  }
  const out: Record<string, number> = {};
  for (const k of KEYS) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return { ok: false, violations: [{ path: k, message: "must be a finite number." }] };
    out[k] = v;
  }
  const outcome = calculateRisk(out as unknown as RiskCalcInput);
  if (!outcome.ok) return { ok: false, violations: [{ path: "", message: outcome.message }] };
  return { ok: true, value: out as unknown as RiskCalcInput };
}

function checkOutput(value: unknown) {
  if (!isRecord(value)) return contractResult([{ path: "", message: "output must be an object." }]);
  if (typeof value.lots !== "number") return contractResult([{ path: "lots", message: "output.lots must be a number." }]);
  return contractOk();
}

export const riskCalculatorTool: ToolImplementation<RiskCalcInput, RiskCalcResult> = {
  definition,
  parseInput,
  checkOutput,
  async handler(input) {
    const outcome = calculateRisk(input);
    if (!outcome.ok) throw new Error("risk_calc_invalid");
    return { output: outcome.value, evidence: [] };
  },
};
