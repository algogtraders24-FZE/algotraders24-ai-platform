// services/agent-framework/api/agent-run-service.ts
// AT24 Agent Framework - A15. The API-facing orchestration seam for
// /dashboard/agents.
//
// LOCKED (owner G14):
//  - This module NEVER reimplements the runtime, planner, authorization,
//    credit or integrity logic. It selects a canonical AgentDefinition for
//    a requested agent type and DELEGATES to the shared `agentRuntime`
//    (startRun / tick) + the ownership-scoped observability read model.
//  - `userId` is ALWAYS supplied by the caller from the server session -
//    never from a request body. Every run read/advance is ownership-checked
//    (getRunForUser / getRunObservability({ requesterId })).
//  - Execution stays bounded + resumable: startRun creates a queued run and
//    returns; each `advance` drives ONE `tick()` (one persisted slice) and
//    returns. No route ever runs a whole agent to completion in one request.

import type { AgentType } from "../agent-type-registry";
import { AGENT_TYPE_REGISTRY, isRegisteredAgentType } from "../agent-type-registry";
import { agentRuntime } from "../runtime/agent-runtime";
import { agentRunRepository } from "../runtime/agent-run.repository";
import { isTerminalRunStatus } from "@/types/agent-framework";
import { getRunObservability, type RunObservability } from "../evaluation/observability";
import { researchAgentDefinition } from "../agents/research-agent";
import { marketIntelligenceAgentDefinition } from "../agents/market-intelligence-agent";
import { strategyResearchAgentDefinition } from "../agents/strategy-research-agent";
import type { AgentDefinition } from "@/types/agent-framework";

/** The agent types that have a real, callable canonical definition today
 *  (A11-A13). The other AGENT_TYPE_REGISTRY entries are declared but have no
 *  specialist/definition yet - they are not startable through this API. */
export const RUNNABLE_AGENT_TYPES = ["RESEARCH", "MARKET_INTELLIGENCE", "STRATEGY_RESEARCH"] as const;
export type RunnableAgentType = (typeof RUNNABLE_AGENT_TYPES)[number];

const DEFINITION_FACTORIES: Record<RunnableAgentType, () => AgentDefinition> = {
  RESEARCH: () => researchAgentDefinition(),
  MARKET_INTELLIGENCE: () => marketIntelligenceAgentDefinition(),
  STRATEGY_RESEARCH: () => strategyResearchAgentDefinition(),
};

export function isRunnableAgentType(value: unknown): value is RunnableAgentType {
  return typeof value === "string" && (RUNNABLE_AGENT_TYPES as readonly string[]).includes(value);
}

export interface AgentTypeInfo {
  type: RunnableAgentType;
  label: string;
  description: string;
  defaultTools: readonly string[];
  autonomyCap: number;
  goalHint: string;
}

const GOAL_HINTS: Record<RunnableAgentType, string> = {
  RESEARCH: 'e.g. { "question": "What does my knowledge base say about gold liquidity?", "symbol": "XAUUSD" }',
  MARKET_INTELLIGENCE: 'e.g. { "symbol": "XAUUSD", "timeframe": "1h" }',
  STRATEGY_RESEARCH: 'e.g. { "strategyId": "golden", "symbol": "XAUUSD", "timeframe": "5m" }',
};

/** The types a user can actually start, with display metadata. Pure read of
 *  the code registry - no DB. */
export function listRunnableAgentTypes(): AgentTypeInfo[] {
  return RUNNABLE_AGENT_TYPES.map((type) => {
    const spec = AGENT_TYPE_REGISTRY[type];
    return {
      type,
      label: spec.label,
      description: spec.description,
      defaultTools: spec.defaultTools,
      autonomyCap: spec.autonomyCap,
      goalHint: GOAL_HINTS[type],
    };
  });
}

export class UnknownAgentTypeError extends Error {
  constructor(type: string) {
    super(
      isRegisteredAgentType(type as AgentType)
        ? `agent type "${type}" is registered but has no runnable definition yet`
        : `unknown agent type "${type}"`,
    );
    this.name = "UnknownAgentTypeError";
  }
}

export interface StartAgentRunInput {
  /** From the server session. Never a request-body value. */
  userId: string;
  agentType: string;
  /** The goal - a string or a plain object; shape is the agent's concern. */
  goal: unknown;
  /** How the run was initiated. Defaults to "manual" (the interactive
   *  /dashboard/agents path). AT24 Automation passes "schedule" for a
   *  scheduled automation run so the AgentRun row records the real origin. */
  trigger?: "manual" | "schedule";
}

/** Create a queued run for `agentType` and return its id. No execution
 *  happens here (startRun persists a `queued` row and returns). */
export async function startAgentRun(input: StartAgentRunInput): Promise<{ runId: string }> {
  if (!isRunnableAgentType(input.agentType)) throw new UnknownAgentTypeError(input.agentType);
  const definition = DEFINITION_FACTORIES[input.agentType]();
  return agentRuntime.startRun({
    definition,
    input: input.goal ?? {},
    userId: input.userId,
    trigger: input.trigger ?? "manual",
  });
}

/** Read credits + evaluation from the SAME instances the shared runtime
 *  wrote with, so the model is internally consistent regardless of the
 *  backing store (Prisma in prod; in-memory under the test escape hatch). */
function observabilityDeps(userId: string) {
  return {
    requesterId: userId,
    creditLedger: agentRuntime.creditLedger,
    evaluation: agentRuntime.evaluation,
  };
}

/** The ownership-scoped observability model for one run, or null if the run
 *  does not exist OR does not belong to `userId`. */
export async function getAgentRun(userId: string, runId: string): Promise<RunObservability | null> {
  return getRunObservability(runId, observabilityDeps(userId));
}

export interface AdvanceResult {
  observability: RunObservability;
  terminal: boolean;
  /** true when this call actually executed a slice (vs. the run was already terminal). */
  advanced: boolean;
}

/** Drive ONE bounded slice of the run (one `tick()`), then return the
 *  ownership-scoped observability model. A no-op (advanced:false) if the run
 *  is already terminal. Returns null if the run is not the caller's. */
export async function advanceAgentRun(userId: string, runId: string): Promise<AdvanceResult | null> {
  const owned = await agentRunRepository.getRunForUser(runId, userId);
  if (!owned) return null;

  let advanced = false;
  if (!isTerminalRunStatus(owned.status)) {
    await agentRuntime.tick(runId); // exactly one persisted slice
    advanced = true;
  }

  const observability = await getRunObservability(runId, observabilityDeps(userId));
  if (!observability) return null; // deleted between the check and the read - treat as gone
  return { observability, terminal: isTerminalRunStatus(observability.run!.status), advanced };
}

export interface AgentRunListItem {
  runId: string;
  agentId: string;
  agentType: string | null;
  status: string;
  trigger: string;
  createdAt: string;
  completedAt: string | null;
  creditsConsumed: number;
  errorCode: string | null;
}

/** The authenticated user's own runs, newest first. */
export async function listAgentRuns(userId: string, limit = 50): Promise<AgentRunListItem[]> {
  const rows = await agentRunRepository.listRunsForUser(userId, limit);
  return rows.map((r) => {
    const md = (r.metadata ?? {}) as { definition?: { type?: string } };
    return {
      runId: r.id,
      agentId: r.agentId,
      agentType: md.definition?.type ?? null,
      status: r.status,
      trigger: r.trigger,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      creditsConsumed: r.creditsConsumed,
      errorCode: r.errorCode ?? null,
    };
  });
}
