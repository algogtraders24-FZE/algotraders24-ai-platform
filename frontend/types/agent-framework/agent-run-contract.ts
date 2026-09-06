// types/agent-framework/agent-run-contract.ts
// AT24 Agent Framework - Run / State contract (A1).
//
// LOCKED (AN1.2 invariant 1): the runtime is server-only. This contract is
// the DATABASE-BACKED state machine that a serverless invocation cannot be
// trusted to hold in memory. Every transition is persisted; a lost function
// invocation resumes from the persisted AgentRun row via tick() (A4).
//
// LOCKED (AN1.2 invariant 2): AgentStep / AgentToolCall are append-only and
// immutable (no update, no soft-delete). AgentRun has an update path ONLY
// for its status + terminal fields; a terminal run is never rewritten - a
// re-run is a new AgentRun row.
//
// This file defines shapes + a DETERMINISTIC transition table + pure
// predicates. It contains no execution logic.

import {
  type ContractValidationResult,
  type ContractViolation,
  contractResult,
  isNonNegativeInteger,
  isNonNegativeNumber,
} from "./common";
import type { AgentEvidence } from "./evidence-contract";
import type { ToolResultStatus } from "./tool-contract";

// ---- Run status -----------------------------------------------------

export type AgentRunStatus =
  // non-terminal
  | "queued"
  | "planning"
  | "running"
  | "awaiting_approval"
  // terminal - success
  | "succeeded"
  // terminal - failure / limit / control
  | "failed"
  | "timeout"
  | "credit_limit"
  | "step_limit"
  | "tool_call_limit"
  | "permission_denied"
  | "tool_error"
  | "model_error"
  | "cancelled";

export const AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "queued",
  "planning",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "timeout",
  "credit_limit",
  "step_limit",
  "tool_call_limit",
  "permission_denied",
  "tool_error",
  "model_error",
  "cancelled",
] as const;

export const TERMINAL_RUN_STATUSES: readonly AgentRunStatus[] = [
  "succeeded",
  "failed",
  "timeout",
  "credit_limit",
  "step_limit",
  "tool_call_limit",
  "permission_denied",
  "tool_error",
  "model_error",
  "cancelled",
] as const;

/**
 * The ONLY permitted status transitions. Any (from -> to) pair not listed
 * here is rejected deterministically by isValidRunTransition(). Terminal
 * statuses have no outgoing transitions.
 */
export const RUN_STATUS_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ["planning", "cancelled"],
  planning: ["running", "failed", "model_error", "permission_denied", "credit_limit", "cancelled"],
  running: [
    "running", // a tick that made progress but did not finish
    "awaiting_approval",
    "succeeded",
    "failed",
    "timeout",
    "credit_limit",
    "step_limit",
    "tool_call_limit",
    "permission_denied",
    "tool_error",
    "model_error",
    "cancelled",
  ],
  awaiting_approval: ["running", "cancelled", "timeout"],
  succeeded: [],
  failed: [],
  timeout: [],
  credit_limit: [],
  step_limit: [],
  tool_call_limit: [],
  permission_denied: [],
  tool_error: [],
  model_error: [],
  cancelled: [],
} as const;

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return typeof value === "string" && (AGENT_RUN_STATUSES as readonly string[]).includes(value);
}

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** Deterministic: is `from -> to` a permitted transition? */
export function isValidRunTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  if (!isAgentRunStatus(from) || !isAgentRunStatus(to)) return false;
  return (RUN_STATUS_TRANSITIONS[from] as readonly string[]).includes(to);
}

// ---- Trigger -------------------------------------------------------

export type AgentRunTrigger = "manual" | "schedule" | "event" | "supervisor";

export const AGENT_RUN_TRIGGERS: readonly AgentRunTrigger[] = ["manual", "schedule", "event", "supervisor"] as const;

export function isAgentRunTrigger(value: unknown): value is AgentRunTrigger {
  return typeof value === "string" && (AGENT_RUN_TRIGGERS as readonly string[]).includes(value);
}

// ---- Resource limits (snapshot onto every run) ---------------------

/** The effective ceilings for one run, snapshotted from the agent's
 *  creditPolicy + framework defaults at run creation. The LimitEnforcer
 *  (A4) reads THIS, never the live policy, so a mid-run policy edit cannot
 *  change a run's ceilings. */
export interface AgentRunLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxCreditCost: number;
  maxRetries: number;
}

/** Conservative framework defaults. An agent may lower these via its
 *  creditPolicy; it may not silently raise them past framework maxima
 *  (enforced in A4). */
export const DEFAULT_RUN_LIMITS: AgentRunLimits = {
  maxSteps: 25,
  maxToolCalls: 40,
  maxRuntimeMs: 300_000,
  maxCreditCost: 250,
  maxRetries: 2,
};

