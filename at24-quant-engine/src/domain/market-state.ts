import type { Instrument, OHLCVBar, Timeframe } from "./market-data.js";

/**
 * MarketState is the evaluation-time snapshot the expression engine reads.
 * Indicator values are resolved elsewhere (a future indicator plugin layer)
 * and injected here keyed by indicatorKey() — the expression engine never
 * computes an indicator itself.
 *
 * Q0.2 CONTRACT CHANGE (additive, backward-compatible): added
 * `previousIndicatorValues`, the prior observation's resolved indicator
 * map. Required to evaluate cross_above/cross_below deterministically
 * without the evaluator carrying hidden history state (see
 * docs/Q0.2_CONTRACT_FREEZE.md). Absent/undefined means "no prior
 * observation available" (first observation / insufficient history),
 * which cross_above/cross_below treat as a defined `false`, not an error.
 */
export interface MarketState {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly asOf: number;
  readonly bars: readonly OHLCVBar[];
  readonly indicatorValues: ReadonlyMap<string, number | boolean>;
  readonly previousIndicatorValues?: ReadonlyMap<string, number | boolean>;
}
