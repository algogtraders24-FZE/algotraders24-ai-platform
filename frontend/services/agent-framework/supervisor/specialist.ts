// services/agent-framework/supervisor/specialist.ts
// AT24 Agent Framework - A5. A Specialist is a SPECIALIZED PLANNING /
// REASONING ROLE - not a separate runtime engine.
//
// LOCKED (owner G04): "Don't build eight independent agent runtimes. Use the
// supervisor pattern." Every specialist shares the SAME Agent Runtime, Tool
// Registry, governance, evidence model, memory infra and credit system. A
// specialist only decides: given this agent + goal, which bound tools in
// which order, and how to synthesise the persisted trace into a conclusion.

import type { AgentDefinition, PlannerToolRequest } from "@/types/agent-framework";
import type { AgentType } from "../agent-type-registry";
import type { ParsedGoal } from "./goal";
import type { RunTrace, RunSynthesis } from "./run-planner";

export interface SpecialistPlan {
  requests: PlannerToolRequest[];
  rationale: string;
}

export interface Specialist {
  /** The agent type this specialist plans for; "generic" is the fallback. */
  readonly key: AgentType | "generic";

  /**
   * Produce an ordered plan using ONLY tools the agent is bound to
   * (`boundToolIds`). Deterministic - identical (definition, goal) always
   * yields an identical plan. NO LLM here (the supervisor layers LLM-assist
   * on top, with validation).
   */
  planTools(definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan;

  /**
   * Turn the completed, persisted trace into a structured conclusion.
   * Reads only what the run actually produced (tool call outputs +
   * evidence). Deterministic, NO LLM, NO new market calculation.
   */
  synthesize(trace: RunTrace, definition: AgentDefinition, goal: ParsedGoal): RunSynthesis;
}
