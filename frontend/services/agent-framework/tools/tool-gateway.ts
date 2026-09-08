// services/agent-framework/tools/tool-gateway.ts
// AT24 Agent Framework - A2. The single authorized entry point to run one
// tool. NOT an agent loop, NOT a planner - it takes an AuthorizedToolIntent
// (already past the planner and, in the real runtime, past permission /
// autonomy / credit reservation) and produces one normalized ToolResult.
//
// LOCKED (AN1.2 - "Planner != Executor"): the gateway re-checks permission
// and autonomy against the supplied policy as a defence-in-depth gate; it
// never re-plans and never decides WHETHER a step should happen.
//
// A2 scope: real input/output validation, permission + autonomy checks,
// deterministic unknown-tool rejection, a placeholder credit pre-estimate
// stamped on the result, handler invocation with timeout + error
// normalization, and pass-through of the handler's evidence drafts. The
// REAL credit ledger / enforcement is A9; memory is A7; the resumable
// runtime is A4.

import {
  type AuthorizedToolIntent,
  type PermissionKey,
  type PermissionPolicy,
  type AutonomyLevel,
  type ToolResult,
  type ToolResultStatus,
  type AgentEvidenceDraft,
  evaluatePermission,
  canRunAtAutonomy,
  validateAgentEvidenceDraft,
} from "@/types/agent-framework";
import type { ToolRegistry } from "./tool-registry";
import type { ToolHandlerContext } from "./tool-implementation";

/** How long a single tool handler may run before the gateway abandons it.
 *  A conservative default; the real per-run budget comes from
 *  AgentRunLimits.maxRuntimeMs in A4. */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export interface ToolInvocationRequest {
  registry: ToolRegistry;
  intent: AuthorizedToolIntent;
  /** The agent's permission policy (allowlist). */
  permissionPolicy: PermissionPolicy;
  /** The agent's autonomy level. */
  autonomyLevel: AutonomyLevel;
  /** Handler context (owning user, and later run/step ids + abort signal). */
  context: ToolHandlerContext;
  timeoutMs?: number;
}

export interface ToolInvocationOutcome {
  result: ToolResult;
  /** Evidence drafts from a successful call (empty otherwise). The runtime
   *  (A6) assigns identity + persists them. */
  evidence: AgentEvidenceDraft[];
  /** The permission keys the gateway confirmed (for the AgentToolCall row). */
  permissionChecked: PermissionKey[];
}

function fail(status: ToolResultStatus, errorKind: string, creditsConsumed: number, durationMs: number): ToolInvocationOutcome {
  return {
    result: { status, errorKind, creditsConsumed, durationMs },
    evidence: [],
    permissionChecked: [],
  };
}

function flatEstimate(creditCost: { model: string; credits?: number; ceiling?: number }): number {
  if (creditCost.model === "flat" && typeof creditCost.credits === "number") return creditCost.credits;
  // "estimated" tools: A2 has no estimator registry yet (A9) - use the hard
  // ceiling as the conservative pre-estimate so the seam is never bypassed.
  if (creditCost.model === "estimated" && typeof creditCost.ceiling === "number") return creditCost.ceiling;
  return 0;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = globalThis.setTimeout(() => reject(new Error("tool_timeout")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}

/**
 * Run one tool. Deterministic control flow:
 *   unknown id      -> invalid_input / "unknown_tool"
 *   bad input       -> invalid_input / "input_validation"
 *   missing perm    -> permission_denied / "missing_permission"
 *   autonomy floor  -> permission_denied / "autonomy_floor"
 *   handler throws   -> tool_error / <kind>   (or tool_timeout)
 *   bad output shape -> tool_error / "output_validation"
 *   otherwise        -> ok
 */
export async function invokeTool(req: ToolInvocationRequest): Promise<ToolInvocationOutcome> {
  const startedAt = Date.now();
  const timeoutMs = req.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const elapsed = () => Date.now() - startedAt;

  const impl = req.registry.get(req.intent.toolId);
  if (!impl) {
    return fail("invalid_input", "unknown_tool", 0, elapsed());
  }

  const { definition } = impl;
  const estimate = flatEstimate(definition.creditCost as { model: string; credits?: number; ceiling?: number });

  if (definition.status !== "active") {
    return fail("tool_error", "tool_disabled", 0, elapsed());
  }

  // --- Permission (defence-in-depth; the real gate also runs in A4) ------
  const permDecision = evaluatePermission(req.permissionPolicy, definition.requiredPermissions);
  if (!permDecision.allowed) {
    return fail("permission_denied", "missing_permission", 0, elapsed());
  }

  // --- Autonomy --------------------------------------------------------
  if (!canRunAtAutonomy(req.autonomyLevel, definition.autonomyFloor)) {
    return fail("permission_denied", "autonomy_floor", 0, elapsed());
  }

  // --- Input validation (hand-written guard) ---------------------------
  const parsed = impl.parseInput(req.intent.input);
  if (!parsed.ok) {
    return fail("invalid_input", "input_validation", 0, elapsed());
  }

  // --- Handler --------------------------------------------------------
  let handlerResult: Awaited<ReturnType<typeof impl.handler>>;
  try {
    handlerResult = await withTimeout(impl.handler(parsed.value, req.context), timeoutMs);
  } catch (err) {
    const kind = err instanceof Error && err.message === "tool_timeout" ? "tool_timeout" : "handler_threw";
    const status: ToolResultStatus = kind === "tool_timeout" ? "tool_timeout" : "tool_error";
    return {
      result: { status, errorKind: kind, creditsConsumed: estimate, durationMs: elapsed() },
      evidence: [],
      permissionChecked: [...definition.requiredPermissions],
    };
  }

  // --- Output validation --------------------------------------------
  const outputCheck = impl.checkOutput(handlerResult.output);
  if (!outputCheck.valid) {
    return {
      result: { status: "tool_error", errorKind: "output_validation", creditsConsumed: estimate, durationMs: elapsed() },
      evidence: [],
      permissionChecked: [...definition.requiredPermissions],
    };
  }

  // --- Evidence draft validation -----------------------------------
  const evidence = handlerResult.evidence ?? [];
  for (const draft of evidence) {
    const dCheck = validateAgentEvidenceDraft(draft);
    if (!dCheck.valid) {
      return {
        result: { status: "tool_error", errorKind: "evidence_validation", creditsConsumed: estimate, durationMs: elapsed() },
        evidence: [],
        permissionChecked: [...definition.requiredPermissions],
      };
    }
  }

  return {
    result: {
      status: "ok",
      output: handlerResult.output,
      creditsConsumed: estimate, // PLACEHOLDER pre-estimate - real metering in A9
      durationMs: elapsed(),
    },
    evidence,
    permissionChecked: [...definition.requiredPermissions],
  };
}
