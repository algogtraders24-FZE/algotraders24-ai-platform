import type { OHLCVBar } from "./market-data.js";

export type IndicatorInputField = "open" | "high" | "low" | "close" | "volume";

export type IndicatorOutputShape =
  | { readonly kind: "single" }
  | { readonly kind: "multi"; readonly fields: readonly string[] };

/** Number of bars an indicator must observe before it can produce its first non-null output. */
export interface WarmupRequirement {
  readonly bars: number;
}

export type IndicatorVersion = string;

/**
 * IndicatorState is intentionally opaque here — each indicator module
 * defines its own concrete state shape (e.g. EMA's running average, RSI's
 * Wilder-smoothed gain/loss accumulators). The step function is the only
 * thing allowed to interpret it.
 */
export type IndicatorState = unknown;

export interface IndicatorStep<TOutput, TState extends IndicatorState> {
  readonly output: TOutput | null;
  readonly state: TState;
}

/**
 * The canonical indicator abstraction (Q0.2.3). Every indicator is a pure,
 * incremental step function: given its current state and the next bar, it
 * returns the new output (or null while still in warmup) and the new
 * state. Because `next()` only ever sees bars fed to it one at a time, in
 * order, it is structurally incapable of lookahead (Q0.2.5) — there is no
 * way for it to read a bar it hasn't been given yet.
 *
 * `calculateSeries()` (runtime/indicator-engine.ts) is a thin fold over
 * `next()` and is the only "batch" entry point — it is not a separate
 * implementation, so production and batch results can never diverge.
 */
export interface IndicatorDefinition<TParams, TState extends IndicatorState, TOutput> {
  readonly name: string;
  readonly version: IndicatorVersion;
  readonly inputs: readonly IndicatorInputField[];
  readonly outputShape: IndicatorOutputShape;
  warmup(params: TParams): WarmupRequirement;
  createState(params: TParams): TState;
  next(state: TState, bar: OHLCVBar, params: TParams): IndicatorStep<TOutput, TState>;
}
