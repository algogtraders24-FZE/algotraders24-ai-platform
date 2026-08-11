// services/intelligence/audit/audit-trace.service.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. Pure persistence + classification boundary for
// IntelligenceAuditTrace - not a reasoning engine, not a market-data or
// AI-presenter service. Every field it writes is either a direct,
// immutable copy of an already-real D2.5.x/D2.6.x value, or a real
// deterministic classification (traceResponseClaims,
// validateResponseIntegrity - both reused unmodified from D2.6.5/D2.6.9).
//
// HISTORICAL IMMUTABILITY (sprint §13): this service intentionally has
// NO update/delete method. Once a trace is created it is permanent - a
// later re-analysis creates a brand-new row via createTrace() again, it
// never rewrites this one. Viewing an old trace (getTrace) never
// recomputes anything - it returns the exact bytes written at creation
// time, describing what the system knew THEN.
import { prisma } from "@/lib/prisma";
import { RepositoryError } from "@/types/repository";
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { IntelligenceDecisionContext, DecisionState } from "@/types/intelligence-decision-context";
import type { IntelligenceQueryType } from "@/types/intelligence-query";
import type { ContextCompleteness } from "@/types/intelligence-query-context";
import type { PresenterOrchestrationResult } from "@/types/ai-presenter-orchestration";
import type { ResponseIntegrityResult } from "@/types/ai-response-integrity";
import type { AuditMarketDataProvenance, AuditPresenterTrace, ResponseClaimTrace, IntelligenceAuditTrace } from "@/types/intelligence-audit-trace";
import { INTELLIGENCE_AUDIT_TRACE_VERSION } from "@/types/intelligence-audit-trace";
import { validateResponseIntegrity } from "@/services/intelligence/chat/ai-response-integrity.service";
import { traceResponseClaims } from "@/services/intelligence/audit/response-claim-tracer.service";

export interface CreateAuditTraceInput {
  userId: string;
  conversationId?: string;
  analysisRunId?: string;
  envelope: IntelligenceEnvelope;
  decisionContext: IntelligenceDecisionContext;
  queryType: IntelligenceQueryType;
  completeness: ContextCompleteness;
  relevanceBasis: string[];
  missingContext: string[];
  marketData: AuditMarketDataProvenance;
  /** The D2.6.8 orchestrator's real result for this turn - text, presentedBy, attempts, fallbackUsed. */
  presented: PresenterOrchestrationResult;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RepositoryError({ code: "VALIDATION", entity: "IntelligenceAuditTrace", operation: "validate", message: `${field} must be a non-empty string` });
  }
  return value;
}

interface AuditTraceRow {
  id: string;
  userId: string;
  conversationId: string | null;
  analysisRunId: string | null;
  symbol: string;
  timeframe: string;
  queryType: string;
  completeness: string;
  decisionState: string;
  generatedAt: Date;
  intelligenceEngineVersion: string;
  pipelineVersion: string;
  marketData: unknown;
  envelopeSnapshot: unknown;
  decisionContextSnapshot: unknown;
  relevanceBasis: unknown;
  missingContext: unknown;
  presenterTrace: unknown;
  integrityResult: unknown;
  claimTrace: unknown;
  responseGeneratedAt: Date;
  createdAt: Date;
  version: string;
}

function toDomain(row: AuditTraceRow): IntelligenceAuditTrace {
  return {
    traceId: row.id,
    userId: row.userId,
    conversationId: row.conversationId ?? undefined,
    analysisRunId: row.analysisRunId ?? undefined,
    symbol: row.symbol as MarketSymbol,
    timeframe: row.timeframe as SignalTimeframe,
    queryType: row.queryType as IntelligenceQueryType,
    completeness: row.completeness as ContextCompleteness,
    decisionState: row.decisionState as DecisionState,
    generatedAt: row.generatedAt.toISOString(),
    intelligenceEngineVersion: row.intelligenceEngineVersion,
    pipelineVersion: row.pipelineVersion,
    marketData: row.marketData as AuditMarketDataProvenance,
    envelope: row.envelopeSnapshot as IntelligenceEnvelope,
    decisionContext: row.decisionContextSnapshot as IntelligenceDecisionContext,
    relevanceBasis: (row.relevanceBasis as string[] | null) ?? [],
    missingContext: (row.missingContext as string[] | null) ?? [],
    presenter: row.presenterTrace as AuditPresenterTrace,
    integrity: row.integrityResult as ResponseIntegrityResult,
    claimTrace: row.claimTrace as ResponseClaimTrace,
    responseGeneratedAt: row.responseGeneratedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    version: row.version,
  };
}