/** Which terminal status a given limit breach maps to. */
export const LIMIT_BREACH_STATUS: Readonly<Record<keyof AgentRunLimits, AgentRunStatus>> = {
  maxSteps: "step_limit",
  maxToolCalls: "tool_call_limit",
  maxRuntimeMs: "timeout",
  maxCreditCost: "credit_limit",
  maxRetries: "failed",
} as const;

// ---- Step / tool-call rows ---------------------------------------

export type AgentStepKind =
  | "plan"
  | "tool_call"
  | "evidence"
  | "memory_read"
  | "memory_write"
  | "evaluation"
  | "model_call"
  | "output";

export const AGENT_STEP_KINDS: readonly AgentStepKind[] = [
  "plan",
  "tool_call",
  "evidence",
  "memory_read",
  "memory_write",
  "evaluation",
  "model_call",
  "output",
] as const;

export function isAgentStepKind(value: unknown): value is AgentStepKind {
  return typeof value === "string" && (AGENT_STEP_KINDS as readonly string[]).includes(value);
}

export type AgentStepStatus = "ok" | "error" | "skipped";

/** An append-only, ordered record of one thing the runtime did. */
export interface AgentStep {
  id: string;
  runId: string;
  /** 0-based, strictly increasing, no gaps. */
  index: number;
  kind: AgentStepKind;
  status: AgentStepStatus;
  summary: string;
  input?: unknown;
  output?: unknown;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  creditsConsumed: number;
}

/** An append-only record of one tool invocation (maps to ToolResultStatus). */
export interface AgentToolCall {
  id: string;
  runId: string;
  stepId: string;
  toolId: string;
  toolVersion: string;
  input: unknown;
  output?: unknown;
  status: ToolResultStatus;
  /** Which permission keys the gate confirmed (empty if it denied the call). */
  permissionChecked: string[];
  creditCost: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** ids of the AgentEvidence rows this call produced. */
  evidenceIds: string[];
}

// ---- The run row -------------------------------------------------

export interface AgentRun {
  id: string;
  agentId: string;
  /** The AgentVersion this run executed against (immutable for the run). */
  agentVersion: string;
  userId: string;
  status: AgentRunStatus;
  trigger: AgentRunTrigger;
  /** The goal / parameters for this run. */
  input: unknown;
  /** The planner's output: the ordered intended steps. */
  plan?: unknown;
  /** The final structured output, validated against the agent's outputSchema. */
  output?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Snapshot of the effective ceilings for this run. */
  limits: AgentRunLimits;
  creditsEstimated: number;
  creditsConsumed: number;
  startedAt?: string | null;
  completedAt?: string | null;
  /** engine versions, supervisor version, pipelineVersion, ... */
  metadata: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

/** A fully assembled run trace (read model for GET /runs/:id/trace). */
export interface AgentRunTrace {
  run: AgentRun;
  steps: AgentStep[];
  toolCalls: AgentToolCall[];
  evidence: AgentEvidence[];
}

// ---- Validation -------------------------------------------------

export function validateRunLimits(limits: AgentRunLimits): ContractValidationResult {
  const v: ContractViolation[] = [];
  const positiveInt = (key: keyof AgentRunLimits) => {
    if (!isNonNegativeInteger(limits[key]) || limits[key] <= 0) {
      v.push({ path: key, message: `${key} must be a positive integer.` });
    }
  };
  positiveInt("maxSteps");
  positiveInt("maxToolCalls");
  positiveInt("maxRuntimeMs");
  if (!isNonNegativeNumber(limits.maxCreditCost) || limits.maxCreditCost <= 0) {
    v.push({ path: "maxCreditCost", message: "maxCreditCost must be a positive number." });
  }
  if (!isNonNegativeInteger(limits.maxRetries)) {
    v.push({ path: "maxRetries", message: "maxRetries must be an integer >= 0." });
  }
  return contractResult(v);
}

/** Validate a proposed status change for a run. Deterministic. */
export function validateRunTransition(
  from: AgentRunStatus,
  to: AgentRunStatus,
): ContractValidationResult {
  if (!isAgentRunStatus(from)) {
    return contractResult([{ path: "from", message: `Unknown run status "${String(from)}".` }]);
  }
  if (!isAgentRunStatus(to)) {
    return contractResult([{ path: "to", message: `Unknown run status "${String(to)}".` }]);
  }
  if (isTerminalRunStatus(from)) {
    return contractResult([
      { path: "from", message: `"${from}" is terminal - a run in this state can never transition (re-run = new row).` },
    ]);
  }
  if (!isValidRunTransition(from, to)) {
    return contractResult([{ path: "to", message: `Transition "${from}" -> "${to}" is not permitted.` }]);
  }
  return contractResult([]);
}
