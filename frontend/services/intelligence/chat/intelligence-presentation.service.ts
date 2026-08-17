// services/intelligence/chat/intelligence-presentation.service.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. The new single chat-facing entry point implementing the
// sprint's own required flow end to end:
//
//   User Question
//   -> IntelligenceChatContextService (D2.6.5/D2.6.7)
//   -> RealTimeIntelligenceService (D2.6.5, inside the above)
//   -> IntelligenceQueryContext (D2.6.2, inside the above)
//   -> AIPresenterOrchestrator (D2.6.8)
//   -> Integrity Validation (D2.6.5, inside the above)
//   -> Audit Trace (D2.6.9)
//   -> Response
//
// This is a thin COMPOSITION only - it calls existing, unmodified chat-
// facing services in sequence and hands their real outputs to
// AuditTraceService. It never imports a 15D/D2.5 internal engine or
// MarketDataService directly, preserving the same "route only imports
// the chat-facing layer" boundary D2.6.5 established and D2.6.7/D2.6.8
// each preserved in turn - this file, not the route, is now the layer
// the route calls.
//
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. present() now also builds the stable, trader-facing
// VerifiedAnswerResponse (types/verified-answer-response.ts) - a pure
// regrouping of the same envelope/decisionContext/marketData/presented
// values already computed above, never a second computation. This is
// what a future UI actually renders; the chat route no longer needs to
// hand-assemble its own narrower summary.
import type { ResolveChatIntelligenceInput } from "@/services/intelligence/chat/intelligence-chat-context.service";
import { IntelligenceChatContextService } from "@/services/intelligence/chat/intelligence-chat-context.service";
import { AIPresenterOrchestratorService } from "@/services/intelligence/chat/ai-presenter-orchestrator.service";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { AuditTraceService } from "@/services/intelligence/audit/audit-trace.service";
import { buildVerifiedAnswerResponse } from "@/services/intelligence/chat/verified-answer-response.service";
import { marketData as sharedMarketData } from "@/services/market-data/shared-instance";
import { computeReliability } from "@/services/market-data/provider-reliability.service";
import type { VerifiedRealTimeIntelligenceContext, DataQualityAssessment, CrossProviderValidationSummary } from "@/types/real-time-intelligence";
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { PresenterOrchestrationResult } from "@/types/ai-presenter-orchestration";
import type { AuditMarketDataProvenance } from "@/types/intelligence-audit-trace";
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";

export interface PresentIntelligenceInput extends ResolveChatIntelligenceInput {}

export interface PresentIntelligenceResult {
  context: VerifiedRealTimeIntelligenceContext;
  /** Present only when context.status === "resolved" - a clarification/insufficient-data turn never reaches the presenter. */
  presented?: PresenterOrchestrationResult;
  /** Present only when a trace was successfully persisted - best-effort, a write failure never breaks the response the trader already has. */
  auditTraceId?: string;
  /** Present only when context.status === "resolved" - the stable, trader-facing contract a UI renders. */
  verifiedAnswer?: VerifiedAnswerResponse;
}

export interface IntelligencePresentationDeps {
  chatContext?: IntelligenceChatContextService;
  presenterOrchestrator?: AIPresenterOrchestratorService;
  auditTrace?: AuditTraceService;
  decisionContextService?: DecisionContextService;
  clock?: { now(): number };
}

export class IntelligencePresentationService {
  private readonly chatContext: IntelligenceChatContextService;
  private readonly presenterOrchestrator: AIPresenterOrchestratorService;
  private readonly auditTrace: AuditTraceService;
  private readonly decisionContextService: DecisionContextService;
  private readonly clock: { now(): number };

  constructor(deps: IntelligencePresentationDeps = {}) {
    this.chatContext = deps.chatContext ?? new IntelligenceChatContextService();
    this.presenterOrchestrator = deps.presenterOrchestrator ?? new AIPresenterOrchestratorService();
    this.auditTrace = deps.auditTrace ?? new AuditTraceService();
    this.decisionContextService = deps.decisionContextService ?? new DecisionContextService();
    this.clock = deps.clock ?? { now: () => Date.now() };
  }

