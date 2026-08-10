// services/intelligence/query/analysis-history.service.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration.
// Deterministic retrieval boundary for prior IntelligenceAnalysisRun/
// Outcome (D2.5.1/D2.5.4), used to answer "was your earlier hypothesis
// correct?"-style questions (Example C). This file adds NEW query
// capability (filtering by symbol/timeframe/time-range) rather than
// modifying the frozen D2.5.1 services - IntelligenceAnalysisRunService/
// IntelligenceAnalysisOutcomeService remain byte-identical.
//
// SECURITY (sprint §15, mirrors services/ai/conversation-ownership
// .service.ts's established pattern): every lookup here is scoped by a
// caller-supplied, session-derived `userId` - never a client-supplied
// value trusted at face value, and never bypassable by supplying an
// arbitrary analysisRunId. A run that exists but belongs to a different
// user is indistinguishable from one that does not exist at all: both
// resolve to `null`/an empty result, never a distinct "forbidden".
import { prisma } from "@/lib/prisma";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { MarketIntelligenceResult } from "@/types/market-intelligence-result";
import type { HypothesisSnapshot } from "@/types/intelligence-hypothesis-snapshot";
import type { IntelligenceAnalysisRun, IntelligenceAnalysisRunEvaluationStatus } from "@/types/intelligence-analysis-run";
import type { IntelligenceAnalysisOutcome } from "@/types/intelligence-analysis-outcome";
import { IntelligenceAnalysisRunService } from "@/services/intelligence/memory/analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "@/services/intelligence/memory/analysis-outcome.service";
import type { PreviousAnalysisContext } from "@/types/intelligence-query-context";

export interface ListAnalysisRunsFilter {
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;
  /** Inclusive ISO timestamps. */
  from?: string;
  to?: string;
}

// Row shape matches AnalysisRunService's own internal mapping exactly -
// duplicated deliberately (that mapper is private/unexported) rather
// than reaching into D2.5.1's module internals.
interface AnalysisRunRow {
  id: string;
  userId: string;
  symbol: string;
  timeframe: string;
  pipelineVersion: string | null;
  analysisResult: unknown;
  regimeAtTime: unknown;
  hypothesisSnapshot: unknown;
  evaluationStatus: string;
  createdAt: Date;
}

function toDomain(row: AnalysisRunRow): IntelligenceAnalysisRun {
  return {
    id: row.id,
    userId: row.userId,
    symbol: row.symbol,
    timeframe: row.timeframe as SignalTimeframe,
    pipelineVersion: row.pipelineVersion,
    analysisResult: (row.analysisResult as MarketIntelligenceResult | null) ?? null,
    regimeAtTime: row.regimeAtTime ?? null,
    hypothesisSnapshot: (row.hypothesisSnapshot as HypothesisSnapshot | null) ?? null,
    evaluationStatus: row.evaluationStatus as IntelligenceAnalysisRunEvaluationStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export class AnalysisHistoryService {
  private readonly runs: IntelligenceAnalysisRunService;
  private readonly outcomes: IntelligenceAnalysisOutcomeService;

  constructor(deps?: { runs?: IntelligenceAnalysisRunService; outcomes?: IntelligenceAnalysisOutcomeService }) {
    this.runs = deps?.runs ?? new IntelligenceAnalysisRunService();
    this.outcomes = deps?.outcomes ?? new IntelligenceAnalysisOutcomeService();
  }

  /** Ownership-checked single-run lookup - delegates directly to D2.5.1's own already-scoped getAnalysisRun(). */
  async getOwnedAnalysisRun(analysisRunId: string, userId: string): Promise<IntelligenceAnalysisRun | null> {
    return this.runs.getAnalysisRun(analysisRunId, userId);
  }

  /** Real, authorized outcomes for a run - returns [] (never throws, never another user's data) if the run isn't owned by this user. */
  async getOwnedOutcomesForRun(analysisRunId: string, userId: string): Promise<IntelligenceAnalysisOutcome[]> {
    const owned = await this.getOwnedAnalysisRun(analysisRunId, userId);
    if (!owned) return [];
    return this.outcomes.getOutcomesForRun(analysisRunId);
  }

  /** Example C's flow in one call: the real prior run plus its real outcomes, or null if not found/not owned. */
  async getAnalysisWithOutcomes(analysisRunId: string, userId: string): Promise<PreviousAnalysisContext | null> {
    const analysisRun = await this.getOwnedAnalysisRun(analysisRunId, userId);
    if (!analysisRun) return null;
    const outcomes = await this.outcomes.getOutcomesForRun(analysisRunId);
    return { analysisRun, outcomes };
  }

  /**
   * New retrieval capability (not present on D2.5.1's own service):
   * lists a user's own analysis runs, optionally filtered by symbol/
   * timeframe/time-range. `userId` is always the WHERE clause's own
   * filter - never a post-hoc filter applied after an unscoped query.
   */
  async listRunsForUser(userId: string, filter: ListAnalysisRunsFilter = {}, limit = 20): Promise<IntelligenceAnalysisRun[]> {
    const rows = await prisma.intelligenceAnalysisRun.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(filter.symbol ? { symbol: filter.symbol } : {}),
        ...(filter.timeframe ? { timeframe: filter.timeframe } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: new Date(filter.from) } : {}),
                ...(filter.to ? { lte: new Date(filter.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => toDomain(row as unknown as AnalysisRunRow));
  }
}
