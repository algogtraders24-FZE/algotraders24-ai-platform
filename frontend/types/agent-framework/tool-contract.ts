// types/agent-framework/tool-contract.ts
// AT24 Agent Framework - Tool contract (A1).
//
// LOCKED (core principle): the Tool Registry declares CAPABILITY and POLICY.
// It is never the execution authority. Every tool wraps an EXISTING AT24
// service (RealTimeIntelligenceService, at24-quant-engine, algo-test.service,
// news.service, KnowledgeRetriever, the risk engine, paper-trading, ...).
// No second Quant Engine. No second Intelligence Pipeline.
//
// LOCKED (AN1.2 - "Planner != Executor"): three separate roles, encoded as
// three separate types below.
//
//   AGENT
//     v
//   PLANNER            decides WHAT should happen next     -> PlannerToolRequest
//     v
//   PERMISSION POLICY  is this agent allowed to?           (permission-contract)
//     v
//   TOOL REGISTRY      does this capability exist + policy? -> resolves ToolDefinition
//     v
//   EXECUTOR           HOW to safely run the authorized op -> ExecutorInvocation
//     v
//   existing AT24 service                                  -> ToolResult (+ evidence)
//
// The planner must NEVER hold a handler or invoke application code directly.
// A PlannerToolRequest is an INTENT. Only after permission + registry +
// autonomy + credit checks does it become an AuthorizedToolIntent that the
// executor may run.

import { type JsonSchema, type ContractValidationResult, type ContractViolation, contractResult, isIdentifier, isNonEmptyString, isNonNegativeNumber } from "./common";
import type { PermissionKey } from "./permission-contract";
import { isPermissionKey } from "./permission-contract";
import type { AutonomyLevel } from "./autonomy-contract";
import { isAutonomyLevel } from "./autonomy-contract";
import { type AgentEvidenceType, isAgentEvidenceType } from "./evidence-contract";

export type ToolCategory =
  | "MARKET_DATA"
  | "INDICATORS"
  | "NEWS"
  | "RESEARCH"
  | "STRATEGY_LIBRARY"
  | "QUANT_ENGINE"
  | "BACKTEST"
  | "RISK_ENGINE"
  | "PORTFOLIO"
  | "EXECUTION";

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  "MARKET_DATA",
  "INDICATORS",
  "NEWS",
  "RESEARCH",
  "STRATEGY_LIBRARY",
  "QUANT_ENGINE",
  "BACKTEST",
  "RISK_ENGINE",
  "PORTFOLIO",
  "EXECUTION",
] as const;

export type ToolStatus = "active" | "deprecated" | "disabled";

/** Whether one invocation completes within a single request (`sync`) or must
 *  be driven across multiple `tick()` steps by the resumable runtime (A4).
 *  Declared here so the planner/runtime can schedule correctly; every A2
 *  tool is `sync`. */
export type ToolExecutionMode = "sync" | "resumable";

/** What real, cited evidence a tool's result can back. Consumed by the
 *  EvidenceRecorder (A6) and the output-integrity check (A4). */
export interface ToolEvidenceSpec {
  /** True when a successful call yields at least one AgentEvidence row. */
  producesEvidence: boolean;
  /** The AgentEvidence `type` values this tool can emit. */
  evidenceTypes: AgentEvidenceType[];
  /** The `provenance.producer` label every evidence row from this tool
   *  carries (e.g. "intelligence-pipeline", "at24-quant-engine",
   *  "market-data-service"). Never a vendor name in the contract - the
   *  concrete provider is an implementation detail of the handler. */
  provenanceProducer: string;
}

/** How a tool call's credit cost is determined. `estimated` names an
 *  estimator by id (resolved in the runtime, A9) and carries a hard ceiling
 *  so a bad estimate can never authorize unbounded spend. */
export type ToolCreditCost =
  | { model: "flat"; credits: number }
  | { model: "estimated"; estimatorId: string; ceiling: number };