export class AuditTraceService {
  /**
   * Pure, deterministic: builds every real field of the trace EXCEPT the
   * persisted id/createdAt (which only exist once a row is actually
   * written). Sprint's own "same envelope + same presenter result ->
   * same audit classification" determinism requirement refers to THIS
   * method's output - traceId/createdAt are expected to differ per real
   * creation (§13, a new analysis always creates a new trace).
   */
  classify(input: CreateAuditTraceInput): Omit<IntelligenceAuditTrace, "traceId" | "createdAt"> {
    const claimTrace = traceResponseClaims(input.presented.text, input.envelope, input.decisionContext);
    // Re-validated here (not threaded through PresenterOrchestrationResult)
    // deliberately: it is the exact same pure, deterministic check the
    // orchestrator already ran against this exact final text before
    // returning it - re-running it costs nothing and needs no new field
    // on the D2.6.8 result type for the accepted-response case.
    const integrity = validateResponseIntegrity(input.presented.text, input.envelope, input.decisionContext);

    const selectedAttempt = input.presented.attempts.find((a) => a.provider === input.presented.presentedBy && a.success);
    const responseGeneratedAt = selectedAttempt?.timestamp ?? input.presented.envelopeGeneratedAt;

    const presenter: AuditPresenterTrace = {
      selectedProvider: input.presented.presentedBy,
      attempts: input.presented.attempts.map((a) => ({
        provider: a.provider,
        attempted: a.attempted,
        success: a.success,
        latencyMs: a.latencyMs,
        failureCategory: a.failureCategory,
        integrityPassed: a.integrityPassed,
        integrityViolationKinds: a.integrityViolationKinds,
        timestamp: a.timestamp,
      })),
      fallbackUsed: input.presented.fallbackUsed,
      responseGeneratedAt,
    };

    return {
      userId: input.userId,
      conversationId: input.conversationId,
      analysisRunId: input.analysisRunId,
      symbol: input.envelope.symbol,
      timeframe: input.envelope.timeframe,
      queryType: input.queryType,
      completeness: input.completeness,
      decisionState: input.decisionContext.state,
      generatedAt: input.envelope.generatedAt,
      intelligenceEngineVersion: input.envelope.intelligenceEngineVersion,
      pipelineVersion: input.envelope.pipelineVersion,
      marketData: input.marketData,
      envelope: input.envelope,
      decisionContext: input.decisionContext,
      relevanceBasis: input.relevanceBasis,
      missingContext: input.missingContext,
      presenter,
      integrity,
      claimTrace,
      responseGeneratedAt,
      version: INTELLIGENCE_AUDIT_TRACE_VERSION,
    };
  }

  /** Persists a real, immutable audit row. */
  async createTrace(input: CreateAuditTraceInput): Promise<IntelligenceAuditTrace> {
    const userId = assertNonEmpty(input.userId, "userId");
    const classified = this.classify({ ...input, userId });

    try {
      const row = await prisma.intelligenceAuditTrace.create({
        data: {
          userId,
          conversationId: classified.conversationId ?? undefined,
          analysisRunId: classified.analysisRunId ?? undefined,
          symbol: classified.symbol,
          timeframe: classified.timeframe,
          queryType: classified.queryType,
          completeness: classified.completeness,
          decisionState: classified.decisionState,
          generatedAt: new Date(classified.generatedAt),
          intelligenceEngineVersion: classified.intelligenceEngineVersion,
          pipelineVersion: classified.pipelineVersion,
          marketData: classified.marketData as object,
          envelopeSnapshot: classified.envelope as unknown as object,
          decisionContextSnapshot: classified.decisionContext as unknown as object,
          relevanceBasis: classified.relevanceBasis as unknown as object,
          missingContext: classified.missingContext as unknown as object,
          presenterTrace: classified.presenter as unknown as object,
          integrityResult: classified.integrity as unknown as object,
          claimTrace: classified.claimTrace as unknown as object,
          responseGeneratedAt: new Date(classified.responseGeneratedAt),
          version: classified.version,
        },
      });
      return toDomain(row as unknown as AuditTraceRow);
    } catch (cause) {
      throw new RepositoryError({ code: "UNKNOWN", entity: "IntelligenceAuditTrace", operation: "create", message: "Failed to create intelligence audit trace", cause });
    }
  }

  /** Ownership-scoped read - a stranger's request for another user's trace, a forged id, or a missing trace all resolve to null, never a distinct error that could leak existence. */
  async getTrace(traceId: string, userId: string): Promise<IntelligenceAuditTrace | null> {
    if (!traceId || !userId) return null;
    const row = await prisma.intelligenceAuditTrace.findFirst({ where: { id: traceId, userId } });
    return row ? toDomain(row as unknown as AuditTraceRow) : null;
  }
}
