import type { RiskSpecification, BreakevenRule, TrailingStopRule, PartialCloseRule, MaxHoldingPeriodRule } from "./risk-specification.js";
import type { RiskEvaluationResult } from "./risk-evaluation.js";
/**
 * Q0.10.2 — the Policy layer's own explicit, named vocabulary for
 * "what management behavior does this strategy declare", separate from
 * `RiskSpecification`'s broader contract (sizing/entry-time constraints
 * live there too). Never a duplicate contract — every field here IS the
 * corresponding `RiskSpecification` field, unchanged, just grouped for
 * callers (the eligibility gate, the MQL importer, provenance/audit code)
 * that only care about post-entry position management.
 */
export interface PositionManagementPolicy {
    readonly breakeven?: BreakevenRule;
    readonly trailingStop?: TrailingStopRule;
    readonly partialClose?: PartialCloseRule;
    readonly maxHoldingPeriod?: MaxHoldingPeriodRule;
}
export declare function extractPositionManagementPolicy(spec: RiskSpecification): PositionManagementPolicy;
export declare function hasPositionManagement(policy: PositionManagementPolicy): boolean;
/**
 * Q0.10.2 — the Action/Execution boundary's own explicit, named
 * vocabulary. Each of these is a pure, immutable RECORD of a decision
 * `evaluateRisk()` (Q0.3, unmodified) already made — never a second
 * decision-making formula, never mutated after construction, and never
 * itself responsible for executing anything (`derivePositionManagementInstruction`
 * below only ever reads a `RiskEvaluationResult`, never calls
 * `evaluateRisk()` and never touches a `Position`).
 */
export interface StopAdjustment {
    readonly reason: "BREAKEVEN" | "TRAILING";
    readonly previousStopPrice?: number;
    readonly newStopPrice: number;
    readonly timestamp: number;
}
export interface PartialCloseInstruction {
    readonly closePercent: number;
    readonly timestamp: number;
}
export interface ForcedExitInstruction {
    readonly reasonCode: "MAX_HOLDING_PERIOD";
    readonly timestamp: number;
}
export type PositionManagementInstruction = {
    readonly kind: "STOP_ADJUSTMENT";
    readonly instruction: StopAdjustment;
} | {
    readonly kind: "PARTIAL_CLOSE";
    readonly instruction: PartialCloseInstruction;
} | {
    readonly kind: "FORCED_EXIT";
    readonly instruction: ForcedExitInstruction;
} | {
    readonly kind: "NONE";
};
/**
 * Pure mapping: `RiskEvaluationResult` (Q0.3's `evaluateRisk()` output,
 * already computed and unmodified) -> Q0.10's richer, explicitly-named
 * instruction vocabulary. Keeps Policy (`RiskSpecification`) ->
 * Evaluation (`evaluateRisk`) -> Action (`RiskAction`) -> this mapping
 * strictly separate layers (Q0.10.2/11) — this function never decides
 * anything itself, it only renames/restructures a decision already made.
 * `previousStopPrice` is supplied by the caller because `RiskAction`
 * itself carries no "before" value (Q0.3's own contract, unchanged).
 */
export declare function derivePositionManagementInstruction(result: RiskEvaluationResult, previousStopPrice?: number): PositionManagementInstruction;
