import type { RiskConstraintResult, RiskViolation } from "../../domain/risk-evaluation.js";
type Direction = "BUY" | "SELL";
/**
 * BUY: SL below entry, TP above entry. SELL: SL above entry, TP below
 * entry. Equal entry/SL or entry/TP counts as invalid (a >=/<=, not a
 * strict >/<, comparison — "equal" is not "below"/"above"). Missing SL or
 * TP is not itself an error (both are optional overall); geometry is
 * only checked for whichever of the two is actually provided. `direction`
 * being anything other than "BUY"/"SELL" is prevented by the type system
 * at compile time, so no runtime "invalid direction" branch exists here.
 */
export declare function validateEntryGeometry(direction: Direction, entryPrice: number, stopLoss: number | undefined, takeProfit: number | undefined): readonly RiskViolation[];
/** BUY: entry - stop. SELL: stop - entry. Positive by construction for a valid risk. */
export declare function computeRiskDistance(direction: Direction, entryPrice: number, stopLoss: number): number;
export declare function validateRiskDistance(direction: Direction, entryPrice: number, stopLoss: number): RiskConstraintResult;
export {};
