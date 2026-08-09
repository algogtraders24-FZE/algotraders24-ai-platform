// services/intelligence/memory/analysis-outcome.service.ts
// Sprint D2.5.1 - Persistent Analysis & Outcome Foundation.
//
// Pure persistence boundary for IntelligenceAnalysisOutcome. Every outcome
// created here must carry a non-empty `evaluationBasis` - there is no path
// through this service that persists a status without an explicit reason,
// by construction (see createOutcome's validation). This service never
// decides what status to assign - that decision lives entirely in
// outcome-evaluator.service.ts; this file only persists whatever it's
// told, honestly.
import { prisma } from "@/lib/prisma";
import { RepositoryError } from "@/types/repository";
import type {
  IntelligenceAnalysisOutcome,
  IntelligenceAnalysisOutcomeStatus,
} from "@/types/intelligence-analysis-outcome";

export interface CreateIntelligenceAnalysisOutcomeInput {
  analysisRunId: string;
  hypothesisId: string | null;
  status: IntelligenceAnalysisOutcomeStatus;
  evaluatedAt: string | null;
  actualPriceMovePct: number | null;
  actualRegimeAfter: unknown | null;
  evaluationBasis: string;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RepositoryError({
      code: "VALIDATION",
      entity: "IntelligenceAnalysisOutcome",
      operation: "validate",
      message: `${field} must be a non-empty string`,
    });
  }
  return value;
}

interface AnalysisOutcomeRow {
  id: string;
  analysisRunId: string;
  hypothesisId: string | null;
  evaluatedAt: Date | null;
  status: string;
  actualPriceMovePct: number | null;
  actualRegimeAfter: unknown;
  evaluationBasis: string;
  createdAt: Date;
}

function toDomain(row: AnalysisOutcomeRow): IntelligenceAnalysisOutcome {
  return {
    id: row.id,
    analysisRunId: row.analysisRunId,
    hypothesisId: row.hypothesisId,
    evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
    status: row.status as IntelligenceAnalysisOutcomeStatus,
    actualPriceMovePct: row.actualPriceMovePct,
    actualRegimeAfter: row.actualRegimeAfter ?? null,
    evaluationBasis: row.evaluationBasis,
    createdAt: row.createdAt.toISOString(),
  };
}

export class IntelligenceAnalysisOutcomeService {
  async createOutcome(input: CreateIntelligenceAnalysisOutcomeInput): Promise<IntelligenceAnalysisOutcome> {
    const analysisRunId = assertNonEmpty(input.analysisRunId, "analysisRunId");
    // The one rule this service enforces unconditionally: no outcome without
    // a real, explicit reason for its status.
    const evaluationBasis = assertNonEmpty(input.evaluationBasis, "evaluationBasis");

    try {
      const row = await prisma.intelligenceAnalysisOutcome.create({
        data: {
          analysisRunId,
          hypothesisId: input.hypothesisId,
          status: input.status,
          evaluatedAt: input.evaluatedAt ? new Date(input.evaluatedAt) : null,
          actualPriceMovePct: input.actualPriceMovePct,
          actualRegimeAfter: (input.actualRegimeAfter as object | null) ?? undefined,
          evaluationBasis,
        },
      });
      return toDomain(row as unknown as AnalysisOutcomeRow);
    } catch (cause) {
      throw new RepositoryError({
        code: "UNKNOWN",
        entity: "IntelligenceAnalysisOutcome",
        operation: "create",
        message: "Failed to create intelligence analysis outcome",
        cause,
      });
    }
  }

  async getOutcomesForRun(analysisRunId: string): Promise<IntelligenceAnalysisOutcome[]> {
    const rows = await prisma.intelligenceAnalysisOutcome.findMany({
      where: { analysisRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => toDomain(row as unknown as AnalysisOutcomeRow));
  }

  async updateOutcomeStatus(
    id: string,
    patch: { status: IntelligenceAnalysisOutcomeStatus; evaluationBasis: string; evaluatedAt?: string | null; actualPriceMovePct?: number | null },
  ): Promise<IntelligenceAnalysisOutcome | null> {
    const evaluationBasis = assertNonEmpty(patch.evaluationBasis, "evaluationBasis");
    const existing = await prisma.intelligenceAnalysisOutcome.findUnique({ where: { id } });
    if (!existing) return null;

    const row = await prisma.intelligenceAnalysisOutcome.update({
      where: { id },
      data: {
        status: patch.status,
        evaluationBasis,
        evaluatedAt: patch.evaluatedAt !== undefined ? (patch.evaluatedAt ? new Date(patch.evaluatedAt) : null) : undefined,
        actualPriceMovePct: patch.actualPriceMovePct !== undefined ? patch.actualPriceMovePct : undefined,
      },
    });
    return toDomain(row as unknown as AnalysisOutcomeRow);
  }
}
