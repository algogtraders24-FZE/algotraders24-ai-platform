import type { OrderTypeIR } from "./order-ir.js";
import type { DistanceSpec } from "../risk-specification.js";

/**
 * Q0.13.13 — the IR-layer mirror of `domain/pending-order-management-policy.ts`'s
 * runtime-facing Policy shape. Sits at the SAME layer `EntryIR`/`OrderTypeIR`
 * already occupy: a platform-neutral, structural representation of what a
 * source strategy declares, BEFORE reduction into an executable
 * `StrategySpec`-level policy (`runtime/reduction/ir-to-spec-reducer.ts`).
 * Every field here is additive to `StrategyIR` (`strategy-ir.ts`'s
 * `pendingOrderManagement?` field) — an IR built before Q0.13 has this
 * field absent, never a defaulted/guessed value.
 *
 * Deliberately does NOT duplicate `Expression`/`OrderTypeIR`/
 * `SemanticFidelity`/`RiskSpecification`/`OrderModificationIntent`
 * (Q0.13.13's own rule) — `DistanceSpec` is Q0.2's existing generic
 * distance vocabulary (reused, not reinvented); `SemanticFidelity` reuses
 * the string literal union already defined in
 * `domain/pending-order-management-policy.ts` (imported there, not
 * redeclared here — see that file for the single source of truth).
 */
export interface OrderTargetIR {
  readonly kind: "SYMBOL" | "TICKET" | "UNKNOWN";
  readonly orderTypeFilter?: OrderTypeIR;
  readonly sideFilter?: "BUY" | "SELL";
  readonly provable: boolean;
  readonly sourceExpr?: string;
}

export interface ModificationConditionIR {
  readonly kind: "ALWAYS" | "ORDER_TYPE_FILTER" | "FAVORABLE_DISTANCE" | "UNKNOWN";
  readonly orderTypeConstant?: string;
  readonly distance?: DistanceSpec;
  readonly provable: boolean;
  readonly sourceExpr?: string;
}

export type PendingOrderManagementOperationIR =
  | { readonly kind: "CANCEL_PENDING" }
  | { readonly kind: "MODIFY_STOP"; readonly newDistanceFromClose: DistanceSpec }
  | { readonly kind: "MODIFY_LIMIT"; readonly newDistanceFromClose: DistanceSpec }
  | { readonly kind: "MODIFY_EXPIRATION"; readonly maxBars: number }
  | { readonly kind: "UNKNOWN" };

export interface PendingOrderManagementRuleIR {
  readonly id: string;
  readonly target: OrderTargetIR;
  readonly condition: ModificationConditionIR;
  readonly operation: PendingOrderManagementOperationIR;
  readonly semanticFidelity: "EXACT" | "APPROXIMATED" | "UNKNOWN";
  readonly sourceLine?: number;
  readonly sourceExpr?: string;
}

export interface PendingOrderManagementIR {
  readonly rules: readonly PendingOrderManagementRuleIR[];
}
