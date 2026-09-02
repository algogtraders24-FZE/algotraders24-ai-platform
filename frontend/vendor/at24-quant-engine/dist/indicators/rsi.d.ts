import type { IndicatorDefinition } from "../domain/indicator.js";
/**
 * Relative Strength Index, Wilder-smoothed.
 *
 * Formula: change = close(t) - close(t-1); gain = max(change, 0);
 * loss = max(-change, 0); seed avgGain/avgLoss = SMA of the first `period`
 * gains/losses; thereafter avg = (prevAvg * (period-1) + current) / period;
 * RS = avgGain / avgLoss; RSI = 100 - 100 / (1 + RS).
 * Inputs: close
 * Warmup: `period` + 1 bars (need `period` changes, which needs period+1 closes)
 * Output: single value, range [0, 100]
 * Edge cases: avgLoss = 0 and avgGain > 0 -> RSI = 100 (by definition, not
 * division by zero); avgLoss = 0 and avgGain = 0 (fully flat window) -> RSI
 * = 50, a deliberate, documented convention (no movement = neutral), not
 * left as NaN.
 */
export interface RsiParams {
    readonly period: number;
}
export interface RsiState {
    readonly prevClose: number | null;
    readonly gainSum: number;
    readonly lossSum: number;
    readonly count: number;
    readonly avgGain: number | null;
    readonly avgLoss: number | null;
}
export declare const rsi: IndicatorDefinition<RsiParams, RsiState, number>;
