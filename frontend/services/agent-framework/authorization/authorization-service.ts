// services/agent-framework/authorization/authorization-service.ts
// AT24 Agent Framework - A8. The CENTRAL authorization decision boundary.
//
// LOCKED (owner G07): this consolidates - it does NOT create a parallel
// governance system. It CONSUMES the existing policies:
//   - A1  PermissionPolicy + AutonomyLevel on the AgentDefinition (the grants)
//   - A2  ToolDefinition capability metadata (requiredPermissions / autonomyFloor
//         / executionMode / category) from the ToolRegistry
//   - A4  checkLimits() from the LimitEnforcer (resource limits)
//   - A1  the LIVE_EXECUTION double-gate
// ...and produces one deterministic AuthorizationDecision.
//
// Hierarchy (owner):
//   Agent Definition -> Permission Policy -> Autonomy Policy -> Run Limits
//     -> (Supervisor Plan) -> AUTHORIZATION -> AuthorizedToolIntent
//     -> Tool Registry -> Executor
//
// INVARIANTS:
//  - default deny: an unknown tool / capability / malformed request is denied.
//  - permission AND autonomy are SEPARATE controls; BOTH must pass.
//  - LIVE_EXECUTION = DENY, enforced here regardless of anything else.
//  - the planner/LLM can NEVER grant a permission or raise autonomy: the
//    request carries only { toolId, input, rationale }; this service reads
//    grants ONLY from the AgentDefinition, never from the request.

import {
  type AgentDefinition,
  type PlannerToolRequest,
  type AuthorizedToolIntent,
  type PermissionKey,
  type AutonomyLevel,
  type LiveExecutionContext,
  DENY_LIVE_EXECUTION_CONTEXT,
  DANGEROUS_PERMISSIONS,
  MAX_CONFIGURABLE_AUTONOMY_V1,
  LIVE_EXECUTION_MIN_AUTONOMY,
  evaluatePermission,
  canRunAtAutonomy,
  permissionAutonomyFloor,
  prohibitedCombosViolated,
} from "@/types/agent-framework";
import type { ToolRegistry } from "../tools/tool-registry";
import { checkLimits, type LimitCheckContext } from "../runtime/limit-enforcer";
import { autonomyCapForType } from "../agent-type-registry";

export type AuthorizationOutcome = "allow" | "deny" | "needs_approval";

export type AuthorizationDenialCode =
  | "malformed_request"
  | "unknown_tool"
  | "tool_disabled"
  | "execution_mode_unsupported"
  | "agent_autonomy_ceiling"
  | "permission_autonomy_floor"
  | "prohibited_combination"
  | "live_execution_denied"
  | "missing_permission"
  | "tool_autonomy_floor"
  | "resource_limit";

export interface AuthorizationCheck {
  gate: string;
  passed: boolean;
  detail?: string;
}

export interface AuthorizationDecision {
  outcome: AuthorizationOutcome;
  intent?: AuthorizedToolIntent;
  denialCode?: AuthorizationDenialCode;
  message?: string;
  /** which run-limit was breached, when denialCode === "resource_limit". */
  breachedLimit?: keyof LimitCheckContext["limits"];
  /** every gate that was evaluated, in order. */
  checks: AuthorizationCheck[];
}

export interface AuthorizationInput {
  definition: AgentDefinition;
  request: PlannerToolRequest;
  registry: ToolRegistry;
  /** run-limit snapshot + current counts (from the runtime). */
  limitContext: LimitCheckContext;
  /** the tool's flat credit pre-estimate. */
  creditEstimate: number;
  /** live-execution env context; defaults to fully denied. */
  liveExecution?: LiveExecutionContext;
}

/** autonomyFloor at/above which a tool needs explicit human approval. */
const APPROVAL_AUTONOMY: AutonomyLevel = LIVE_EXECUTION_MIN_AUTONOMY; // 3

const REQUEST_AUTHORITY_KEYS = ["permissions", "permission", "grant", "granted", "autonomy", "autonomyLevel", "authorizedBy"];

