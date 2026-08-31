import type { Signal } from "./signal.js";

export type DecisionAction = "ENTER" | "EXIT" | "HOLD" | "REJECT";

export interface EvaluatedCondition {
  readonly ruleId: string;
  readonly result: boolean;
}

/**
 * DecisionContext carries the strategy's reasoning for why an action was (or
 * was not) taken. This is deliberately NOT a confidence score or trust
 * signal — Decision != Trust (see ADR-004 / Q0.10 AI boundary).
 */
export interface DecisionContext {
  readonly reason: string;
  readonly evaluatedConditions: readonly EvaluatedCondition[];
}

export interface Decision {
  readonly action: DecisionAction;
  readonly signal: Signal;
  readonly context: DecisionContext;
  readonly decidedAt: number;
}
