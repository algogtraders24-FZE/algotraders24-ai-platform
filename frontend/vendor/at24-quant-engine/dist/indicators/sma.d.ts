import type { IndicatorDefinition } from "../domain/indicator.js";
/**
 * Simple Moving Average.
 *
 * Formula: SMA(t) = mean(close[t - period + 1 .. t])
 * Inputs: close
 * Warmup: `period` bars
 * Output: single value
 * Edge cases: constant series -> SMA equals the constant; period=1 -> SMA
 * equals close every bar.
 */
export interface SmaParams {
    readonly period: number;
}
export interface SmaState {
    readonly window: readonly number[];
}
export declare const sma: IndicatorDefinition<SmaParams, SmaState, number>;
