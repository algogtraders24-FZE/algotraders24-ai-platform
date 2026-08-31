import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { StrategySpec } from "../../domain/strategy-spec.js";
import type { EntryRule } from "../../domain/strategy-spec.js";
import { validateStrategySpec } from "../../domain/strategy-spec.js";
import type { ReductionResult, ReductionSourceTraceEntry, ApproximationCategory } from "../../domain/reduction/reduction-result.js";
import type { PendingOrderManagementRuleIR } from "../../domain/strategy-ir/pending-order-management-ir.js";
import type { PendingOrderManagementRule } from "../../domain/pending-order-management-policy.js";
import { checkReductionEligibility } from "./eligibility-gate.js";

/**
 * Q0.13 — a direct structural passthrough (`OrderTargetIR`/
 * `ModificationConditionIR`/`PendingOrderManagementOperationIR` are
 * field-for-field identical to `OrderTargetSpec`/`ManagementCondition`/
 * `PendingOrderManagementOperation` by design — Q0.13.13's own "do not
 * duplicate" rule extends to keeping the two layers' SHAPES in lockstep,
 * not just their names), mirroring exactly how `ir.risk` passes through
 * to `strategySpec.risk` unchanged (Q0.9.17/18). Safety is NOT enforced
 * here — every rule (including a permanently-inert `semanticFidelity:
 * "UNKNOWN"` one) passes through for provenance visibility; the ONE
 * place a rule is ever actually allowed to fire is
 * `executableRules()`'s gate, consulted by the runtime evaluator at
 * simulation time (`runtime/simulation/pending-order-management.ts`).
 */
