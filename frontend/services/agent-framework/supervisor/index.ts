// services/agent-framework/supervisor/index.ts
// AT24 Agent Framework - A5 supervisor. Server-only barrel.

export { SupervisorService, supervisor } from "./supervisor";
export type { SupervisorDeps } from "./supervisor";
export type { RunPlanner, RunPlan, RunSynthesis, RunPlanContext, RunTrace } from "./run-planner";
export { parseGoal } from "./goal";
export type { ParsedGoal } from "./goal";
export { selectSpecialist, genericSpecialist } from "./specialist-registry";
export { marketIntelligenceSpecialist } from "./specialists/market-intelligence.specialist";
export { researchSpecialist } from "./specialists/research.specialist";
export { strategyResearchSpecialist } from "./specialists/strategy-research.specialist";
export type { Specialist, SpecialistPlan } from "./specialist";
export { shapeGoalForTool } from "./plan-shaping";
export {
  type PlanProposer,
  type ProposedPlan,
  LlmPlanProposer,
  validateProposedPlan,
  parseProposedPlan,
  llmPlanningEnabled,
} from "./plan-proposer";