  async present(input: PresentIntelligenceInput): Promise<PresentIntelligenceResult> {
    const context = await this.chatContext.resolve(input);
    if (context.status !== "resolved" || !context.envelope || !context.dataQuality) {
      return { context };
    }
    const envelope: IntelligenceEnvelope = context.envelope;
    const dataQuality: DataQualityAssessment = context.dataQuality;

    // Sprint D2.8.11 - additive: populates decisionContext.microstructureEvidence
    // (confirms/contradicts/neutral/insufficient_evidence vs. the primary
    // hypothesis) only when context.microstructure is a real snapshot;
    // byte-identical to before this sprint otherwise. Computed BEFORE the
    // presenter call (Sprint D2.8.12 reorder) so the already-computed
    // relationship - not just raw numbers - can be handed to the
    // presenter, closing the D2.8.12 gap: the presenter previously only
    // ever saw raw microstructure evidence and had no access to D2.8.11's
    // own confirms/contradicts/neutral/insufficient_evidence conclusion.
    const decisionContext = this.decisionContextService.build(envelope, context.microstructure);
    // Sprint D2.8.8 - additive: `context.microstructure` (D2.8.7) is
    // undefined unless the caller opted in via `includeMicrostructure`.
    // Sprint D2.8.12 - additive: `decisionContext.microstructureEvidence`
    // (D2.8.11) is forwarded as a 4th argument so the presenter receives
    // the already-computed relationship, never recalculating it itself.
    // Both undefined -> byte-identical to pre-D2.8.12 behavior.
    const presented = await this.presenterOrchestrator.present(envelope, input.message, context.microstructure, decisionContext.microstructureEvidence);
    const marketData = this.buildMarketDataProvenance(envelope, dataQuality, context.crossProviderValidation);

    let auditTraceId: string | undefined;
    try {
      const trace = await this.auditTrace.createTrace({
        userId: input.userId,
        conversationId: input.conversationId,
        analysisRunId: context.analysisRunId,
        envelope,
        decisionContext,
        queryType: context.query.queryType,
        completeness: context.queryContext?.completeness ?? "insufficient",
        relevanceBasis: context.queryContext?.relevanceBasis ?? [],
        missingContext: context.queryContext?.missingContext ?? [],
        marketData,
        presented,
      });
      auditTraceId = trace.traceId;
    } catch {
      // Best-effort - matches D2.6.5/D2.6.7's own established persistence-
      // after-response posture: an audit-trace write failure must never
      // break the response the trader already has.
    }

    const verifiedAnswer = buildVerifiedAnswerResponse({
      answer: presented.text,
      envelope,
      decisionContext,
      dataQuality,
      presentedBy: presented.presentedBy,
      auditTraceId,
    });

    return { context, presented, auditTraceId, verifiedAnswer };
  }

  /**
   * Real market-data provenance only - never a second provider-health
   * system. Reliability is looked up from the existing, unmodified
   * shared MarketDataService singleton's own healthReport() (D2.3.S3/
   * D2.6.4), never a fresh tracker. See types/intelligence-audit-trace.ts's
   * header for why the pre-fallback attempt list is honestly scoped to a
   * boolean rather than a fabricated ordered list.
   */
  private buildMarketDataProvenance(envelope: IntelligenceEnvelope, dataQuality: DataQualityAssessment, crossProviderValidation?: CrossProviderValidationSummary): AuditMarketDataProvenance {
    const basis = [...dataQuality.basis];
    let reliability: AuditMarketDataProvenance["reliability"];
    if (dataQuality.provider) {
      const snapshot = sharedMarketData.healthReport().find((s) => s.provider === dataQuality.provider);
      if (snapshot) {
        reliability = computeReliability({
          provider: dataQuality.provider,
          symbol: envelope.symbol,
          capability: "quote",
          snapshot,
          available: true,
          nowMs: this.clock.now(),
        });
      }
    }
    if (dataQuality.fallbackUsed) {
      basis.push(
        "One or more earlier-priority providers failed before this one succeeded - the exact prior providers/failure categories are not captured per-request by this platform's market-data layer (documented scope boundary, see docs/architecture/D2.6.9-intelligence-audit-explainability-spec.md)",
      );
    }
    return {
      selectedProvider: dataQuality.provider,
      providerSymbol: dataQuality.providerSymbol,
      fallbackUsed: dataQuality.fallbackUsed ?? false,
      cached: dataQuality.cached ?? false,
      cacheAgeMs: dataQuality.cacheAgeMs,
      freshnessStatus: dataQuality.freshnessStatus,
      dataTimestamp: dataQuality.timestamp,
      reliability,
      crossProviderValidation: crossProviderValidation
        ? { status: crossProviderValidation.status, providers: crossProviderValidation.providers, basis: crossProviderValidation.basis }
        : undefined,
      basis,
    };
  }
}
