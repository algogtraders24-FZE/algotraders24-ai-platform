import type { IndicatorDefinition } from "../domain/indicator.js";
/**
 * Average True Range, Wilder-smoothed.
 *
 * Formula: TR(t) = max(high-low, |high - prevClose|, |low - prevClose|);
 * TR(0) (no previous close) = high(0) - low(0); seed ATR = SMA of the
 * first `period` TR values; thereafter ATR(t) = (ATR(t-1) * (period-1) + TR(t)) / period.
 * Inputs: high, low, close
 * Warmup: `period` bars (TR is defined from the first bar; the seed ATR
 * becomes available once `period` TR values have been observed)
 * Output: single value, always >= 0
 * Edge cases: high == low == close every bar -> TR = 0 every bar -> ATR = 0.
 */
export interface AtrParams {
    readonly period: number;
}
export interface AtrState {
    readonly prevClose: number | null;
    readonly trWindow: readonly number[];
    readonly atr: number | null;
}
export declare const atr: IndicatorDefinition<AtrParams, AtrState, number>;
