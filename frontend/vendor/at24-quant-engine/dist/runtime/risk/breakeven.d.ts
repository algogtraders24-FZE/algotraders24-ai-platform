import type { BreakevenRule } from "../../domain/risk-specification.js";
import type { RiskViolation } from "../../domain/risk-evaluation.js";
type Direction = "BUY" | "SELL";
export interface PolicyEvaluation {
    readonly triggered: boolean;
    readonly newStopPrice?: number;
    readonly violation?: RiskViolation;
}
/**
 * Simplest deterministic model (Q0.3.11): once price has moved `trigger`
 * in the position's favor, propose moving the stop to `entry +/- lockOffset`.
 * Like trailing (Q0.3.12), the proposed stop is only "triggered" if it is
 * actually risk-reducing relative to the current stop (never moves
 * backward) — a position with no stop yet is always improved by adding
 * one. This function only returns an instruction; it never mutates a
 * Position.
 */
export declare function evaluateBreakeven(rule: BreakevenRule, direction: Direction, entryPrice: number, currentPrice: number, currentAtr: number | undefined, currentStopLoss: number | undefined): PolicyEvaluation;
export {};
