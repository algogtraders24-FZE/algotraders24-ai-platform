import type { Instrument, OHLCVBar, Timeframe } from "../market-data.js";
import type { DataFidelityLevel } from "../data-fidelity.js";
import type { Signal } from "../signal.js";
import type { Decision } from "../decision.js";

export interface MarketBarPayload {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly bar: OHLCVBar;
  readonly dataFidelity: DataFidelityLevel;
  readonly datasetId: string;
}

/**
 * No AI confidence fields, no hidden platform-specific state (Q0.5.4) —
 * only what Q0's own Signal/Decision contracts already carry.
 * `marketStateRef` is a reference, not an embedded MarketState: the pair
 * (instrument, timeframe, asOf) uniquely identifies the evaluation point
 * within one deterministic simulation run, so there is no need to
 * duplicate the (potentially large) indicator-value map into every event.
 */
export interface StrategyCalculatedPayload {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyHash: string;
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly marketStateRef: { readonly asOf: number };
  readonly signal: Signal;
  readonly decision: Decision;
}
