// types/agent-framework/common.ts
// AT24 Agent Framework - shared contract primitives (Sprint AN, step A1).
//
// SCOPE: this file, and every file under types/agent-framework/, is a
// DECLARATIVE CONTRACT layer only. It defines shapes, closed vocabularies,
// deterministic state-transition tables and PURE validation predicates.
// It contains NO runtime behavior: no I/O, no database access, no network,
// no provider SDKs, no scheduling, no tool execution. The runtime that
// consumes these contracts is built in A4 under services/agent-framework/.
//
// See docs/architecture/AN1.2-agent-framework-locked-decisions.md for the
// invariants these types encode (server-only runtime, append-only immutable
// trace, default-deny permissions, autonomy default 0, no vendor names,
// planner != executor != registry).

/** A single, human-readable reason a contract value was rejected. Always
 *  states the field and why - never a bare code with no explanation
 *  (mirrors IntelligenceAnalysisOutcome.evaluationBasis discipline). */
export interface ContractViolation {
  /** Dotted path to the offending field, e.g. "creditPolicy.perRunCeiling". */
  path: string;
  /** Why it was rejected, in plain language. */
  message: string;
}

/** The deterministic result of validating a contract value. `valid` is true
 *  iff `violations` is empty. Consumers must treat an invalid value as
 *  unusable - there is no "valid enough" state. */
export interface ContractValidationResult {
  valid: boolean;
  violations: ContractViolation[];
}

/** Build a passing result. */
export function contractOk(): ContractValidationResult {
  return { valid: true, violations: [] };
}

/** Build a result from a collected list of violations. */
export function contractResult(violations: ContractViolation[]): ContractValidationResult {
  return { valid: violations.length === 0, violations };
}

/** A JSON-Schema document (draft-07 shaped). Kept as an opaque object here -
 *  the contract layer never executes schema validation itself; that is a
 *  runtime concern (A2 ToolGateway / A4 output validation). */
export type JsonSchema = Readonly<Record<string, unknown>>;

// ---- Pure field predicates (no I/O) --------------------------------------

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A number in the closed interval [0, 1]. Used for relevance/confidence. */
export function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** A finite number >= 0. Used for credit ceilings, limits, counts. */
export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A finite integer >= 0. */
export function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

/** Best-effort ISO-8601 timestamp check (shape only - not a calendar check). */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value);
}

/** A kebab/dotted identifier: lowercase letters, digits, `.`, `-`, `_`. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/.test(value);
}
