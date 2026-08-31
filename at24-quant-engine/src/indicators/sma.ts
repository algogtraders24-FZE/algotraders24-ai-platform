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

export const sma: IndicatorDefinition<SmaParams, SmaState, number> = {
  name: "SMA",
  version: "1.0.0",
  inputs: ["close"],
  outputShape: { kind: "single" },
  warmup: (params) => ({ bars: params.period }),
  createState: () => ({ window: [] }),
  next: (state, bar, params) => {
    const window = [...state.window, bar.close].slice(-params.period);
    if (window.length < params.period) {
      return { output: null, state: { window } };
    }
    const sum = window.reduce((a, b) => a + b, 0);
    return { output: sum / params.period, state: { window } };
  },
};
