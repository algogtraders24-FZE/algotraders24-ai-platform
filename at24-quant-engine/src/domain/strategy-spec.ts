import type { Instrument, Timeframe } from "./market-data.js";
import type { Expression } from "./expression.js";
import { validateExpression } from "./expression.js";
import type { RiskSpecification } from "./risk-specification.js";
import { validateRiskSpecification } from "./risk-specification.js";
import type { ExecutionSpecification } from "./execution-specification.js";
import type { OrderTypeIR } from "./strategy-ir/order-ir.js";
import type { PriceReference } from "./strategy-ir/price-reference.js";
import { validatePriceReference } from "./strategy-ir/price-reference.js";
import type { PendingOrderManagementPolicy } from "./pending-order-management-policy.js";
import { validatePendingOrderManagementPolicy } from "./pending-order-management-policy.js";
import type { PyramidingPolicy } from "./strategy-ir/position-ir.js";
import { type ValidationResult, ok, fail, combine } from "./validation-result.js";

export interface StrategyIdentity {
  readonly strategyId: string;
  readonly name: string;
}

export interface StrategyMetadata {
  readonly description?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
  readonly createdAt: number;
}

export type StrategyParameterType = "number" | "boolean" | "string";

export interface StrategyParameterDefinition {
  readonly key: string;
  readonly type: StrategyParameterType;
  readonly defaultValue: number | boolean | string;
  readonly min?: number;
  readonly max?: number;
}

/**
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): added
 * `executionType`, `limitPrice`, `stopPrice`, all optional.
 * `executionType` absent means MARKET (Q0's original, only-ever-supported
 * assumption, unchanged) — every EntryRule literal written before Q0.11
 * remains valid as-is. `limitPrice`/`stopPrice` are `PriceReference`s
 * (`domain/strategy-ir/price-reference.ts`), required together with the
 * matching `executionType` per `validateStrategySpec` below. See
 * docs/Q0.11_ORDER_SEMANTICS.md.
 */
export interface EntryRule {
  readonly id: string;
  readonly direction: "BUY" | "SELL";
  readonly condition: Expression;
  readonly executionType?: OrderTypeIR;
  readonly limitPrice?: PriceReference;
  readonly stopPrice?: PriceReference;
}

export interface ExitRule {
  readonly id: string;
  readonly condition: Expression;
  readonly appliesTo?: "BUY" | "SELL";
}

/**
 * Canonical, deterministic, machine-readable strategy representation
 * (Q0.2). This is the ONLY shape a strategy is allowed to be expressed in
 * across the Quant Engine — no natural-language strategy generation lives
 * here (that is a future AI layer that PRODUCES a StrategySpec, see
 * Q0.10 / ADR-004).
 */
export interface StrategySpec {
  readonly identity: StrategyIdentity;
  readonly version: string;
  readonly metadata: StrategyMetadata;
  readonly instruments: readonly Instrument[];
  readonly timeframes: readonly Timeframe[];
  readonly parameters: readonly StrategyParameterDefinition[];
  readonly entryRules: readonly EntryRule[];
  readonly exitRules: readonly ExitRule[];
  readonly risk: RiskSpecification;
  readonly execution: ExecutionSpecification;
  /** Q0.13 CONTRACT CHANGE (additive): compiled pending-order management rules (only ever FULLY PROVABLE ones — see `executableRules()` in pending-order-management-policy.ts). Absent means "no pending-order management behavior" — identical to every pre-Q0.13 StrategySpec. */
  readonly pendingOrderManagement?: PendingOrderManagementPolicy;
  /**
   * Q1.5.4 CONTRACT CHANGE (additive, backward-compatible): the compiled
   * pyramiding policy, passed through directly from
   * `StrategyIR.positionManagement.pyramiding` (never re-derived — a
   * single source of truth, same pattern as `risk`/`execution` below).
   * Absent means "no pyramiding" — identical to every pre-Q1.5 StrategySpec
   * (a single entry per position, exactly as the engine has always
   * behaved). When present with `allowPyramiding: true`, the decision
   * layer may admit additional same-direction ENTER decisions while a
   * position is open, bounded by `maxEntries` (see decision-builder.ts and
   * docs/Q1.5_PYRAMIDING_POLICY.md). Eligibility already guarantees
   * `sameDirectionBehavior === "ACCUMULATE"` for any IR that reaches
   * reduction with `allowPyramiding: true` (eligibility-gate.ts), so the
   * engine never needs to re-check it.
   */
  readonly pyramiding?: PyramidingPolicy;
}

