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

export const atr: IndicatorDefinition<AtrParams, AtrState, number> = {
  name: "ATR",
  version: "1.0.0",
  inputs: ["high", "low", "close"],
  outputShape: { kind: "single" },
  warmup: (params) => ({ bars: params.period }),
  createState: () => ({ prevClose: null, trWindow: [], atr: null }),
  next: (state, bar, params) => {
    const tr =
      state.prevClose === null
        ? bar.high - bar.low
        : Math.max(bar.high - bar.low, Math.abs(bar.high - state.prevClose), Math.abs(bar.low - state.prevClose));

    if (state.atr !== null) {
      const nextAtr = (state.atr * (params.period - 1) + tr) / params.period;
      return { output: nextAtr, state: { prevClose: bar.close, trWindow: state.trWindow, atr: nextAtr } };
    }

    const trWindow = [...state.trWindow, tr];
    if (trWindow.length < params.period) {
      return { output: null, state: { prevClose: bar.close, trWindow, atr: null } };
    }
    const seed = trWindow.reduce((a, b) => a + b, 0) / params.period;
    return { output: seed, state: { prevClose: bar.close, trWindow, atr: seed } };
  },
};
