import type { EntryRule, StrategySpec } from "../domain/strategy-spec.js";
import type { MarketState } from "../domain/market-state.js";
import type { Signal } from "../domain/signal.js";
/**
 * Deterministic rule evaluation only — this is NOT the backtest engine
 * (Q0.7 explicitly defers that). It exists to make Signal/Decision
 * lifecycle contracts exercisable and to give the determinism tests (Q0.8)
 * something concrete to run twice and compare.
 */
export declare function firstMatchingEntryRule(rules: readonly EntryRule[], state: MarketState): EntryRule | null;
export declare function generateSignal(spec: StrategySpec, state: MarketState): Signal;
