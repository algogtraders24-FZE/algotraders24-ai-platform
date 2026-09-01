import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
export interface EligibilityCheck {
    readonly eligible: boolean;
    readonly blockingReasons: readonly string[];
}
/**
 * Q0.9.3/4 — a StrategyIR may reduce ONLY when every one of these holds.
 * Each check traces to a REAL, documented capability boundary of Q0.5's
 * frozen simulation engine (docs/Q0.5_*.md) or Q0.6's frozen fidelity
 * engine (docs/Q0.6_*.md) — never a guess about what "should" work.
 * Q0.9.4's rule is absolute: if a semantic difference COULD change a
 * trading outcome, it blocks; nothing here silently approximates.
 */
export declare function checkReductionEligibility(ir: StrategyIR): EligibilityCheck;
