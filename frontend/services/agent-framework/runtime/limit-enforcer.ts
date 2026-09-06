// services/agent-framework/runtime/limit-enforcer.ts
// AT24 Agent Framework - A4. Enforces the AF-v1 AgentRunLimits BEFORE an
// operation crosses into the tool executor.
//
// LOCKED: limits are read from the RUN's snapshot (AgentRun.limits, taken at
// creation), never from the live agent policy - a mid-run policy edit cannot
// change a running run's ceilings.
//
// Pure: no I/O. The runtime passes in the current counts; this module only
// decides. Each breach maps to exactly one terminal AgentRunStatus
// (AF-v1 LIMIT_BREACH_STATUS).

import {
  type AgentRunLimits,
  type AgentRunStatus,
  LIMIT_BREACH_STATUS,
  validateRunLimits,
} from "@/types/agent-framework";

export interface LimitCheckContext {
  limits: AgentRunLimits;
  /** steps already persisted for this run. */
  stepCount: number;
  /** tool calls already persisted for this run. */
  toolCallCount: number;
  /** ms elapsed since run.startedAt (0 if not started). */
  elapsedMs: number;
  /** credits already consumed by this run. */
  creditsConsumed: number;
  /** retries already used (from resumeState). */
  retriesUsed: number;
}

export type LimitBreach = {
  breached: true;
  /** which limit. */
  limit: keyof AgentRunLimits;
  /** the terminal status the run must move to. */
  status: AgentRunStatus;
  message: string;
};
export type LimitOk = { breached: false };
export type LimitDecision = LimitBreach | LimitOk;

const OK: LimitOk = { breached: false };

function breach(limit: keyof AgentRunLimits, message: string): LimitBreach {
  return { breached: true, limit, status: LIMIT_BREACH_STATUS[limit], message };
}

/**
 * Check every ceiling that a NEXT action (a step or a tool call) would cross.
 * `nextCreditEstimate` is the pre-flight cost of the tool about to run - the
 * credit check happens BEFORE the executor is entered (owner's A4 rule).
 */
export function checkLimits(ctx: LimitCheckContext, nextCreditEstimate = 0): LimitDecision {
  const L = ctx.limits;

  if (ctx.elapsedMs > L.maxRuntimeMs) {
    return breach("maxRuntimeMs", `run exceeded maxRuntimeMs (${ctx.elapsedMs} > ${L.maxRuntimeMs})`);
  }
  if (ctx.stepCount >= L.maxSteps) {
    return breach("maxSteps", `run reached maxSteps (${ctx.stepCount} >= ${L.maxSteps})`);
  }
  if (ctx.toolCallCount >= L.maxToolCalls) {
    return breach("maxToolCalls", `run reached maxToolCalls (${ctx.toolCallCount} >= ${L.maxToolCalls})`);
  }
  if (ctx.creditsConsumed + nextCreditEstimate > L.maxCreditCost) {
    return breach(
      "maxCreditCost",
      `next action would exceed maxCreditCost (${ctx.creditsConsumed} + ${nextCreditEstimate} > ${L.maxCreditCost})`,
    );
  }
  if (ctx.retriesUsed > L.maxRetries) {
    return breach("maxRetries", `run exceeded maxRetries (${ctx.retriesUsed} > ${L.maxRetries})`);
  }
  return OK;
}

/** Guard used at run creation - a malformed limits snapshot must never be
 *  persisted. Re-exports the AF-v1 contract validator for one import site. */
export { validateRunLimits };
