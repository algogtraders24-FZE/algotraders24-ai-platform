import { type ValidationResult } from "./validation-result.js";
/**
 * Q0.2 CONTRACT CHANGE (rename, not a behavior change): this was named
 * `FillModel` in Q0. Renamed to `FillModelKind` to free the name `FillModel`
 * for the new behavioral interface in reality-models.ts (Q0.2.16) — this
 * type is the static "which fill assumption was configured" enum; the new
 * `FillModel` interface is the future "how a fill actually gets computed"
 * plug point. Same rationale applies to SlippageModel/SpreadModel below,
 * renamed to *Assumption for consistency with the already-existing
 * LatencyAssumption/MarginAssumption. See docs/Q0.2_CONTRACT_FREEZE.md.
 */
export type FillModelKind = "next-bar-open" | "current-bar-close" | "intrabar-touch";
export type SlippageAssumption = {
    readonly type: "fixed-points";
    readonly value: number;
} | {
    readonly type: "percent";
    readonly value: number;
};
export type SpreadAssumption = {
    readonly type: "fixed-points";
    readonly value: number;
};
/** A flat per-trade fee, distinct from the existing per-unit `commissionPerUnit`. */
export type FeeAssumption = {
    readonly type: "fixed-per-trade";
    readonly value: number;
};
export type LatencyAssumption = {
    readonly type: "fixed-ms";
    readonly value: number;
};
/** Which price a fill is measured against. */
export type PriceBasis = "bid" | "ask" | "mid";
export type MarginAssumption = {
    readonly leverage: number;
};
/**
 * Q0.2 CONTRACT CHANGE (additive, backward-compatible): added fee, latency,
 * priceBasis, marginAssumption, and costsExplicitlyZero. All optional; no
 * existing field changed meaning. See docs/Q0.2_CONTRACT_FREEZE.md.
 *
 * `costsExplicitlyZero`: set true to declare "yes, I really mean zero
 * spread/slippage/commission/fee" — required by
 * validateExecutionSpecification() whenever all four cost fields are
 * unset, so an omission can never be silently read as "assume zero cost"
 * (Q0.2.15 / Q0.2.19's hidden-execution-assumption failure mode).
 */
export interface ExecutionSpecification {
    readonly fillModel: FillModelKind;
    readonly slippage?: SlippageAssumption;
    readonly spread?: SpreadAssumption;
    readonly commissionPerUnit?: number;
    readonly fee?: FeeAssumption;
    readonly latency?: LatencyAssumption;
    readonly priceBasis?: PriceBasis;
    readonly marginAssumption?: MarginAssumption;
    readonly costsExplicitlyZero?: true;
}
export declare function validateExecutionSpecification(spec: ExecutionSpecification): ValidationResult;
