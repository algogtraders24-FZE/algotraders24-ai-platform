import type { IndicatorDefinition } from "../domain/indicator.js";
/**
 * Bollinger Bands.
 *
 * Formula: middle(t) = SMA(close, period); stddev = population standard
 * deviation of close[t-period+1..t] (divide by N, not N-1 — the
 * conventional choice for Bollinger Bands, matching common charting
 * platforms); upper = middle + mult*stddev; lower = middle - mult*stddev.
 * Inputs: close
 * Warmup: `period` bars
 * Output: multi { upper, middle, lower }
 * Edge cases: constant series -> stddev = 0 -> upper == middle == lower.
 */
export interface BollingerParams {
    readonly period: number;
    readonly stdDevMultiplier: number;
}
export interface BollingerOutput {
    readonly upper: number;
    readonly middle: number;
    readonly lower: number;
}
export interface BollingerState {
    readonly window: readonly number[];
}
export declare const bollinger: IndicatorDefinition<BollingerParams, BollingerState, BollingerOutput>;
