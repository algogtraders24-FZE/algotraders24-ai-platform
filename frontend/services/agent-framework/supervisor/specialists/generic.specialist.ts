// services/agent-framework/supervisor/specialists/generic.specialist.ts
// AT24 Agent Framework - A5. The fallback specialist: walk the agent's bound
// tools in binding order, synthesise a plain summary. This is the same
// behaviour A4's minimal planner had - it stays available for any agent type
// without a dedicated specialist.

import type { AgentDefinition } from "@/types/agent-framework";
import type { ParsedGoal } from "../goal";
import type { Specialist, SpecialistPlan } from "../specialist";
import type { RunTrace, RunSynthesis } from "../run-planner";
import { shapeGoalForTool } from "../plan-shaping";

export const genericSpecialist: Specialist = {
  key: "generic",

  planTools(definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan {
    const requests = definition.tools
      .filter((b) => boundToolIds.includes(b.toolId))
      .map((b) => ({
        toolId: b.toolId,
        input: shapeGoalForTool(b.toolId, goal),
        rationale: `agent "${definition.slug}" (${definition.type}) is bound to "${b.toolId}"`,
      }));
    return {
      requests,
      rationale: `generic plan: walk ${requests.length} bound tool(s) in binding order`,
    };
  },

  synthesize(trace: RunTrace, definition: AgentDefinition, _goal: ParsedGoal): RunSynthesis {
    const output: Record<string, unknown> = {
      kind: "generic-summary",
      agentType: definition.type,
      toolResults: trace.toolCalls.map((tc) => ({ toolId: tc.toolId, status: tc.status })),
      evidenceCount: trace.evidence.length,
      evidenceIds: trace.evidence.map((e) => e.id),
    };
    return {
      output,
      summary: `agent "${definition.slug}" completed ${trace.toolCalls.length} tool call(s), ${trace.evidence.length} evidence row(s)`,
    };
  },
};
