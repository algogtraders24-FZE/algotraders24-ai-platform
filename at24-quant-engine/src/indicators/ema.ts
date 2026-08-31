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

export const ema: IndicatorDefinition<EmaParams, EmaState, number> = {
  name: "EMA",
  version: "1.0.0",
  inputs: ["close"],
  outputShape: { kind: "single" },
  warmup: (params) => ({ bars: params.period }),
  createState: () => ({ seedWindow: [], ema: null }),
  next: (state, bar, params) => {
    if (state.ema !== null) {
      const k = 2 / (params.period + 1);
      const nextEma = bar.close * k + state.ema * (1 - k);
      return { output: nextEma, state: { seedWindow: state.seedWindow, ema: nextEma } };
    }

    const seedWindow = [...state.seedWindow, bar.close];
    if (seedWindow.length < params.period) {
      return { output: null, state: { seedWindow, ema: null } };
    }
    const seed = seedWindow.reduce((a, b) => a + b, 0) / params.period;
    return { output: seed, state: { seedWindow, ema: seed } };
  },
};
