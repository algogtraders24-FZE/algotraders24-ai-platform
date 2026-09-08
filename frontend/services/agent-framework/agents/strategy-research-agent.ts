// services/agent-framework/agents/strategy-research-agent.ts
// AT24 Agent Framework - A13. The Strategy Research Agent.
//
// LOCKED (owner G12): the FINAL real specialist. It must clearly distinguish
// hypothesis / backtest result / evidence / conclusion / (a withheld)
// trading recommendation. A positive backtest is NOT silently promoted to a
// BUY/SELL, entry, stop, target, size, execution instruction, or
// probability-of-profit claim. A backtest can support a research conclusion
// without proving a strategy should be traded live.
//
// LOCKED: reuse the EXISTING backtest.run (-> algoTestService ->
// at24-quant-engine) + market.intelligence + AgentRuntime + A6/A8/A9/A10.
// NO second backtest engine, NO second strategy engine, NO execution engine.
//
// This file is a canonical AgentDefinition + a thin entrypoint. The
// hypothesis/result/context/conclusion separation lives in
// supervisor/specialists/strategy-research.specialist.ts.

import {
  type AgentDefinition,
  makeDefaultAgentDefinitionBase,
} from "@/types/agent-framework";
import { AGENT_TYPE_REGISTRY } from "../agent-type-registry";
import { AgentRuntime, agentRuntime } from "../runtime/agent-runtime";
import type { AgentRunRow } from "../runtime/agent-run.repository";

/** The tools the Strategy Research Agent is bound to. A subset of the
 *  STRATEGY_RESEARCH type's seed list - `strategy.library_lookup` and
 *  `risk.evaluate` are omitted (not registered; adapters ship with their
 *  own consuming agent later). */
export const STRATEGY_RESEARCH_AGENT_TOOL_IDS = ["backtest.run", "market.intelligence"] as const;

export interface StrategyResearchAgentOptions {
  id?: string;
  slug?: string;
  version?: string;
  objective?: string;
  instructions?: string;
}

/** Build the canonical Strategy Research Agent definition. Pure - passes
 *  `validateAgentDefinition` against the STRATEGY_RESEARCH registry entry
 *  (autonomy cap 1, permission seeds CAN_READ_MARKET_DATA / CAN_RUN_RESEARCH
 *  / CAN_RUN_BACKTEST / CAN_USE_MEMORY). */
export function strategyResearchAgentDefinition(
  opts: StrategyResearchAgentOptions = {},
): AgentDefinition {
  const now = new Date().toISOString();
  const spec = AGENT_TYPE_REGISTRY.STRATEGY_RESEARCH;
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: opts.id ?? "agt_strategy_research_canonical",
    slug: opts.slug ?? "strategy-research-agent",
    version: opts.version ?? "1.0.0",
    name: spec.label,
    description:
      "Investigates a strategy hypothesis by running one real historical backtest against the canonical " +
      "quant engine and attaching current-regime context. Returns a brief that keeps hypothesis, backtest " +
      "result, evidence and research conclusion separate - it never issues a trading recommendation.",
    type: "STRATEGY_RESEARCH",
    status: "active",
    objective:
      opts.objective ??
      "Given a strategy hypothesis, run a historical backtest, gather regime context, and produce an " +
        "evidence-backed research conclusion that is explicitly not a trade recommendation.",
    instructions:
      opts.instructions ??
      "Plan within the two bound tools only. Keep hypothesis, backtest result and conclusion separate. A " +
        "positive backtest is research evidence, not proof and not a recommendation - never emit an entry, " +
        "stop, target, position size, side or probability of profit.",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: STRATEGY_RESEARCH_AGENT_TOOL_IDS.map((toolId) => ({ toolId })),
    permissionPolicy: { granted: [...spec.defaultPermissions] },
    autonomyLevel: 1,
    outputSchema: {
      type: "object",
      required: ["kind", "hypothesis", "backtestResult", "conclusion", "resolved", "evidenceIds", "disclaimer"],
      properties: {
        kind: { type: "string", enum: ["strategy-research-brief"] },
        hypothesis: { type: "string" },
        backtestResult: { type: "object" },
        marketContext: { type: "object" },
        conclusion: { type: "string" },
        supportsFurtherResearch: { type: ["boolean", "null"] },
        resolved: { type: "boolean" },
        notATradeRecommendation: { type: "boolean", enum: [true] },
        sources: { type: "array" },
        citedEvidenceCount: { type: "integer", minimum: 0 },
        evidenceGathered: { type: "integer", minimum: 0 },
        evidenceIds: { type: "array" },
        disclaimer: { type: "string" },
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface RunStrategyResearchAgentInput {
  userId: string;
  /** `{ strategyId?, symbol?, timeframe?, startTime?, endTime?, initialBalance?, question? }`
   *  or a natural-language string. Unspecified fields default to the
   *  backtest tool's supported scope (golden / XAUUSD / 5m / last 13 days). */
  goal:
    | string
    | {
        question?: string;
        strategyId?: string;
        symbol?: string;
        timeframe?: string;
        startTime?: string;
        endTime?: string;
        initialBalance?: number;
      };
  runtime?: AgentRuntime;
  definitionOverrides?: StrategyResearchAgentOptions;
}

/** Start + drive a Strategy Research Agent run to completion on the shared runtime. */
export async function runStrategyResearchAgent(
  input: RunStrategyResearchAgentInput,
): Promise<AgentRunRow> {
  const runtime = input.runtime ?? agentRuntime;
  const { runId } = await runtime.startRun({
    definition: strategyResearchAgentDefinition(input.definitionOverrides),
    input: input.goal,
    userId: input.userId,
    trigger: "manual",
  });
  return runtime.runToCompletion(runId);
}
