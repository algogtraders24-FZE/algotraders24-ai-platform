import type { IndicatorDefinition } from "../domain/indicator.js";
/**
 * Exponential Moving Average, SMA-seeded.
 *
 * Formula: seed = SMA(close[0..period-1]); EMA(t) = close[t] * k + EMA(t-1) * (1-k),
 * where k = 2 / (period + 1)
 * Inputs: close
 * Warmup: `period` bars (the seed bar itself is the first non-null output)
 * Output: single value
 * Edge cases: constant series -> EMA converges immediately to the constant
 * (seed = constant, and the recurrence keeps it there); period=1 -> k=1,
 * EMA(t) = close[t] every bar after the seed.
 */
export interface EmaParams {
    readonly period: number;
}
export interface EmaState {
    readonly seedWindow: readonly number[];
    readonly ema: number | null;
}
export declare const ema: IndicatorDefinition<EmaParams, EmaState, number>;
