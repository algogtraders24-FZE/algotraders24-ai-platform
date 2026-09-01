import type { TrailingStopRule } from "../../domain/risk-specification.js";
import type { PolicyEvaluation } from "./breakeven.js";
type Direction = "BUY" | "SELL";
/**
 * Trigger / Distance / Adjustment kept explicit and separate: once price
 * has moved `activation` in favor, the stop trails `distance` behind the
 * current price. The stop may only move in a risk-reducing direction and
 * must never move backward — if the naive computed trail is not strictly
 * better than the current stop, this returns `triggered: false` (not a
 * violation; simply nothing to do this call). No execution occurs here.
 */
export declare function evaluateTrailingStop(rule: TrailingStopRule, direction: Direction, entryPrice: number, currentPrice: number, currentStopLoss: number | undefined, currentAtr: number | undefined): PolicyEvaluation;
export {};
