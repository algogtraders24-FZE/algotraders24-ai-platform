// types/intelligence-hypothesis-snapshot.ts
// Sprint D2.5.4 - Hypothesis Outcome & Historical Validation Engine.
//
// The complete, immutable, creation-time record of what the Intelligence
// Engine actually knew at the moment a hypothesis was generated: the real
// MarketState and Regime that produced it, and every Hypothesis that came
// out of them. Persisted verbatim on IntelligenceAnalysisRun.hypothesisSnapshot
// (Json). This is the "what the system actually knew at that moment, not
// what it thinks today" principle (D2.5.4 §4/§26) made concrete: a future
// evaluator reads this snapshot instead of ever recalculating MarketState/
// Regime/Hypothesis from today's live data.
import type { MarketState } from "./intelligence-market-state";
import type { Regime } from "./intelligence-regime";
import type { Hypothesis } from "./intelligence-hypothesis";

export interface HypothesisSnapshot {
  marketState: MarketState;
  regime: Regime;
  hypotheses: Hypothesis[];
  /** Real timestamp this snapshot was assembled - equal to the owning IntelligenceAnalysisRun's own createdAt in practice, duplicated here so the JSON blob is self-describing without a join. */
  capturedAt: string;
}
