import type { StrategySpec } from "../strategy-spec.js";
/** Q0.9.1 — REDUCED_WITH_WARNINGS still produces an executable StrategySpec; BLOCKED never does. */
export type ReductionStatus = "REDUCED" | "REDUCED_WITH_WARNINGS" | "BLOCKED";
/** Q0.9.28 — SAFE (metadata-only), REVIEW_REQUIRED (non-executable informational), BLOCKING (affects trading outcome). */
export type ApproximationCategory = "SAFE" | "REVIEW_REQUIRED" | "BLOCKING";
/** Q0.9.27 — no hidden loss: every gap between IR and the reduced StrategySpec is named here. */
export interface SemanticLossReport {
    readonly lostFeatures: readonly string[];
    readonly approximatedFeatures: readonly string[];
    readonly unsupportedFeatures: readonly string[];
    readonly executionImpact: readonly string[];
    readonly severity: ApproximationCategory;
}
/** Q0.9.26 — one StrategySpec-shaped field traced back to the IR feature it came from. */
export interface ReductionSourceTraceEntry {
    readonly specField: string;
    readonly irFeature: string;
}
/**
 * Q0.9.1 — the reducer's own output. `strategySpec` is present iff
 * `status !== "BLOCKED"` — never a partially-built, partially-fabricated
 * spec (Q0.9.2's purity rule: the reducer never invents missing
 * behavior, so a BLOCKED reduction has literally nothing to hand back
 * except the reasons it stopped).
 */
export interface ReductionResult {
    readonly status: ReductionStatus;
    readonly strategySpec?: StrategySpec;
    readonly diagnostics: readonly string[];
    readonly semanticLoss: SemanticLossReport;
    readonly unsupportedFeatures: readonly string[];
    readonly approximations: readonly string[];
    readonly sourceTrace: readonly ReductionSourceTraceEntry[];
}