/**
 * The declarative contract for one tool. NO handler field - binding a
 * ToolDefinition to an execution handler that calls an existing AT24 service
 * is an A2 concern (ToolImplementation), kept out of the contract layer so
 * the contract stays pure and vendor-neutral.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  /** Every permission the runtime must confirm before the executor runs it. */
  requiredPermissions: PermissionKey[];
  /** Minimum agent autonomy level to invoke this tool. */
  autonomyFloor: AutonomyLevel;
  creditCost: ToolCreditCost;
  /** Whether the call is single-request or must be resumed across ticks. */
  executionMode: ToolExecutionMode;
  /** What cited evidence a successful call produces. */
  evidence: ToolEvidenceSpec;
  status: ToolStatus;
  /** Free-text pointer to the existing AT24 service this tool wraps, e.g.
   *  "services/intelligence/orchestration/real-time-intelligence.service.ts".
   *  Declared here for traceability; it is documentation, not a code import. */
  wraps: string;
}

/** Thrown by the registry's `require` lookup for an id that is not
 *  registered. Deterministic unknown-tool rejection (G02 requirement 10). */
export class UnknownToolError extends Error {
  constructor(public readonly toolId: string) {
    super(`Unknown tool "${toolId}".`);
    this.name = "UnknownToolError";
  }
}

// ---- The three-role boundary (Planner != Registry != Executor) ---------

/** Emitted by the PLANNER. A pure intent - "I want to call tool X with
 *  these params". Carries no authority and no handler. */
export interface PlannerToolRequest {
  toolId: string;
  input: unknown;
  /** Why the planner wants this step (for the trace / evaluation). */
  rationale: string;
}

/** Produced by the runtime AFTER permission + registry + autonomy + credit
 *  checks all pass. This is the only thing an executor is allowed to run. */
export interface AuthorizedToolIntent {
  toolId: string;
  toolVersion: string;
  input: unknown;
  /** The permission keys that were confirmed to authorize this call. */
  authorizedBy: PermissionKey[];
  /** Credits reserved for this call (from the flat cost or a capped estimate). */
  creditsReserved: number;
}

/** What the EXECUTOR receives. Adds run/step identity for tracing. The
 *  executor decides HOW to safely run it; it never re-decides WHETHER to. */
export interface ExecutorInvocation {
  runId: string;
  stepId: string;
  intent: AuthorizedToolIntent;
}

export type ToolResultStatus =
  | "ok"
  | "invalid_input"
  | "tool_error"
  | "tool_timeout"
  | "permission_denied";

/** The normalized outcome of one tool invocation. */
export interface ToolResult {
  status: ToolResultStatus;
  /** Present iff status === "ok". Validated against the tool's outputSchema. */
  output?: unknown;
  /** Closed-vocabulary reason when status !== "ok". Never raw provider text. */
  errorKind?: string;
  creditsConsumed: number;
  durationMs: number;
}

// ---- Guards / validation --------------------------------------------

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === "string" && (TOOL_CATEGORIES as readonly string[]).includes(value);
}

export function isToolStatus(value: unknown): value is ToolStatus {
  return value === "active" || value === "deprecated" || value === "disabled";
}

function validateCreditCost(cost: ToolCreditCost, v: ContractViolation[]): void {
  if (!cost || typeof cost !== "object") {
    v.push({ path: "creditCost", message: "creditCost is required." });
    return;
  }
  if (cost.model === "flat") {
    if (!isNonNegativeNumber(cost.credits)) {
      v.push({ path: "creditCost.credits", message: "flat creditCost.credits must be a number >= 0." });
    }
  } else if (cost.model === "estimated") {
    if (!isNonEmptyString(cost.estimatorId)) {
      v.push({ path: "creditCost.estimatorId", message: "estimated creditCost.estimatorId is required." });
    }
    if (!isNonNegativeNumber(cost.ceiling) || cost.ceiling <= 0) {
      v.push({ path: "creditCost.ceiling", message: "estimated creditCost.ceiling must be a number > 0." });
    }
  } else {
    v.push({ path: "creditCost.model", message: 'creditCost.model must be "flat" or "estimated".' });
  }
}

