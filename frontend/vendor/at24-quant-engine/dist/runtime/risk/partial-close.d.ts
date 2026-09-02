import type { PartialCloseRule } from "../../domain/risk-specification.js";
import type { RiskViolation } from "../../domain/risk-evaluation.js";
type Direction = "BUY" | "SELL";
export interface PartialCloseEvaluation {
    readonly triggered: boolean;
    readonly closePercent?: number;
    readonly violation?: RiskViolation;
}
/**
 * One-time behavior (Q0.3.13's "start with the simplest deterministic
 * model"): once `alreadyTriggered` is true, this never re-triggers,
 * preventing repeated unintended partial closes. `closePercent` always
 * comes straight from a spec already validated by
 * validateRiskSpecification() (which enforces (0, 100]), so this can
 * never propose closing more than the position — no separate
 * "quantity exceeds position" check is needed here, the invariant is
 * guaranteed upstream at spec-validation time. Never executes anything;
 * only returns an instruction.
 */
export declare function evaluatePartialClose(rule: PartialCloseRule, direction: Direction, entryPrice: number, currentPrice: number, currentAtr: number | undefined, alreadyTriggered: boolean): PartialCloseEvaluation;
export {};
