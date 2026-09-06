// services/agent-framework/runtime/planner.ts
// AT24 Agent Framework - A4. A MINIMAL, deterministic planner.
//
// LOCKED (AN1.2 - "Planner != Executor"): the planner decides WHAT should
// happen next. It emits PlannerToolRequest INTENTS only - it holds no
// handler, performs no I/O, and never invokes application code. Every intent
// still passes authorization + the ToolGateway before anything runs.
//
// A4 SCOPE: this planner is deliberately small - it walks the agent's bound
// tools in order and shapes the run input for each. The real, LLM-assisted /
// supervisor-coordinated planner is A5. This one exists to prove the runtime
// substrate, not to be clever.

import type { AgentDefinition, PlannerToolRequest } from "@/types/agent-framework";
import { isRecord } from "../tools/tool-implementation";

/** Per-tool input shaping for the A4 minimal planner. A real planner (A5)
 *  selects arguments properly; this map only covers the shapes the 4 A2
 *  READY tools need. */
function shapeInput(toolId: string, runInput: unknown): unknown {
  switch (toolId) {
    case "portfolio.read":
      return {};
    case "market.snapshot":
    case "market.intelligence":
      // both want { symbol, ... } - pass the run input through (their
      // hand-written parseInput reads only what they need).
      return isRecord(runInput) ? runInput : {};
    case "backtest.run":
      return isRecord(runInput) ? runInput : {};
    default:
      return runInput;
  }
}

export interface PlanResult {
  requests: PlannerToolRequest[];
  /** Human-readable note about how the plan was derived (for the plan step). */
  rationale: string;
}

/**
 * Produce an ordered plan from an agent definition + a run goal. Pure and
 * deterministic: identical inputs always yield an identical plan.
 */
export function planRun(definition: AgentDefinition, runInput: unknown): PlanResult {
  const requests: PlannerToolRequest[] = definition.tools.map((binding) => ({
    toolId: binding.toolId,
    input: shapeInput(binding.toolId, runInput),
    rationale: `agent "${definition.slug}" (${definition.type}) is bound to "${binding.toolId}"; invoke it against the run goal`,
  }));

  return {
    requests,
    rationale:
      requests.length === 0
        ? "agent has no bound tools; plan is a single synthesis step"
        : `walk ${requests.length} bound tool(s) in binding order, then synthesise an evidence-backed output`,
  };
}
