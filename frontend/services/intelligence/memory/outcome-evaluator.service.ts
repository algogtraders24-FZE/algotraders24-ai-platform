// services/intelligence/memory/outcome-evaluator.service.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation. The
// "conservative evaluator" the sprint asks for: it only ever produces a
// status the recorded facts genuinely support, never an estimate.
//
// Why "validated"/"invalidated" are structurally unreachable this sprint:
// those verdicts require a falsifiable prediction to check against, and
// D2.5.1 explicitly does not implement the Hypothesis Engine that would
// produce one (see docs/architecture/D2.5.0-intelligence-engine-v2-spec.md
// §2.3/§2.6). So every run this evaluator processes has no hypothesis to
// validate - the only honest outcomes are:
//   - "pending"       - couldn't even gather the facts needed to evaluate
//                        yet (no price evidence at analysis time, or the
//                        current market snapshot is unavailable right now)
//   - "inconclusive"  - facts gathered (a real price-move figure may be
//                        recorded), but there's no prediction to validate
//                        or invalidate against
// Both real price-move calculation (a genuine, non-trivial fact) and the
// intentionally-conservative status logic live here, not in the
// persistence services - createOutcome() in
// analysis-outcome.service.ts has no opinion about what status is correct,
// it only enforces that a reason is always given.
//
// Not wired to any cron/scheduler in this sprint (none exists in this
// repository - services/backend/HealthService.ts's own audit confirms "No
// background job processor is running in this deployment"). This class's
// public methods are the callable boundary a future scheduled job (or a
// manual script, or a route) can invoke - building real cron
// infrastructure for a single evaluator method would be exactly the
// "unnecessary infrastructure" the sprint brief says to avoid.
import type { SnapshotProvider, MarketContextRequest } from "@/types/market-data-provider";
import { marketData } from "@/services/market-data/shared-instance";
import { IntelligenceAnalysisRunService } from "./analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "./analysis-outcome.service";
import type { IntelligenceAnalysisOutcome } from "@/types/intelligence-analysis-outcome";

export interface OutcomeEvaluatorDeps {
  snapshotProvider: SnapshotProvider;
  runs: IntelligenceAnalysisRunService;
  outcomes: IntelligenceAnalysisOutcomeService;
}

function extractPriceAtAnalysis(analysisResult: unknown): number | undefined {
  if (!analysisResult || typeof analysisResult !== "object") return undefined;
  const evidence = (analysisResult as { evidence?: { items?: unknown[] } }).evidence;
  const items = evidence?.items;
  if (!Array.isArray(items)) return undefined;
  const priceItem = items.find(
    (item): item is { type: string; magnitude?: number } =>
      typeof item === "object" && item !== null && (item as { type?: unknown }).type === "price",
  );
  return typeof priceItem?.magnitude === "number" ? priceItem.magnitude : undefined;
}

export class OutcomeEvaluatorService {
  private readonly snapshotProvider: SnapshotProvider;
  private readonly runs: IntelligenceAnalysisRunService;
  private readonly outcomes: IntelligenceAnalysisOutcomeService;

  constructor(deps?: Partial<OutcomeEvaluatorDeps>) {
    this.snapshotProvider = deps?.snapshotProvider ?? marketData;
    this.runs = deps?.runs ?? new IntelligenceAnalysisRunService();
    this.outcomes = deps?.outcomes ?? new IntelligenceAnalysisOutcomeService();
  }

  /** Evaluates one run and persists exactly one new outcome for it. Never throws for "insufficient data" - that's a real, expected outcome, not an error. */
  async evaluateRun(runId: string, userId: string): Promise<IntelligenceAnalysisOutcome> {
    const run = await this.runs.getAnalysisRun(runId, userId);
    if (!run) {
      throw new Error(`IntelligenceAnalysisRun ${runId} not found for this user`);
    }

    if (!run.analysisResult) {
      return this.outcomes.createOutcome({
        analysisRunId: run.id,
        hypothesisId: null,
        status: "pending",
        evaluatedAt: null,
        actualPriceMovePct: null,
        actualRegimeAfter: null,
        evaluationBasis:
          "No analysis snapshot was recorded for this run (the analysis produced no result to evaluate against).",
      });
    }

    const priceAtAnalysis = extractPriceAtAnalysis(run.analysisResult);

    const request: MarketContextRequest = { symbol: run.symbol };
    let currentPrice: number | undefined;
    try {
      const snapshot = await this.snapshotProvider.getSnapshot(request);
      currentPrice = snapshot.price;
    } catch {
      currentPrice = undefined;
    }

    if (priceAtAnalysis === undefined || currentPrice === undefined) {
      const reason =
        priceAtAnalysis === undefined
          ? "No price evidence was recorded at analysis time; price movement cannot be computed."
          : "The current market snapshot is unavailable right now; retry evaluation later.";
      return this.outcomes.createOutcome({
        analysisRunId: run.id,
        hypothesisId: null,
        status: "pending",
        evaluatedAt: null,
        actualPriceMovePct: null,
        actualRegimeAfter: null,
        evaluationBasis: reason,
      });
    }

    const actualPriceMovePct = ((currentPrice - priceAtAnalysis) / priceAtAnalysis) * 100;

    const outcome = await this.outcomes.createOutcome({
      analysisRunId: run.id,
      hypothesisId: null, // no Hypothesis Engine yet - see file header
      status: "inconclusive",
      evaluatedAt: new Date().toISOString(),
      actualPriceMovePct,
      actualRegimeAfter: null, // no Regime Engine yet - see file header
      evaluationBasis:
        "No hypothesis exists for this analysis run (the Hypothesis Engine is not yet implemented). " +
        "The real price movement since analysis was recorded, but there is no prediction to validate or invalidate against.",
    });

    await this.runs.markEvaluated(run.id, userId);
    return outcome;
  }

  /** Evaluates every run still awaiting evaluation for a user, oldest first. Returns one outcome per run processed. */
  async evaluatePendingRuns(userId: string, limit = 20): Promise<IntelligenceAnalysisOutcome[]> {
    const pending = await this.runs.listPendingEvaluationRuns(userId, limit);
    const results: IntelligenceAnalysisOutcome[] = [];
    for (const run of pending) {
      results.push(await this.evaluateRun(run.id, userId));
    }
    return results;
  }
}
