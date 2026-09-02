import type { EntryRule, ExitRule, StrategySpec } from "../domain/strategy-spec.js";
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

/**
 * Q1.5.3 — the SIGNAL_EXIT counterpart to `firstMatchingEntryRule`,
 * reusing the exact same `evaluateExpression` (no second evaluator, per
 * Q1.5's own explicit constraint). `positionSide` filters by `appliesTo`
 * when a rule declares one (undefined `appliesTo` means "applies to
 * either side," matching `ExitIR.appliesTo`'s own optionality). Evaluated
 * against the SAME closed-bar `MarketState` shape entries use — no
 * separate, looser notion of "current state" exists for exits.
 */
export function firstMatchingExitRule(rules: readonly ExitRule[], positionSide: "BUY" | "SELL", state: MarketState): ExitRule | null {
  for (const rule of rules) {
    if (rule.appliesTo !== undefined && rule.appliesTo !== positionSide) continue;
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
