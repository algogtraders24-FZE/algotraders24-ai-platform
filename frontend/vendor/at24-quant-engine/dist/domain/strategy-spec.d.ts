import type { Instrument, Timeframe } from "./market-data.js";
import type { Expression } from "./expression.js";
import type { RiskSpecification } from "./risk-specification.js";
import type { ExecutionSpecification } from "./execution-specification.js";
import type { OrderTypeIR } from "./strategy-ir/order-ir.js";
import type { PriceReference } from "./strategy-ir/price-reference.js";
import type { PendingOrderManagementPolicy } from "./pending-order-management-policy.js";
import { type ValidationResult } from "./validation-result.js";
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
}
export declare function validateStrategyVersionString(version: string): ValidationResult;
export declare function validateStrategySpec(spec: StrategySpec): ValidationResult;
