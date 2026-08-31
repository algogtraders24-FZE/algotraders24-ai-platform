import type { IndicatorDefinition } from "../domain/indicator.js";
import { ema, type EmaState } from "./ema.js";

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

export const macd: IndicatorDefinition<MacdParams, MacdState, MacdOutput> = {
  name: "MACD",
  version: "1.0.0",
  inputs: ["close"],
  outputShape: { kind: "multi", fields: ["line", "signal", "histogram"] },
  warmup: (params) => ({ bars: params.slowPeriod + params.signalPeriod - 1 }),
  createState: () => ({
    fastState: ema.createState({ period: 0 }),
    slowState: ema.createState({ period: 0 }),
    signalSeedWindow: [],
    signalEma: null,
  }),
  next: (state, bar, params) => {
    const fastStep = ema.next(state.fastState, bar, { period: params.fastPeriod });
    const slowStep = ema.next(state.slowState, bar, { period: params.slowPeriod });

    if (fastStep.output === null || slowStep.output === null) {
      return {
        output: null,
        state: {
          fastState: fastStep.state,
          slowState: slowStep.state,
          signalSeedWindow: state.signalSeedWindow,
          signalEma: state.signalEma,
        },
      };
    }

    const line = fastStep.output - slowStep.output;

    if (state.signalEma !== null) {
      const k = 2 / (params.signalPeriod + 1);
      const nextSignal = line * k + state.signalEma * (1 - k);
      return {
        output: { line, signal: nextSignal, histogram: line - nextSignal },
        state: {
          fastState: fastStep.state,
          slowState: slowStep.state,
          signalSeedWindow: state.signalSeedWindow,
          signalEma: nextSignal,
        },
      };
    }

    const signalSeedWindow = [...state.signalSeedWindow, line];
    if (signalSeedWindow.length < params.signalPeriod) {
      return {
        output: null,
        state: { fastState: fastStep.state, slowState: slowStep.state, signalSeedWindow, signalEma: null },
      };
    }

    const seed = signalSeedWindow.reduce((a, b) => a + b, 0) / params.signalPeriod;
    return {
      output: { line, signal: seed, histogram: line - seed },
      state: { fastState: fastStep.state, slowState: slowStep.state, signalSeedWindow, signalEma: seed },
    };
  },
};
