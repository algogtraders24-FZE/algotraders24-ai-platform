// services/intelligence/memory/analysis-run.service.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation.
//
// Pure persistence boundary for IntelligenceAnalysisRun: create, read, and
// list runs awaiting evaluation. Deliberately does NOT call Gemini, does
// not orchestrate the 15D pipeline, and is not wired into
// market-analysis-orchestration.service.ts in this sprint - this is the
// storage capability only, callable by a future orchestrator once
// approved. userId is always caller-supplied and session-derived, never
// trusted from client input, mirroring the ownership convention used
// everywhere else in this project (see
// services/ai/conversation-ownership.service.ts).
//
// Naming: this is NOT the existing services/ai/analysis-run.service.ts
// (which tracks a single orchestration API call's pending/completed/
// unavailable/failed lifecycle in memory) - see
// types/intelligence-analysis-run.ts's header for the full disambiguation.
// That file is untouched by this sprint.
//
// Sprint D2.5.4 - additively extended (every D2.5.1 field/behavior above
// is unchanged - see the full D2.5.1 regression suite, still 20/20): both
// createAnalysisRun() and toDomain() now also carry an optional
// `hypothesisSnapshot` through. Passing none behaves byte-identical to
// D2.5.1.
import { prisma } from "@/lib/prisma";
import { RepositoryError } from "@/types/repository";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { MarketIntelligenceResult } from "@/types/market-intelligence-result";
import type { HypothesisSnapshot } from "@/types/intelligence-hypothesis-snapshot";
import type {
  IntelligenceAnalysisRun,
  IntelligenceAnalysisRunEvaluationStatus,
} from "@/types/intelligence-analysis-run";

export interface CreateIntelligenceAnalysisRunInput {
  userId: string;
  symbol: MarketSymbol;
  timeframe: SignalTimeframe;
  /** Null only when genuinely no result exists for this run (e.g. a provider-unavailable analysis). Never fabricated. */
  analysisResult: MarketIntelligenceResult | null;
  /** Sprint D2.5.4 - the real creation-time MarketState/Regime/Hypothesis[] snapshot. Optional/absent behaves identically to D2.5.1 (persists null). */
  hypothesisSnapshot?: HypothesisSnapshot | null;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RepositoryError({
      code: "VALIDATION",
      entity: "IntelligenceAnalysisRun",
      operation: "validate",
      message: `${field} must be a non-empty string`,
    });
  }
  return value;
}

// Prisma's generated row type for this model is structurally identical to
// this shape (Json fields come back as `unknown` from the client) - typed
// explicitly here rather than imported so this file has no direct
// dependency on the generated client's internal type names.
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

export class IntelligenceAnalysisRunService {
  async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
    const userId = assertNonEmpty(input.userId, "userId");
    const symbol = assertNonEmpty(input.symbol, "symbol");
    const timeframe = assertNonEmpty(input.timeframe, "timeframe");

    // pipelineVersion is derived from the real result, never independently
    // supplied - there is exactly one source of truth for it.
    const pipelineVersion = input.analysisResult?.metadata.pipelineVersion ?? null;

    try {
      const row = await prisma.intelligenceAnalysisRun.create({
        data: {
          userId,
          symbol,
          timeframe,
          pipelineVersion,
          // Prisma's Json input type doesn't accept `undefined` inside nested
          // structures cleanly - `?? null` keeps this an explicit, honest null.
          analysisResult: (input.analysisResult as object | null) ?? undefined,
          regimeAtTime: undefined, // always null in D2.5.1 - no Regime Engine yet
          hypothesisSnapshot: (input.hypothesisSnapshot as object | null | undefined) ?? undefined,
        },
      });
      return toDomain(row as unknown as AnalysisRunRow);
    } catch (cause) {
      throw new RepositoryError({
        code: "UNKNOWN",
        entity: "IntelligenceAnalysisRun",
        operation: "create",
        message: "Failed to create intelligence analysis run",
        cause,
      });
    }
  }

  async getAnalysisRun(id: string, userId: string): Promise<IntelligenceAnalysisRun | null> {
    const row = await prisma.intelligenceAnalysisRun.findFirst({
      where: { id, userId, deletedAt: null },
    });
    return row ? toDomain(row as unknown as AnalysisRunRow) : null;
  }

  /** Runs still awaiting a real evaluation attempt, oldest first - the evaluator's work queue. */
  async listPendingEvaluationRuns(userId: string, limit = 20): Promise<IntelligenceAnalysisRun[]> {
    const rows = await prisma.intelligenceAnalysisRun.findMany({
      where: { userId, evaluationStatus: "pending", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((row) => toDomain(row as unknown as AnalysisRunRow));
  }

  /** Flips a run to "evaluated" once a conclusive (non-pending) outcome has been recorded for it. */
  async markEvaluated(id: string, userId: string): Promise<IntelligenceAnalysisRun | null> {
    const existing = await this.getAnalysisRun(id, userId);
    if (!existing) return null;
    const row = await prisma.intelligenceAnalysisRun.update({
      where: { id },
      data: { evaluationStatus: "evaluated" },
    });
    return toDomain(row as unknown as AnalysisRunRow);
  }
}