export class AuthorizationService {
  authorize(input: AuthorizationInput): AuthorizationDecision {
    const { definition, request, registry } = input;
    const live = input.liveExecution ?? DENY_LIVE_EXECUTION_CONTEXT;
    const checks: AuthorizationCheck[] = [];
    const granted = definition.permissionPolicy?.granted ?? [];

    const deny = (code: AuthorizationDenialCode, message: string, extra: Partial<AuthorizationDecision> = {}): AuthorizationDecision => ({
      outcome: "deny",
      denialCode: code,
      message,
      checks,
      ...extra,
    });
    const record = (gate: string, passed: boolean, detail?: string) => {
      checks.push({ gate, passed, detail });
      return passed;
    };

    // 1. malformed / authority-injection
    if (typeof request?.toolId !== "string" || request.toolId.trim().length === 0) {
      record("malformed_request", false, "request.toolId is missing");
      return deny("malformed_request", "request.toolId is required");
    }
    const injected = REQUEST_AUTHORITY_KEYS.filter((k) => k in (request as unknown as Record<string, unknown>));
    if (injected.length > 0) {
      record("malformed_request", false, `request carries authority field(s): ${injected.join(", ")}`);
      return deny("malformed_request", "a planner request may not carry permission/autonomy fields");
    }
    record("malformed_request", true);

    // 2. unknown tool (default deny)
    const impl = registry.get(request.toolId);
    if (!impl) {
      record("unknown_tool", false, request.toolId);
      return deny("unknown_tool", `tool "${request.toolId}" is not registered`);
    }
    record("unknown_tool", true);
    const tool = impl.definition;

    // 3. tool active
    if (!record("tool_active", tool.status === "active", `status=${tool.status}`)) {
      return deny("tool_disabled", `tool "${tool.id}" is ${tool.status}`);
    }

    // 4. execution mode supported
    if (!record("execution_mode", tool.executionMode === "sync" || tool.executionMode === "resumable", tool.executionMode)) {
      return deny("execution_mode_unsupported", `execution mode "${tool.executionMode}" is not supported`);
    }

    // 5. agent autonomy ceiling (re-check a persisted definition; defence in depth)
    const typeCap = autonomyCapForType(definition.type);
    const ceiling = Math.min(MAX_CONFIGURABLE_AUTONOMY_V1, typeCap ?? MAX_CONFIGURABLE_AUTONOMY_V1);
    if (!record("agent_autonomy_ceiling", definition.autonomyLevel <= ceiling, `level=${definition.autonomyLevel} ceiling=${ceiling}`)) {
      return deny("agent_autonomy_ceiling", `agent autonomy ${definition.autonomyLevel} exceeds the ceiling ${ceiling}`);
    }

    // 6. permission <-> autonomy floors (holding a permission you aren't autonomous enough for is invalid)
    const underAutonomy = granted.filter((k) => permissionAutonomyFloor(k) > definition.autonomyLevel);
    if (!record("permission_autonomy_floor", underAutonomy.length === 0, underAutonomy.join(", "))) {
      return deny("permission_autonomy_floor", `agent holds ${underAutonomy.join(", ")} above its autonomy level`);
    }

    // 7. prohibited permission combinations
    const combos = prohibitedCombosViolated(granted);
    if (!record("prohibited_combination", combos.length === 0, combos.map((c) => c.join("+")).join(" ; "))) {
      return deny("prohibited_combination", `prohibited permission combination: ${combos.map((c) => c.join("+")).join(" ; ")}`);
    }

    // 8. LIVE_EXECUTION = DENY (hard backstop: any tool requiring a dangerous
    //    permission is denied unless BOTH env gates pass AND the agent is at
    //    the live-execution autonomy floor - none of which is true in v1).
    const toolNeedsDangerous = tool.requiredPermissions.some((k) =>
      (DANGEROUS_PERMISSIONS as readonly PermissionKey[]).includes(k),
    );
    if (toolNeedsDangerous) {
      const liveOk = live.liveExecutionEnabled && live.userAllowlisted && definition.autonomyLevel >= LIVE_EXECUTION_MIN_AUTONOMY;
      if (!record("live_execution", liveOk, `enabled=${live.liveExecutionEnabled} allowlisted=${live.userAllowlisted}`)) {
        return deny("live_execution_denied", `live execution is denied for "${tool.id}"`);
      }
    } else {
      record("live_execution", true, "tool needs no dangerous permission");
    }

    // 9. permission grant
    const perm = evaluatePermission(definition.permissionPolicy, tool.requiredPermissions);
    if (!record("permission", perm.allowed, perm.missing.join(", "))) {
      return deny("missing_permission", `agent lacks ${perm.missing.join(", ")} for "${tool.id}"`);
    }

    // 10. tool autonomy floor (SEPARATE control from permission)
    if (!record("tool_autonomy_floor", canRunAtAutonomy(definition.autonomyLevel, tool.autonomyFloor), `floor=${tool.autonomyFloor} agent=${definition.autonomyLevel}`)) {
      return deny("tool_autonomy_floor", `"${tool.id}" needs autonomy >= ${tool.autonomyFloor}; agent is ${definition.autonomyLevel}`);
    }

    // 11. resource limits (consolidated - calls A4's checkLimits)
    const limitDecision = checkLimits(input.limitContext, input.creditEstimate);
    if (limitDecision.breached) {
      record("resource_limit", false, `${limitDecision.limit}: ${limitDecision.message}`);
      return deny("resource_limit", limitDecision.message, { breachedLimit: limitDecision.limit });
    }
    record("resource_limit", true);

    // ---- all gates passed ----
    if (tool.autonomyFloor >= APPROVAL_AUTONOMY) {
      // structurally unreachable in v1 (gate 10 would have denied), but the
      // path exists: a tool at the approval floor needs explicit human sign-off.
      return { outcome: "needs_approval", message: `"${tool.id}" requires human approval`, checks };
    }

    const intent: AuthorizedToolIntent = {
      toolId: tool.id,
      toolVersion: tool.version,
      input: request.input,
      authorizedBy: [...tool.requiredPermissions],
      creditsReserved: input.creditEstimate,
    };
    return { outcome: "allow", intent, checks };
  }
}

export const authorizationService = new AuthorizationService();
