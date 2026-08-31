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

export const bollinger: IndicatorDefinition<BollingerParams, BollingerState, BollingerOutput> = {
  name: "BOLLINGER",
  version: "1.0.0",
  inputs: ["close"],
  outputShape: { kind: "multi", fields: ["upper", "middle", "lower"] },
  warmup: (params) => ({ bars: params.period }),
  createState: () => ({ window: [] }),
  next: (state, bar, params) => {
    const window = [...state.window, bar.close].slice(-params.period);
    if (window.length < params.period) {
      return { output: null, state: { window } };
    }
    const middle = window.reduce((a, b) => a + b, 0) / params.period;
    const variance = window.reduce((acc, v) => acc + (v - middle) ** 2, 0) / params.period;
    const stddev = Math.sqrt(variance);
    return {
      output: {
        upper: middle + params.stdDevMultiplier * stddev,
        middle,
        lower: middle - params.stdDevMultiplier * stddev,
      },
      state: { window },
    };
  },
};
