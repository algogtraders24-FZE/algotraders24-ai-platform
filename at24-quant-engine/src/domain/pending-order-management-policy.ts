import type { DistanceSpec } from "./risk-specification.js";
import type { SimulationOrderType } from "./simulation/order.js";
import { type ValidationResult, ok, fail, combine } from "./validation-result.js";

/**
 * Q0.13.4 — the Policy layer's own explicit vocabulary for "what
 * pending-order management behavior does this strategy declare",
 * DELIBERATELY separate from two neighboring contracts (Q0.13's own
 * critical "keep these layers separate" rule):
 *
 *   PendingOrderManagementPolicy  "what the strategy INTENDS to do"       (this file)
 *   OrderModificationIntent       "what the execution engine SHOULD do"  (domain/simulation/order-modification.ts, Q0.12, unmodified)
 *   applyOrderModification()      "HOW that intent changes an order"     (runtime/simulation/order-modification.ts, Q0.12, unmodified)
 *
 * A `PendingOrderManagementPolicy` is compiled (via
 * `runtime/simulation/pending-order-management.ts`'s pure evaluator, at
 * simulation time, one bar at a time) into a Q0.12 `OrderModificationIntent`
 * only once its condition genuinely holds against that bar's own data —
 * this file never constructs an `OrderModificationIntent` itself, and
 * never duplicates `OrderModificationType`'s vocabulary (it uses its own,
 * narrower, STRATEGY-INTENT-shaped operation union below).
 *
 * Also deliberately separate from Q0.10's `PositionManagementPolicy`
 * (`domain/position-management.ts`) — that policy describes managing an
 * OPEN POSITION's protective SL/TP (breakeven/trailing/partial-close/
 * max-holding), evaluated by Q0.3's frozen `evaluateRisk()`. This policy
 * describes managing a still-PENDING ORDER (modify its price/stop/limit/
 * expiration, or cancel it outright) — a `SimulationOrder`, never a
 * `Position`. The two never share a type, a validator, or an evaluator,
 * even where their vocabularies look alike (Q0.12.30/Q0.13.14).
 */

/**
 * Q0.13.5 — how a rule identifies which pending order(s) it applies to.
 * `provable: false` means the source's OWN targeting could not be
 * resolved to one of the structural shapes below (see
 * `domain/mql-importer/semantic-model.ts`'s `PendingOrderTargetSite` doc
 * comment for the exact scope boundary) — such a rule is NEVER included
 * in `executableRules()` below, and is never silently treated as "the
 * current order" (Q0.13's own explicit prohibition).
 */
export type OrderTargetKind = "SYMBOL" | "TICKET" | "UNKNOWN";

export interface OrderTargetSpec {
  readonly kind: OrderTargetKind;
  /** Narrows which pending order(s) of the target symbol this rule applies to — e.g. "only the BUY STOP". Absent means "any pending order matching the target". */
  readonly orderTypeFilter?: SimulationOrderType;
  readonly sideFilter?: "BUY" | "SELL";
  readonly provable: boolean;
  readonly sourceExpr?: string;
}

/**
 * Q0.13.8 — a condition is always ONE of these three shapes (or
 * genuinely absent). `provable: false` (the `UNKNOWN` kind always sets
 * this) means the rule can never fire at runtime — recorded for
 * provenance/audit, never guessed into a false "always true"/"always
 * false" default.
 */
export type ManagementConditionKind = "ALWAYS" | "ORDER_TYPE_FILTER" | "FAVORABLE_DISTANCE" | "UNKNOWN";

export interface ManagementCondition {
  readonly kind: ManagementConditionKind;
  readonly orderTypeConstant?: string;
  readonly distance?: DistanceSpec;
  readonly provable: boolean;
  readonly sourceExpr?: string;
}

/**
 * Q0.13.4/9 — the strategy-INTENT-shaped operation vocabulary. Every
 * distance here is expressed relative to the CURRENT bar's own close
 * (the only deterministic, lookahead-free reference this OHLCV-only
 * engine has) — never a live bid/ask (Q0.11.3's rule, unchanged).
 */
export type PendingOrderManagementOperation =
  | { readonly kind: "CANCEL_PENDING" }
  | { readonly kind: "MODIFY_STOP"; readonly newDistanceFromClose: DistanceSpec }
  | { readonly kind: "MODIFY_LIMIT"; readonly newDistanceFromClose: DistanceSpec }
  | { readonly kind: "MODIFY_EXPIRATION"; readonly maxBars: number }
  | { readonly kind: "UNKNOWN" };

export interface PendingOrderManagementSourceProvenance {
  readonly sourceLine: number;
  readonly sourceExpr: string;
  readonly sourceFunctionName: string;
}

export type PendingOrderManagementFidelity = "EXACT" | "APPROXIMATED" | "UNKNOWN";

export interface PendingOrderManagementRule {
  readonly id: string;
  readonly target: OrderTargetSpec;
  readonly condition: ManagementCondition;
  readonly operation: PendingOrderManagementOperation;
  readonly semanticFidelity: PendingOrderManagementFidelity;
  readonly sourceProvenance?: PendingOrderManagementSourceProvenance;
}

export interface PendingOrderManagementPolicy {
  readonly rules: readonly PendingOrderManagementRule[];
}

