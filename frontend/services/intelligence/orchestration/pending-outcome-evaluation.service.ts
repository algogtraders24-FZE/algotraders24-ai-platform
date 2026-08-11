// services/intelligence/orchestration/pending-outcome-evaluation.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// Sprint §6: "Expose a clean service boundary: evaluatePendingAnalysisRun()
// which can later be called by cron/worker/queue/lazy evaluation/admin
// process - but do not implement those infrastructures yet."
//
// HypothesisOutcomeEvaluatorService.evaluatePendingAnalysisRun() (D2.5.4,
// services/intelligence/hypothesis/hypothesis-outcome-evaluator.service.ts)
// already implements exactly this boundary - this file does not
// reimplement it, it only wires the real production market-data singleton
// as its required `timeSeriesProvider` dependency so a future caller
// (deliberately NOT built this sprint - no scheduler/cron/queue) has a
// single, real, ready-to-call function rather than needing to know how to
// construct the evaluator itself.
import { HypothesisOutcomeEvaluatorService } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { marketData } from "@/services/market-data/shared-instance";
import type { IntelligenceAnalysisOutcome } from "@/types/intelligence-analysis-outcome";

const evaluator = new HypothesisOutcomeEvaluatorService();

/**
 * Evaluates every one of a user's pending IntelligenceAnalysisRuns whose
 * hypothesis prediction window has closed, against real historical candles
 * from the shared MarketDataService singleton. Never invoked automatically
 * by this sprint - no cron, no worker, no queue. A future sprint decides
 * how/when this gets called; this function is that seam.
 */
export async function evaluatePendingAnalysisRunsForUser(userId: string, limit = 20): Promise<IntelligenceAnalysisOutcome[]> {
  return evaluator.evaluatePendingAnalysisRun(userId, { timeSeriesProvider: marketData }, limit);
}
