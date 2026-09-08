// types/publishing/common.ts
// AT24 Publishing Contract - shared contract primitives (Sprint P2.1).
//
// SCOPE: this file, and every file under types/publishing/, is a DECLARATIVE
// CONTRACT layer only. It defines shapes, closed vocabularies, deterministic
// state-transition tables and PURE validation predicates. It contains NO
// runtime behavior: no I/O, no database access, no network, no provider SDKs,
// no scheduling, no cron, no publishing execution. The runtime that consumes
// these contracts is built in later P2 sub-sprints under
// services/publishing/.
//
// DELIBERATELY SELF-CONTAINED: this module does NOT import from
// types/agent-framework/ (or anything under services/agent-framework/). The
// Publishing Contract must be usable, and the Agent Framework must be
// removable, without touching the other (Sprint P2.1 §17).
//
// See frontend/docs/publishing/P2.1_PUBLISHING_CONTRACT.md for the invariants
// these types encode.

/** A single, human-readable reason a contract value was rejected. Always
 *  states the field and why - never a bare code with no explanation. */
export interface ContractViolation {
  /** Dotted path to the offending field, e.g. "attempt.attemptNumber". */
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

// ---- Pure field predicates (no I/O) -------------------------------------

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** A finite integer >= 0. */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** A finite integer >= 1. Used for 1-based attempt numbers. */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

/** Best-effort ISO-8601 timestamp check (shape only - not a calendar check). */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}T/.test(value);
}

/** Lowercase slug: letters, digits and single hyphens, no leading/trailing
 *  hyphen. Mirrors services/ai/publishing/seo.service.ts#slugify output. */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** A lowercase 64-char hex string - the shape of a sha256 digest. The
 *  Publishing Contract fixes the CONTENT-HASH ALGORITHM as sha256/hex (see
 *  publish-input-contract.ts) so this is an exact-shape check, not a guess. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
