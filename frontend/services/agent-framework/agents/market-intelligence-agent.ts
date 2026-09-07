// services/agent-framework/agents/market-intelligence-agent.ts
// AT24 Agent Framework - A12. The Market Intelligence Agent.
//
// LOCKED (owner G11): "The three agents are SPECIALISATIONS of the one
// runtime - add agent definitions + bounded plans + tool bindings + domain
// synthesis, NOT new infrastructure." This file is a canonical
// AgentDefinition + a thin entrypoint. NOTHING else.
//
// LOCKED (owner G11): A12 must NOT rebuild the intelligence pipeline, add a
// second regime/signal engine, compute a second intelligence score, or turn
// market intelligence into BUY/SELL recommendations. The EXISTING
// `market.intelligence` tool (A2 -> RealTimeIntelligenceService ->
// MarketIntelligencePipelineService, deterministic, no LLM) is the
// authority. The agent ORCHESTRATES and EXPLAINS the recorded intelligence.
//
// The planning + synthesis specialisation already exists:
//   services/agent-framework/supervisor/specialists/market-intelligence.specialist.ts
// (built at A5). It orders market.snapshot -> market.intelligence and
// projects the pipeline's OWN regime + hypotheses into a bullish/bearish/
// neutral LEAN - never an entry/stop/target/size/probability.

import {
  type AgentDefinition,
  makeDefaultAgentDefinitionBase,
} from "@/types/agent-framework";
import { AGENT_TYPE_REGISTRY } from "../agent-type-registry";
import { AgentRuntime, agentRuntime } from "../runtime/agent-runtime";
import type { AgentRunRow } from "../runtime/agent-run.repository";

/** The tools the Market Intelligence Agent is bound to. A subset of the
 *  MARKET_INTELLIGENCE type's seed list - `indicators.compute` and
 *  `news.search` are omitted (the conclusion is a faithful relay of the
 *  deterministic pipeline; the two bound tools are all it needs). */
export const MARKET_INTELLIGENCE_AGENT_TOOL_IDS = ["market.snapshot", "market.intelligence"] as const;

export interface MarketIntelligenceAgentOptions {
  id?: string;
  slug?: string;
  version?: string;
  objective?: string;
  instructions?: string;
}

/** Build the canonical Market Intelligence Agent definition. Pure - passes
 *  `validateAgentDefinition` against the MARKET_INTELLIGENCE registry entry
 *  (autonomy cap 1, permission seeds CAN_READ_MARKET_DATA / CAN_READ_NEWS /
 *  CAN_USE_MEMORY). */
export function marketIntelligenceAgentDefinition(
  opts: MarketIntelligenceAgentOptions = {},
): AgentDefinition {
  const now = new Date().toISOString();
  const spec = AGENT_TYPE_REGISTRY.MARKET_INTELLIGENCE;
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: opts.id ?? "agt_market_intelligence_canonical",
    slug: opts.slug ?? "market-intelligence-agent",
    version: opts.version ?? "1.0.0",
    name: spec.label,
    description:
      "Orchestrates the platform's deterministic real-time intelligence pipeline for an instrument and " +
      "explains its recorded regime, hypotheses and confidence as a bullish / bearish / neutral lean. " +
      "Decision support only - never an entry, stop, target, position size or trade signal.",
    type: "MARKET_INTELLIGENCE",
    status: "active",
    objective:
      opts.objective ??
      "Given an instrument, run the deterministic intelligence pipeline and produce an evidence-backed " +
        "decision-support conclusion about the current regime lean.",
    instructions:
      opts.instructions ??
      "Plan within the two bound tools only. Relay the pipeline's own classification faithfully - never " +
        "compute a second regime or score, never emit a trade instruction. Always carry the decision-support disclaimer.",
    modelPolicy: { preferred: "m", fallback: [], allowed: ["m"] },
    tools: MARKET_INTELLIGENCE_AGENT_TOOL_IDS.map((toolId) => ({ toolId })),
    permissionPolicy: { granted: [...spec.defaultPermissions] },
    autonomyLevel: 1,
    outputSchema: {
      type: "object",
      required: ["kind", "bias", "resolved", "evidenceIds", "disclaimer"],
      properties: {
        kind: { type: "string", enum: ["market-intelligence-conclusion"] },
        symbol: { type: ["string", "null"] },
        timeframe: { type: ["string", "null"] },
        bias: { type: "string", enum: ["bullish-leaning", "bearish-leaning", "neutral"] },
        resolved: { type: "boolean" },
        regimeType: { type: "string" },
        regimeConfidence: { type: ["number", "null"] },
        hypothesisCount: { type: "integer", minimum: 0 },
        pipelineVersion: { type: ["string", "null"] },
        reason: { type: "string" },
        basis: { type: "array" },
        evidenceCount: { type: "integer", minimum: 0 },
        evidenceIds: { type: "array" },
        disclaimer: { type: "string" },
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface RunMarketIntelligenceAgentInput {
  userId: string;
  /** `{ symbol, timeframe?, question? }` or a natural-language string. */
  goal: string | { question?: string; symbol: string; timeframe?: string };
  runtime?: AgentRuntime;
  definitionOverrides?: MarketIntelligenceAgentOptions;
}

/** Start + drive a Market Intelligence Agent run to completion on the shared runtime. */
export async function runMarketIntelligenceAgent(
  input: RunMarketIntelligenceAgentInput,
): Promise<AgentRunRow> {
  const runtime = input.runtime ?? agentRuntime;
  const { runId } = await runtime.startRun({
    definition: marketIntelligenceAgentDefinition(input.definitionOverrides),
    input: input.goal,
    userId: input.userId,
    trigger: "manual",
  });
  return runtime.runToCompletion(runId);
}
