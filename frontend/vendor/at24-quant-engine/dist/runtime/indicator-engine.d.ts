import type { IndicatorDefinition, IndicatorState } from "../domain/indicator.js";
import type { OHLCVBar } from "../domain/market-data.js";
/**
 * Folds `next()` over an ordered bar sequence. This is the ONLY batch
 * entry point — it does not reimplement any indicator math, so it cannot
 * diverge from the incremental (production) path.
 */
export declare function calculateSeries<TParams, TState extends IndicatorState, TOutput>(def: IndicatorDefinition<TParams, TState, TOutput>, bars: readonly OHLCVBar[], params: TParams): readonly (TOutput | null)[];