const SEMVER_LIKE = /^\d+\.\d+\.\d+$/;

export function validateStrategyVersionString(version: string): ValidationResult {
  return SEMVER_LIKE.test(version)
    ? ok()
    : fail(`version must match MAJOR.MINOR.PATCH (e.g. "1.0.0"), got "${version}"`);
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

export function validateStrategySpec(spec: StrategySpec): ValidationResult {
  const results: ValidationResult[] = [];

  if (!spec.identity.strategyId.trim()) results.push(fail("identity.strategyId must not be empty"));
  if (!spec.identity.name.trim()) results.push(fail("identity.name must not be empty"));

  results.push(validateStrategyVersionString(spec.version));

  if (spec.instruments.length === 0) results.push(fail("instruments must contain at least one Instrument"));
  if (spec.timeframes.length === 0) results.push(fail("timeframes must contain at least one Timeframe"));
  if (spec.entryRules.length === 0) results.push(fail("entryRules must contain at least one EntryRule"));

  const paramKeyDupes = findDuplicates(spec.parameters.map((p) => p.key));
  if (paramKeyDupes.length > 0) results.push(fail(`duplicate parameter keys: ${paramKeyDupes.join(", ")}`));

  const entryIdDupes = findDuplicates(spec.entryRules.map((r) => r.id));
  if (entryIdDupes.length > 0) results.push(fail(`duplicate entryRule ids: ${entryIdDupes.join(", ")}`));

  const exitIdDupes = findDuplicates(spec.exitRules.map((r) => r.id));
  if (exitIdDupes.length > 0) results.push(fail(`duplicate exitRule ids: ${exitIdDupes.join(", ")}`));

  spec.entryRules.forEach((rule, i) => {
    results.push(validateExpression(rule.condition, `entryRules[${i}](${rule.id}).condition`));

    const executionType = rule.executionType ?? "MARKET";
    const path = `entryRules[${i}](${rule.id})`;
    const needsLimit = executionType === "LIMIT" || executionType === "STOP_LIMIT";
    const needsStop = executionType === "STOP" || executionType === "STOP_LIMIT";
    if (needsLimit && rule.limitPrice === undefined) results.push(fail(`${path}: executionType "${executionType}" requires limitPrice`));
    if (needsStop && rule.stopPrice === undefined) results.push(fail(`${path}: executionType "${executionType}" requires stopPrice`));
    if (!needsLimit && rule.limitPrice !== undefined) results.push(fail(`${path}: limitPrice is only valid for LIMIT/STOP_LIMIT, got executionType "${executionType}"`));
    if (!needsStop && rule.stopPrice !== undefined) results.push(fail(`${path}: stopPrice is only valid for STOP/STOP_LIMIT, got executionType "${executionType}"`));
    if (rule.limitPrice !== undefined) results.push(validatePriceReference(rule.limitPrice, `${path}.limitPrice`));
    if (rule.stopPrice !== undefined) results.push(validatePriceReference(rule.stopPrice, `${path}.stopPrice`));
  });
  spec.exitRules.forEach((rule, i) => {
    results.push(validateExpression(rule.condition, `exitRules[${i}](${rule.id}).condition`));
  });

  spec.parameters.forEach((param) => {
    if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
      results.push(fail(`parameter "${param.key}": min must be <= max`));
    }
  });

  results.push(validateRiskSpecification(spec.risk));
  if (spec.pendingOrderManagement) results.push(validatePendingOrderManagementPolicy(spec.pendingOrderManagement));

  return combine(...results);
}
