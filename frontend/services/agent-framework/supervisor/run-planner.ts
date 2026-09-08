// services/agent-framework/supervisor/run-planner.ts
// AT24 Agent Framework - A5. The interface the A4 runtime consumes for
// planning + output synthesis.
//
// LOCKED (owner G04): tick() stays the execution primitive. The Supervisor
// (the RunPlanner implementation) produces the plan/intent state; A4's
// tick() authorizes + executes it, one bounded slice at a time. The planner
// NEVER executes a tool and NEVER gains tool authority - it emits
// PlannerToolRequest intents only.

import type { AgentDefinition, PlannerToolRequest } from "@/types/agent-framework";
import type { agentRunRepository } from "../runtime/agent-run.repository";

export type RunTrace = Awaited<ReturnType<typeof agentRunRepository.getRunTrace>>;

export interface RunPlanContext {
  userId: string;
  runId: string;
}

export interface RunPlan {
  /** Ordered tool intents. A4 executes them one per tick(). */
  requests: PlannerToolRequest[];
  /** Human-readable note on how the plan was derived (goes on the plan step). */
  rationale: string;
  /** Non-authoritative context for the trace, e.g.
   *  { specialist, planningPath: "deterministic" | "llm-assisted" }. */
  planMetadata?: Record<string, unknown>;
}

export interface RunSynthesis {
  /** The run's final structured output (persisted to AgentRun.output). */
  output: Record<string, unknown>;
  summary: string;
}

export interface RunPlanner {
  /** Turn a goal into an ordered, bounded plan of tool intents. */
  plan(definition: AgentDefinition, input: unknown, ctx: RunPlanContext): Promise<RunPlan>;
  /** Turn the completed, persisted trace into a structured conclusion.
   *  Deterministic - reads only what the run actually produced. */
  synthesizeOutput(trace: RunTrace, definition: AgentDefinition): Promise<RunSynthesis>;
}
