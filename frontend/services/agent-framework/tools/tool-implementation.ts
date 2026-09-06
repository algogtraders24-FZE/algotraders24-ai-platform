// services/agent-framework/tools/tool-implementation.ts
// AT24 Agent Framework - A2. Binds a declarative AF-v1 ToolDefinition to a
// real, server-side handler that calls an EXISTING AT24 service.
//
// This is the runtime seam the contract layer deliberately left out
// (ToolDefinition has no handler). A ToolImplementation lives ONLY under
// services/agent-framework/ - never in types/agent-framework/.
//
// LOCKED: the handler wraps an existing service. It never reimplements the
// Intelligence Pipeline or the Quant Engine, never calls an LLM, and never
// performs a live order.

import type {
  ToolDefinition,
  ContractValidationResult,
  AgentEvidenceDraft,
} from "@/types/agent-framework";

/** Context the runtime (A4) supplies to a handler. In A2 only `userId` is
 *  populated by the validation harness; run/step ids arrive once the
 *  runtime exists. */
export interface ToolHandlerContext {
  /** The owning user. Every wrapped service scopes its work to this id -
   *  never to a client-supplied one. */
  userId: string;
  runId?: string;
  stepId?: string;
  /** Cooperative cancellation from the LimitEnforcer (A4). */
  signal?: AbortSignal;
}

/** What a successful handler returns: the typed result plus any cited
 *  evidence drafts (identity/linkage filled in later by the EvidenceRecorder,
 *  A6). */
export interface ToolHandlerResult<TOutput> {
  output: TOutput;
  evidence: AgentEvidenceDraft[];
}

/** Parse result for a tool's raw input. Deterministic; never throws. */
export type ToolInputParseResult<TInput> =
  | { ok: true; value: TInput }
  | { ok: false; violations: ContractValidationResult["violations"] };

/**
 * A registered tool: its declarative definition + the three runtime hooks.
 * `parseInput` / `checkOutput` are HAND-WRITTEN guards (repo convention -
 * no schema-validation library), with the JSON Schemas on the definition
 * kept as the declarative surface for the future Agent Builder UI / LLM
 * function specs.
 */
export interface ToolImplementation<TInput = unknown, TOutput = unknown> {
  definition: ToolDefinition;
  /** Validate + narrow raw planner input. Deterministic, never throws. */
  parseInput(raw: unknown): ToolInputParseResult<TInput>;
  /** Validate the handler's own output shape before it is trusted. */
  checkOutput(value: unknown): ContractValidationResult;
  /** Call the existing AT24 service. May throw - the gateway catches and
   *  normalizes into a typed ToolResult. */
  handler(input: TInput, ctx: ToolHandlerContext): Promise<ToolHandlerResult<TOutput>>;
}

/** Narrowing helper for the common "object with these keys" case. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
