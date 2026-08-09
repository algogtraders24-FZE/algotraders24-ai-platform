// types/intelligence-analysis-run.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation.
//
// Naming note: deliberately NOT named `AnalysisRun` - that name is already
// taken by types/analysis-run.ts, which tracks a single orchestration API
// call's lifecycle (pending/completed/unavailable/failed) for
// services/ai/analysis-run.service.ts and is unrelated to and untouched by
// this file. `IntelligenceAnalysisRun` is the new, durable Intelligence
// Memory record: a persisted snapshot of a completed deterministic
// analysis, kept so it can later be compared against what actually
// happened in the market. Same disambiguation discipline as
// types/market-analysis.ts vs types/market-analysis-orchestration.ts.
//
// Every optional field here is optional because the real data genuinely
// doesn't exist yet in this sprint (no Regime Engine) or in this specific
// run (e.g. a provider-unavailable analysis has no result to snapshot) -
// never because a value was estimated and then hidden behind an "optional"
// label. See services/intelligence/memory/analysis-run.service.ts for the
// persistence boundary that enforces this.
import type { MarketSymbol } from "./market";
import type { SignalTimeframe } from "./signal";
import type { MarketIntelligenceResult } from "./market-intelligence-result";

export type IntelligenceAnalysisRunEvaluationStatus = "pending" | "evaluated";

export interface IntelligenceAnalysisRun {
  id: string;
  userId: string;
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  /** From MarketIntelligenceResult.metadata.pipelineVersion when analysisResult exists; null otherwise. Never independently supplied. */
  pipelineVersion: string | null;
  /** The real, deterministic pipeline output (evidence/reasoning/risk/confidence) - zero AI-authored content. Null only when genuinely unavailable. */
  analysisResult: MarketIntelligenceResult | null;
  /**
   * Always null in D2.5.1 - no Regime Engine exists yet (confirmed by the
   * D2.5.0 architecture audit). Typed loosely (not a real Regime shape) so
   * a future sprint can populate it without a breaking type change here.
   */
  regimeAtTime: unknown | null;
  evaluationStatus: IntelligenceAnalysisRunEvaluationStatus;
  createdAt: string;
}
