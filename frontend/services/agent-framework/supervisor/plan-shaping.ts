// services/agent-framework/supervisor/plan-shaping.ts
// AT24 Agent Framework - A5. Deterministic per-tool input shaping for the
// planners. A specialist knows which bound tool to call; this maps the
// parsed goal into that tool's expected input shape.
//
// The 4 A2 READY tools only. A real planner (later) may select arguments
// more richly; this is the honest minimal mapping.

import type { ParsedGoal } from "./goal";
import { isRecord } from "../tools/tool-implementation";

export function shapeGoalForTool(toolId: string, goal: ParsedGoal): unknown {
  switch (toolId) {
    case "portfolio.read":
      return {};
    case "market.snapshot":
      return goal.symbol ? { symbol: goal.symbol } : passthroughObject(goal.raw);
    case "market.intelligence":
      return {
        ...(goal.symbol ? { symbol: goal.symbol } : passthroughObject(goal.raw)),
        ...(goal.timeframe ? { timeframe: goal.timeframe } : {}),
        ...(goal.question ? { question: goal.question.slice(0, 500) } : {}),
      };
    case "backtest.run":
      return passthroughObject(goal.raw);
    default:
      return goal.raw;
  }
}

function passthroughObject(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}
