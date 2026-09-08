// services/agent-framework/runtime/index.ts
// AT24 Agent Framework - A4 runtime. Server-only barrel.

export { AgentRuntime, agentRuntime } from "./agent-runtime";
export type { StartRunInput } from "./agent-runtime";
export { agentRunRepository } from "./agent-run.repository";
export type { AgentRunRow } from "./agent-run.repository";
export { RunTracer } from "./run-tracer";
export { checkLimits, validateRunLimits } from "./limit-enforcer";
export type { LimitDecision, LimitCheckContext } from "./limit-enforcer";
export { planRun } from "./planner";
export type { PlanResult } from "./planner";
// A8: authorization is now the central AuthorizationService.
export { authorizationService, AuthorizationService } from "../authorization/authorization-service";
export type { AuthorizationDecision, AuthorizationInput } from "../authorization/authorization-service";