/** Validate a ToolDefinition. Pure. */
export function validateToolDefinition(tool: ToolDefinition): ContractValidationResult {
  const v: ContractViolation[] = [];

  if (!isIdentifier(tool.id)) {
    v.push({ path: "id", message: 'id must be a lowercase dotted identifier, e.g. "market.snapshot".' });
  }
  if (!isNonEmptyString(tool.name)) v.push({ path: "name", message: "name is required." });
  if (!isNonEmptyString(tool.description)) v.push({ path: "description", message: "description is required." });
  if (!isNonEmptyString(tool.version)) v.push({ path: "version", message: "version is required." });
  if (!isToolCategory(tool.category)) {
    v.push({ path: "category", message: `category must be one of: ${TOOL_CATEGORIES.join(", ")}.` });
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    v.push({ path: "inputSchema", message: "inputSchema must be a JSON Schema object." });
  }
  if (!tool.outputSchema || typeof tool.outputSchema !== "object") {
    v.push({ path: "outputSchema", message: "outputSchema must be a JSON Schema object." });
  }
  if (!Array.isArray(tool.requiredPermissions)) {
    v.push({ path: "requiredPermissions", message: "requiredPermissions must be an array." });
  } else {
    for (const key of tool.requiredPermissions) {
      if (!isPermissionKey(key)) {
        v.push({ path: "requiredPermissions", message: `Unknown permission key "${String(key)}".` });
      }
    }
  }
  if (!isAutonomyLevel(tool.autonomyFloor)) {
    v.push({ path: "autonomyFloor", message: "autonomyFloor must be an AutonomyLevel (0-4)." });
  }
  validateCreditCost(tool.creditCost, v);

  if (tool.executionMode !== "sync" && tool.executionMode !== "resumable") {
    v.push({ path: "executionMode", message: 'executionMode must be "sync" or "resumable".' });
  }

  if (!tool.evidence || typeof tool.evidence !== "object") {
    v.push({ path: "evidence", message: "evidence (ToolEvidenceSpec) is required." });
  } else {
    if (typeof tool.evidence.producesEvidence !== "boolean") {
      v.push({ path: "evidence.producesEvidence", message: "producesEvidence must be a boolean." });
    }
    if (!Array.isArray(tool.evidence.evidenceTypes)) {
      v.push({ path: "evidence.evidenceTypes", message: "evidenceTypes must be an array." });
    } else {
      for (const t of tool.evidence.evidenceTypes) {
        if (!isAgentEvidenceType(t)) {
          v.push({ path: "evidence.evidenceTypes", message: `Unknown evidence type "${String(t)}".` });
        }
      }
    }
    if (!isNonEmptyString(tool.evidence.provenanceProducer)) {
      v.push({ path: "evidence.provenanceProducer", message: "provenanceProducer is required." });
    }
    if (tool.evidence.producesEvidence === true && tool.evidence.evidenceTypes.length === 0) {
      v.push({ path: "evidence.evidenceTypes", message: "a tool that producesEvidence must declare at least one evidence type." });
    }
  }

  if (!isToolStatus(tool.status)) {
    v.push({ path: "status", message: 'status must be "active", "deprecated" or "disabled".' });
  }
  if (!isNonEmptyString(tool.wraps)) {
    v.push({ path: "wraps", message: "wraps must name the existing AT24 service this tool delegates to." });
  }

  // Cross-field invariant: an EXECUTION-category tool must sit at or above
  // the live-execution autonomy floor and must not ship "active" in v1.
  if (tool.category === "EXECUTION") {
    if (isAutonomyLevel(tool.autonomyFloor) && tool.autonomyFloor < 3) {
      v.push({ path: "autonomyFloor", message: "EXECUTION tools require autonomyFloor >= 3." });
    }
    if (tool.status === "active") {
      v.push({ path: "status", message: "EXECUTION tools must not be active in v1 (live execution is denied)." });
    }
  }

  return contractResult(v);
}
