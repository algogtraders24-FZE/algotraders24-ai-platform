import type { EntryRule, StrategySpec } from "../domain/strategy-spec.js";
import type { MarketState } from "../domain/market-state.js";
import type { Signal } from "../domain/signal.js";
import { evaluateExpression } from "./expression-evaluator.js";

/**
 * Deterministic rule evaluation only — this is NOT the backtest engine
 * (Q0.7 explicitly defers that). It exists to make Signal/Decision
 * lifecycle contracts exercisable and to give the determinism tests (Q0.8)
 * something concrete to run twice and compare.
 */
export function firstMatchingEntryRule(rules: readonly EntryRule[], state: MarketState): EntryRule | null {
  for (const rule of rules) {
    if (evaluateExpression(rule.condition, state)) return rule;
  }
  return null;
}

export function generateSignal(spec: StrategySpec, state: MarketState): Signal {
  const matched = firstMatchingEntryRule(spec.entryRules, state);
  return {
    direction: matched ? matched.direction : "FLAT",
    instrument: state.instrument,
    timeframe: state.timeframe,
    generatedAt: state.asOf,
    strategyId: spec.identity.strategyId,
    strategyVersion: spec.version,
    triggeredByRuleId: matched ? matched.id : null,
  };
}