function toPendingOrderManagementRule(rule: PendingOrderManagementRuleIR): PendingOrderManagementRule {
  return {
    id: rule.id,
    target: rule.target,
    condition: rule.condition,
    operation: rule.operation,
    semanticFidelity: rule.semanticFidelity,
    ...(rule.sourceLine !== undefined && rule.sourceExpr !== undefined
      ? { sourceProvenance: { sourceLine: rule.sourceLine, sourceExpr: rule.sourceExpr, sourceFunctionName: rule.sourceExpr.replace(/\(.*$/, "") } }
      : {}),
  };
}

function blockedResult(diagnostics: readonly string[], unsupportedFeatures: readonly string[], approximations: readonly string[]): ReductionResult {
  return {
    status: "BLOCKED",
    diagnostics,
    semanticLoss: {
      lostFeatures: diagnostics,
      approximatedFeatures: approximations,
      unsupportedFeatures,
      executionImpact: diagnostics,
      severity: "BLOCKING",
    },
    unsupportedFeatures,
    approximations,
    sourceTrace: [],
  };
}

/**
 * Q0.9.1/2 — a PURE function: `ir` (and every object reachable from it —
 * risk, execution, entries, exits) is read only, never mutated, never
 * returned by reference into a mutable shape. Q0.9.3/4's eligibility gate
 * (`checkReductionEligibility`) runs first and unconditionally — if it
 * finds even one blocking reason, this function returns `status:
 * "BLOCKED"` with NO `strategySpec` at all (Q0.9.2: the reducer must not
 * invent missing behavior — a blocked reduction has nothing to hand back
 * except why).
 */
export function reduceStrategyIRToSpec(ir: StrategyIR): ReductionResult {
  const unsupportedFeatures = ir.provenance.unsupportedSemantics.map((u) => `[${u.severity}] ${u.feature}: ${u.reason}`);
  const approximations = ir.provenance.approximations.map((a) => `${a.feature}: ${a.original} -> ${a.replacement} (${a.difference})`);

  const { eligible, blockingReasons } = checkReductionEligibility(ir);
  if (!eligible) {
    return blockedResult(blockingReasons, unsupportedFeatures, approximations);
  }

  // --- Identity (Q0.9.5) ---
  const identity = { strategyId: ir.strategyId, name: ir.metadata.name };
  const metadata = {
    createdAt: ir.metadata.createdAt,
    ...(ir.metadata.description !== undefined ? { description: ir.metadata.description } : {}),
    ...(ir.metadata.author !== undefined ? { author: ir.metadata.author } : {}),
    ...(ir.metadata.tags !== undefined ? { tags: ir.metadata.tags } : {}),
  };

  // --- Entries (Q0.9.13) — eligibility already guaranteed BUY/SELL direction, NEXT_BAR_OPEN timing, non-atr-based sizing.
  // Q0.11 fix: `executionType`/`limitPrice`/`stopPrice` were previously silently dropped here — `EntryIR`
  // carried them but `EntryRule` had no field to receive them (a real information-loss point Q0.11's own
  // audit found; see docs/Q0.11_ORDER_SEMANTICS.md). Eligibility (checkReductionEligibility, below) already
  // guarantees a non-MARKET executionType has a resolvable, SUPPORTED price reference before reaching here. ---
  const entryRules: EntryRule[] = ir.entries.map((e) => ({
    id: e.id,
    direction: e.direction as "BUY" | "SELL",
    condition: e.condition,
    ...(e.executionType !== "MARKET" ? { executionType: e.executionType } : {}),
    ...(e.limitPrice !== undefined ? { limitPrice: e.limitPrice } : {}),
    ...(e.stopPrice !== undefined ? { stopPrice: e.stopPrice } : {}),
  }));

  // --- Exits (Q0.9.14) — eligibility already excluded SIGNAL_EXIT/SESSION_EXIT and unresolved SL/TP.
  // STOP_LOSS/TAKE_PROFIT/TIME_EXIT/RISK_EXIT are all risk-driven (Q0.3's
  // evaluateRisk()), never condition-based — StrategySpec.exitRules stays
  // empty; the actual price/duration values already live on `ir.risk`
  // (Q0.7.27's direct passthrough, see below), which IS what Q0.5
  // evaluates.
  const exitRules: StrategySpec["exitRules"] = [];

  const strategySpec: StrategySpec = {
    identity,
    version: ir.strategyVersion,
    metadata,
    instruments: ir.instruments,
    timeframes: ir.timeframes,
    parameters: ir.parameters,
    entryRules,
    exitRules,
    // Q0.9.17/18 — Q0.3's RiskSpecification, reused directly, never modified or duplicated.
    risk: ir.risk,
    // Q0.9.19 — Q0.2's ExecutionSpecification, reused directly (already validated upstream — no silent zero-cost assumption).
    execution: ir.execution.declared,
    // Q0.13 — direct structural passthrough, see toPendingOrderManagementRule's own doc comment.
    ...(ir.pendingOrderManagement && ir.pendingOrderManagement.rules.length > 0 ? { pendingOrderManagement: { rules: ir.pendingOrderManagement.rules.map(toPendingOrderManagementRule) } } : {}),
  };

  const specValidation = validateStrategySpec(strategySpec);
  if (!specValidation.valid) {
    // Q0.9.29 — a StrategySpec that fails Q0's OWN validator is never handed back as "reduced."
    return blockedResult(
      specValidation.errors.map((e) => `StrategySpec validation failed post-reduction: ${e}`),
      unsupportedFeatures,
      approximations,
    );
  }

  const sourceTrace: ReductionSourceTraceEntry[] = [
    { specField: "identity", irFeature: "strategyId/metadata.name" },
    { specField: "version", irFeature: "strategyVersion" },
    { specField: "instruments", irFeature: "instruments" },
    { specField: "timeframes", irFeature: "timeframes" },
    { specField: "parameters", irFeature: "parameters" },
    ...ir.entries.map((e) => ({ specField: `entryRules[${e.id}]`, irFeature: `entries[${e.id}]` })),
    { specField: "risk", irFeature: "risk (direct passthrough)" },
    { specField: "execution", irFeature: "execution.declared (direct passthrough)" },
    ...(ir.pendingOrderManagement && ir.pendingOrderManagement.rules.length > 0 ? [{ specField: "pendingOrderManagement", irFeature: "pendingOrderManagement (direct passthrough)" }] : []),
  ];

  const hasNonBlockingGaps = unsupportedFeatures.length > 0 || approximations.length > 0;
  const severity: ApproximationCategory = hasNonBlockingGaps ? "REVIEW_REQUIRED" : "SAFE";

  return {
    status: hasNonBlockingGaps ? "REDUCED_WITH_WARNINGS" : "REDUCED",
    strategySpec,
    diagnostics: [],
    semanticLoss: {
      lostFeatures: [],
      approximatedFeatures: approximations,
      unsupportedFeatures,
      executionImpact: hasNonBlockingGaps ? [...unsupportedFeatures, ...approximations] : [],
      severity,
    },
    unsupportedFeatures,
    approximations,
    sourceTrace,
  };
}
