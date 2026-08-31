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

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export const rsi: IndicatorDefinition<RsiParams, RsiState, number> = {
  name: "RSI",
  version: "1.0.0",
  inputs: ["close"],
  outputShape: { kind: "single" },
  warmup: (params) => ({ bars: params.period + 1 }),
  createState: () => ({ prevClose: null, gainSum: 0, lossSum: 0, count: 0, avgGain: null, avgLoss: null }),
  next: (state, bar, params) => {
    if (state.prevClose === null) {
      return { output: null, state: { ...state, prevClose: bar.close } };
    }

    const change = bar.close - state.prevClose;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (state.avgGain !== null && state.avgLoss !== null) {
      const nextAvgGain = (state.avgGain * (params.period - 1) + gain) / params.period;
      const nextAvgLoss = (state.avgLoss * (params.period - 1) + loss) / params.period;
      return {
        output: rsiFromAverages(nextAvgGain, nextAvgLoss),
        state: { ...state, prevClose: bar.close, avgGain: nextAvgGain, avgLoss: nextAvgLoss },
      };
    }

    const count = state.count + 1;
    const gainSum = state.gainSum + gain;
    const lossSum = state.lossSum + loss;

    if (count < params.period) {
      return { output: null, state: { ...state, prevClose: bar.close, count, gainSum, lossSum } };
    }

    const avgGain = gainSum / params.period;
    const avgLoss = lossSum / params.period;
    return {
      output: rsiFromAverages(avgGain, avgLoss),
      state: { prevClose: bar.close, gainSum, lossSum, count, avgGain, avgLoss },
    };
  },
};
