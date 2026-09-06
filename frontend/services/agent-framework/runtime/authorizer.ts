// services/agent-framework/runtime/authorizer.ts
// AT24 Agent Framework - A4. Turns a planner INTENT (PlannerToolRequest)
// into an AuthorizedToolIntent - or a typed denial.
//
// LOCKED (AN1.2 - "Planner != Registry != Executor"): this is the
// authorization boundary. Order of checks:
//   1. the tool exists in the registry
//   2. the tool is active
//   3. the agent's PermissionPolicy grants every required permission
//   4. the agent's autonomyLevel meets the tool's autonomyFloor
//   5. (credit reservation is a pre-flight LimitEnforcer check done by the
//      runtime BEFORE calling this - passed in as `creditsReserved`)
// Only after all pass does an ExecutorInvocation become possible.
//
// Pure: no I/O. The ToolRegistry is passed in.

import {
  type AgentDefinition,
  type PlannerToolRequest,
  type AuthorizedToolIntent,
  type PermissionKey,
  evaluatePermission,
  canRunAtAutonomy,
} from "@/types/agent-framework";
import type { ToolRegistry } from "../tools/tool-registry";

export type AuthorizationDenialReason =
  | "unknown_tool"
  | "tool_disabled"
  | "missing_permission"
  | "autonomy_floor";

export type AuthorizationResult =
  | { authorized: true; intent: AuthorizedToolIntent }
  | {
      authorized: false;
      reason: AuthorizationDenialReason;
      message: string;
      /** permissions that were missing (for the trace), when relevant. */
      missing?: PermissionKey[];
    };

export function authorizeToolRequest(
  definition: AgentDefinition,
  request: PlannerToolRequest,
  registry: ToolRegistry,
  creditsReserved: number,
): AuthorizationResult {
  const impl = registry.get(request.toolId);
  if (!impl) {
    return { authorized: false, reason: "unknown_tool", message: `tool "${request.toolId}" is not registered` };
  }

  const def = impl.definition;

  if (def.status !== "active") {
    return { authorized: false, reason: "tool_disabled", message: `tool "${def.id}" is ${def.status}` };
  }

  const perm = evaluatePermission(definition.permissionPolicy, def.requiredPermissions);
  if (!perm.allowed) {
    return {
      authorized: false,
      reason: "missing_permission",
      message: `agent lacks ${perm.missing.join(", ")} for tool "${def.id}"`,
      missing: perm.missing,
    };
  }

  if (!canRunAtAutonomy(definition.autonomyLevel, def.autonomyFloor)) {
    return {
      authorized: false,
      reason: "autonomy_floor",
      message: `tool "${def.id}" needs autonomy >= ${def.autonomyFloor}; agent is at ${definition.autonomyLevel}`,
    };
  }

  return {
    authorized: true,
    intent: {
      toolId: def.id,
      toolVersion: def.version,
      input: request.input,
      authorizedBy: [...def.requiredPermissions],
      creditsReserved,
    },
  };
}
