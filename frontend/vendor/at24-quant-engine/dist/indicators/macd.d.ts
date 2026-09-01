import type { IndicatorDefinition } from "../domain/indicator.js";
import { type EmaState } from "./ema.js";
/**
 * Moving Average Convergence Divergence.
 *
 * Formula: line(t) = EMA(close, fast) - EMA(close, slow); signal(t) =
 * EMA(line, signalPeriod) [SMA-seeded, same convention as the standalone
 * EMA indicator]; histogram(t) = line(t) - signal(t).
 * Inputs: close
 * Warmup: slowPeriod + signalPeriod - 1 bars (the MACD line itself becomes
 * available once the slow EMA warms up at `slowPeriod`; the signal EMA
 * then needs `signalPeriod` consecutive line values to seed)
 * Output: multi { line, signal, histogram }
 * Edge cases: fastPeriod >= slowPeriod is not rejected here (structurally
 * still computable, just an unconventional configuration) — validation of
 * "sensible" parameter relationships is a StrategySpec-level concern, not
 * this indicator's.
 *
 * Composes the standalone `ema` indicator's step function internally
 * rather than reimplementing EMA smoothing, so MACD and EMA can never
 * silently diverge on the same math.
 */
export interface MacdParams {
    readonly fastPeriod: number;
    readonly slowPeriod: number;
    readonly signalPeriod: number;
}
export interface MacdOutput {
    readonly line: number;
    readonly signal: number;
    readonly histogram: number;
}
export interface MacdState {
    readonly fastState: EmaState;
    readonly slowState: EmaState;
    readonly signalSeedWindow: readonly number[];
    readonly signalEma: number | null;
}
export declare const macd: IndicatorDefinition<MacdParams, MacdState, MacdOutput>;
