// types/agent-framework/permission-contract.ts
// AT24 Agent Framework - Permission / Guardrail contract (A1).
//
// LOCKED (AN1.2 invariant 3): PermissionPolicy is an ALLOWLIST. Everything
// not listed is denied. CAN_CREATE_ORDER / CAN_EXECUTE_ORDER are rejected at
// this (parser) layer unless BOTH a server env flag AND a per-user allowlist
// pass - `LIVE_EXECUTION = DENY` is enforced twice (here, and again at the
// tool gate in A2/A4). This file provides the pure decision functions only;
// reading the env flag / allowlist is a runtime concern (A4).

import {
  type ContractValidationResult,
  type ContractViolation,
  contractResult,
} from "./common";

/** The closed set of capabilities an agent can be granted. Additive-only:
 *  a new key is appended, never repurposed. */
export type PermissionKey =
  | "CAN_READ_MARKET_DATA"
  | "CAN_READ_NEWS"
  | "CAN_RUN_RESEARCH"
  | "CAN_RUN_BACKTEST"
  | "CAN_READ_PORTFOLIO"
  | "CAN_GENERATE_SIGNAL"
  | "CAN_CREATE_ORDER"
  | "CAN_EXECUTE_ORDER"
  | "CAN_USE_MEMORY";

export const PERMISSION_KEYS: readonly PermissionKey[] = [
  "CAN_READ_MARKET_DATA",
  "CAN_READ_NEWS",
  "CAN_RUN_RESEARCH",
  "CAN_RUN_BACKTEST",
  "CAN_READ_PORTFOLIO",
  "CAN_GENERATE_SIGNAL",
  "CAN_CREATE_ORDER",
  "CAN_EXECUTE_ORDER",
  "CAN_USE_MEMORY",
] as const;

/** Permissions that can never be granted by configuration alone. */
export const DANGEROUS_PERMISSIONS: readonly PermissionKey[] = [
  "CAN_CREATE_ORDER",
  "CAN_EXECUTE_ORDER",
] as const;

/** The framework-wide default posture for live execution. Never "ALLOW". */
export const LIVE_EXECUTION_DEFAULT: "DENY" = "DENY";

/** An allowlist. A key absent from `granted` is denied. */
export interface PermissionPolicy {
  granted: PermissionKey[];
}

// ---- A8: permission <-> autonomy floors + prohibited combinations -------

/** The minimum agent autonomy level required to HOLD a permission. Holding a
 *  permission whose floor exceeds the agent's autonomy is an invalid config
 *  (the AuthorizationService rejects it). Permissions not listed have floor 0. */
export const PERMISSION_AUTONOMY_FLOOR: Partial<Record<PermissionKey, 0 | 1 | 2 | 3 | 4>> = {
  CAN_GENERATE_SIGNAL: 1,
  CAN_CREATE_ORDER: 3,
  CAN_EXECUTE_ORDER: 3,
};

/** Permission sets a single agent must never hold together - each pair (or
 *  larger set) would compose into an unsupervised capability. */
export const PROHIBITED_PERMISSION_COMBINATIONS: readonly (readonly PermissionKey[])[] = [
  ["CAN_GENERATE_SIGNAL", "CAN_EXECUTE_ORDER"], // signal + execute = an unsupervised trading loop
  ["CAN_CREATE_ORDER", "CAN_GENERATE_SIGNAL"],
] as const;

export function permissionAutonomyFloor(key: PermissionKey): 0 | 1 | 2 | 3 | 4 {
  return PERMISSION_AUTONOMY_FLOOR[key] ?? 0;
}

/** Which prohibited combinations a granted set violates ([] = none). */
export function prohibitedCombosViolated(granted: readonly PermissionKey[]): PermissionKey[][] {
  const set = new Set(granted);
  return PROHIBITED_PERMISSION_COMBINATIONS.filter((combo) => combo.every((k) => set.has(k))).map((c) => [...c]);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as readonly string[]).includes(value);
}

export function isDangerousPermission(key: PermissionKey): boolean {
  return (DANGEROUS_PERMISSIONS as readonly string[]).includes(key);
}

// ---- Runtime-supplied context for policy validation --------------------

/** Supplied by the runtime (A4) from a server env flag + a per-user
 *  allowlist. The contract layer never reads either itself - it only decides
 *  given them. */
export interface LiveExecutionContext {
  /** true when the AGENT_LIVE_EXECUTION_ENABLED server flag is set. */
  liveExecutionEnabled: boolean;
  /** true when the requesting user is on the execution allowlist. */
  userAllowlisted: boolean;
}

export const DENY_LIVE_EXECUTION_CONTEXT: LiveExecutionContext = {
  liveExecutionEnabled: false,
  userAllowlisted: false,
};

// ---- Pure decisions ---------------------------------------------------

export interface PermissionDecision {
  allowed: boolean;
  /** Required keys the policy does not grant. Empty iff allowed. */
  missing: PermissionKey[];
}

/** Does `policy` grant every key in `required`? Deterministic, no I/O. */
export function evaluatePermission(
  policy: PermissionPolicy,
  required: readonly PermissionKey[],
): PermissionDecision {
  const grantedSet = new Set(policy.granted);
  const missing = required.filter((key) => !grantedSet.has(key));
  return { allowed: missing.length === 0, missing };
}

/**
 * Validate a PermissionPolicy at definition-write time. Rejects:
 *  - unknown / duplicate keys
 *  - any DANGEROUS_PERMISSION unless BOTH liveExecutionEnabled AND
 *    userAllowlisted are true (the parser-layer half of the double gate).
 * With no context supplied, live execution is denied (fail-closed).
 */
export function validatePermissionPolicy(
  policy: PermissionPolicy,
  ctx: LiveExecutionContext = DENY_LIVE_EXECUTION_CONTEXT,
): ContractValidationResult {
  const violations: ContractViolation[] = [];

  if (!policy || !Array.isArray(policy.granted)) {
    return contractResult([{ path: "granted", message: "granted must be an array of PermissionKey." }]);
  }

  const seen = new Set<string>();
  for (const key of policy.granted) {
    if (!isPermissionKey(key)) {
      violations.push({ path: "granted", message: `Unknown permission key "${String(key)}".` });
      continue;
    }
    if (seen.has(key)) {
      violations.push({ path: "granted", message: `Duplicate permission key "${key}".` });
    }
    seen.add(key);

    if (isDangerousPermission(key) && !(ctx.liveExecutionEnabled && ctx.userAllowlisted)) {
      violations.push({
        path: "granted",
        message:
          `"${key}" cannot be granted: live execution is denied by default and ` +
          `requires both AGENT_LIVE_EXECUTION_ENABLED and a per-user allowlist entry.`,
      });
    }
  }

  return contractResult(violations);
}