/**
 * Q0.13 — the ONE pending-order-type-constant mapping (MQL4 `OP_*` and,
 * since Q1.5.2, MQL5 `ORDER_TYPE_*`), shared by the IR compiler
 * (`ir-generator.ts`, which needs it to decide MODIFY_STOP vs MODIFY_LIMIT
 * when a rule's condition provably names the order's own type) and the
 * runtime evaluator (`runtime/simulation/pending-order-management.ts`,
 * which needs the identical mapping to check a rule's target/condition
 * against a real `SimulationOrder`'s own type at evaluation time) — a
 * single source of truth, never two drifting copies.
 *
 * Q1.5.2 (additive): added the four MQL5 `ORDER_TYPE_*` pending-order
 * constants, mapped consistently with their MQL4 `OP_*` equivalents. This
 * is the piece that makes `OrderGetInteger(ORDER_TYPE)` recognition
 * (`semantic-analyzer.ts`'s `resolveOrderTypeFilter`) actually executable
 * at runtime — recognizing the call alone is not sufficient; without an
 * entry here the resolved constant would fail this lookup and the rule
 * would silently never fire (see docs/Q1.5_ORDER_TYPE_SEMANTICS.md).
 * `ORDER_TYPE_BUY_STOP_LIMIT`/`ORDER_TYPE_SELL_STOP_LIMIT` (compound
 * stop-limit types) are deliberately NOT mapped — this value type has no
 * "STOP_LIMIT" case (mirrors MQL4's own `OP_BUY`/`OP_SELL` market orders
 * being absent here too) and adding one is out of Q1.5's scope.
 */
export const MQL_ORDER_TYPE_CONSTANT_MAP: Readonly<Record<string, { readonly orderType: "LIMIT" | "STOP"; readonly side: "BUY" | "SELL" }>> = {
  OP_BUYLIMIT: { orderType: "LIMIT", side: "BUY" },
  OP_SELLLIMIT: { orderType: "LIMIT", side: "SELL" },
  OP_BUYSTOP: { orderType: "STOP", side: "BUY" },
  OP_SELLSTOP: { orderType: "STOP", side: "SELL" },
  ORDER_TYPE_BUY_LIMIT: { orderType: "LIMIT", side: "BUY" },
  ORDER_TYPE_SELL_LIMIT: { orderType: "LIMIT", side: "SELL" },
  ORDER_TYPE_BUY_STOP: { orderType: "STOP", side: "BUY" },
  ORDER_TYPE_SELL_STOP: { orderType: "STOP", side: "SELL" },
};

export function hasPendingOrderManagement(policy: PendingOrderManagementPolicy | undefined): boolean {
  return (policy?.rules.length ?? 0) > 0;
}

/**
 * Q0.13.15 — the ONE gate a rule must pass before it may ever reach the
 * runtime evaluator: target, condition, AND operation must each be fully
 * provable. A rule failing any of these is EXCLUDED here, never executed
 * with a guessed/defaulted value (Q0.13's "never convert uncertain
 * source behavior into an executable approximation").
 */
export function executableRules(policy: PendingOrderManagementPolicy): readonly PendingOrderManagementRule[] {
  return policy.rules.filter((r) => r.target.provable && r.condition.provable && r.operation.kind !== "UNKNOWN");
}

function validateOrderTargetSpec(target: OrderTargetSpec, path: string): ValidationResult {
  if (target.provable && target.kind === "UNKNOWN") return fail(`${path}: target.provable is true but target.kind is "UNKNOWN" — an unresolved target must never be marked provable`);
  return ok();
}

function validateManagementCondition(condition: ManagementCondition, path: string): ValidationResult {
  const results: ValidationResult[] = [];
  if (condition.provable && condition.kind === "UNKNOWN") results.push(fail(`${path}: condition.provable is true but condition.kind is "UNKNOWN"`));
  if (condition.kind === "ORDER_TYPE_FILTER" && !condition.orderTypeConstant) results.push(fail(`${path}: ORDER_TYPE_FILTER condition requires orderTypeConstant`));
  if (condition.kind === "FAVORABLE_DISTANCE" && !condition.distance) results.push(fail(`${path}: FAVORABLE_DISTANCE condition requires distance`));
  return combine(...results);
}

/** Q0.13 — structural validation only, mirroring every prior sprint's domain/*.ts pattern (Q0.2/Q0.7/Q0.10). */
export function validatePendingOrderManagementPolicy(policy: PendingOrderManagementPolicy): ValidationResult {
  const results: ValidationResult[] = [];
  const ids = new Set<string>();
  policy.rules.forEach((rule, i) => {
    const path = `pendingOrderManagement.rules[${i}](${rule.id})`;
    if (!rule.id.trim()) results.push(fail(`${path}: id must not be empty`));
    if (ids.has(rule.id)) results.push(fail(`duplicate pendingOrderManagement rule id: "${rule.id}"`));
    ids.add(rule.id);
    results.push(validateOrderTargetSpec(rule.target, path));
    results.push(validateManagementCondition(rule.condition, path));
    if (rule.operation.kind === "MODIFY_EXPIRATION" && rule.operation.maxBars <= 0) {
      results.push(fail(`${path}: MODIFY_EXPIRATION.maxBars must be > 0`));
    }
  });
  return combine(...results);
}
