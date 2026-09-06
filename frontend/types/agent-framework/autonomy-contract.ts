// types/agent-framework/autonomy-contract.ts
// AT24 Agent Framework - Autonomy Level contract (A1).
//
// Autonomy is a hard ceiling on what an agent is ALLOWED to do, independent
// of what tools it holds or what permissions it was granted. The tool gate
// (A2) checks all three: permission grant AND autonomy floor AND credit.
//
// LOCKED (AN1.2 invariant 4): default level is 0; Trading Decision Agent is
// capped at L1 in v1; L3/L4 are contract-only this sprint (no execution
// wiring); L2 maps to the existing paper-trading service.

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [0, 1, 2, 3, 4] as const;

export const AUTONOMY_LABELS: Readonly<Record<AutonomyLevel, string>> = {
  0: "ANALYSIS_ONLY",
  1: "RECOMMENDATION",
  2: "PAPER_EXECUTION",
  3: "USER_APPROVED_ACTION",
  4: "BOUNDED_AUTONOMOUS_ACTION",
} as const;

export const AUTONOMY_DESCRIPTIONS: Readonly<Record<AutonomyLevel, string>> = {
  0: "Produces analysis only. Never proposes or takes an action.",
  1: "May produce a recommendation / decision-support output. Takes no action.",
  2: "May execute against the isolated paper-trading simulation only (no real funds).",
  3: "May prepare a real action that a human must explicitly approve before it runs.",
  4: "May take a bounded real action autonomously within pre-approved limits.",
} as const;

/** The default for every newly created agent (AN1.2 invariant 4). */
export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 0;

/** v1 hard cap for the Trading Decision agent type - decision-support only. */
export const TRADING_DECISION_MAX_AUTONOMY_V1: AutonomyLevel = 1;

/** A tool that can create or execute a live order must sit at or above this
 *  level. In v1 no such tool is enabled, so this is a guard for later. */
export const LIVE_EXECUTION_MIN_AUTONOMY: AutonomyLevel = 3;

/** The highest autonomy level any agent may be configured at in this sprint.
 *  L3/L4 are contract-only until their approval + execution gateways exist. */
export const MAX_CONFIGURABLE_AUTONOMY_V1: AutonomyLevel = 2;

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/** Pure predicate: may a tool whose floor is `toolAutonomyFloor` be invoked
 *  by an agent operating at `agentLevel`? Deterministic, no side effects. */
export function canRunAtAutonomy(agentLevel: AutonomyLevel, toolAutonomyFloor: AutonomyLevel): boolean {
  return agentLevel >= toolAutonomyFloor;
}
