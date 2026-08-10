// services/intelligence/query/intelligence-query-context.service.ts
// Sprint D2.6.2 - Real-Time Intelligence Query & Context Orchestration.
// The final assembly step: IntelligenceQuery -> IntelligenceContextRequest
// -> IntelligenceQueryContext. Selects only the RELEVANT slice of an
// already-assembled IntelligenceDecisionContext (D2.6.1) - never passes
// the whole envelope through unfiltered, never recomputes MarketState/
// Regime/Hypothesis/Evidence/Risk/HistoricalValidation/IntelligenceScore
// itself. Evidence ordering reuses the existing, unmodified
// EvidenceRankingService (15D.4) - no second ranking algorithm. No LLM,
// no network call beyond the real, authorization-checked
// AnalysisHistoryService lookup for prior-analysis questions.
import type { SignalTimeframe } from "@/types/signal";
import type { EvidenceItem } from "@/types/evidence";
import type { Hypothesis, PredictionWindow } from "@/types/intelligence-hypothesis";
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { IntelligenceQuery, IntelligenceQueryScope } from "@/types/intelligence-query";
import type { ConversationIntelligenceContext, IntelligenceContextRequest } from "@/types/intelligence-context-request";
import type { IntelligenceQueryContext, ContextCompleteness } from "@/types/intelligence-query-context";
import { EvidenceRankingService } from "@/services/ai/evidence/evidence-ranking.service";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { AnalysisHistoryService } from "@/services/intelligence/query/analysis-history.service";
import { MARKET_INTELLIGENCE_PIPELINE_VERSION } from "@/services/ai/market-intelligence-pipeline.service";

export const INTELLIGENCE_QUERY_ORCHESTRATION_VERSION = "1.0.0";

// Duplicated on purpose from hypothesis-outcome-evaluator.service.ts's
// own module-private TIMEFRAME_MS (not exported) - same small,
// documented duplication pattern already used in
// analysis-history.service.ts's toDomain(), rather than reaching into
// another sprint's module internals.
const TIMEFRAME_MS: Record<SignalTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function isWindowActive(window: PredictionWindow, decisionContextGeneratedAt: string, now: string): boolean {
  const dueAt = new Date(decisionContextGeneratedAt).getTime() + window.candles * TIMEFRAME_MS[window.timeframe];
  return new Date(now).getTime() < dueAt;
}

function dedupEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  const result: EvidenceItem[] = [];
  for (const item of items) {
    const key = `${item.type}|${item.symbol}|${item.claim}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/** Pure mapping from requested scopes to explicit include* flags - "decision-context" implies every other scope (a caller asking for the full context gets the full context, explicitly, not by omission). No hidden implicit gathering: a flag not set here is never silently included later. */
export function buildContextRequest(query: IntelligenceQuery): IntelligenceContextRequest {
  const scopes = new Set<IntelligenceQueryScope>(query.requestedScopes);
  const full = scopes.has("decision-context");
  return {
    query,
    symbol: query.symbol,
    timeframe: query.timeframe,
    scopes: [...scopes],
    includeCurrentState: full || scopes.has("market-state"),
    includeRegime: full || scopes.has("regime"),
    includeHypotheses: full || scopes.has("hypotheses"),
    includeEvidence: full || scopes.has("evidence"),
    includeConflicts: full || scopes.has("conflicts") || scopes.has("evidence"),
    includeRisk: full || scopes.has("risk"),
    includeHistoricalValidation: full || scopes.has("historical-validation"),
    includeScore: full || scopes.has("intelligence-score"),
    includeInvalidation: full || scopes.has("invalidation"),
    includeMonitoring: full || scopes.has("monitoring"),
    includeMissingInformation: full || scopes.has("missing-information"),
    requestedAt: query.requestedAt,
  };
}

// Scopes whose "satisfaction" is a real dataAvailable/status flag on
// DecisionContext, distinct from "the requested section simply exists as
// a (possibly empty) real answer" - see the spec's completeness rules.
function isScopeSatisfied(
  scope: IntelligenceQueryScope,
  decisionContext: IntelligenceDecisionContext | undefined,
): boolean {
  if (!decisionContext) return false;
  if (scope === "risk") return decisionContext.riskContext.dataAvailable;
  if (scope === "historical-validation") return decisionContext.historicalContext.status === "available";
  return true; // every other scope always has a real, honest (possibly empty) answer once a DecisionContext exists
}

export interface BuildIntelligenceQueryContextInput {
  query: IntelligenceQuery;
  /** The already-assembled envelope for the query's resolved symbol/timeframe, when one exists. This orchestrator never fetches market data or computes one itself. */
  envelope?: IntelligenceEnvelope;
  /** Optionally pre-built; when omitted and `envelope` is supplied, built internally via the real, unmodified DecisionContextService. */
  decisionContext?: IntelligenceDecisionContext;
  /** Session-derived, never client-supplied - required for any prior-analysis lookup. */
  userId: string;
  conversationContext?: ConversationIntelligenceContext;
  /** Caller-supplied "now", for prediction-window-activity checks and as the record's own generatedAt - never Date.now() internally. */
  generatedAt: string;
}

export class IntelligenceQueryContextService {
  private readonly rankingService: EvidenceRankingService;
  private readonly decisionContextService: DecisionContextService;
  private readonly analysisHistory: AnalysisHistoryService;

  constructor(deps?: {
    rankingService?: EvidenceRankingService;
    decisionContextService?: DecisionContextService;
    analysisHistory?: AnalysisHistoryService;
  }) {
    this.rankingService = deps?.rankingService ?? new EvidenceRankingService();
    this.decisionContextService = deps?.decisionContextService ?? new DecisionContextService();
    this.analysisHistory = deps?.analysisHistory ?? new AnalysisHistoryService();
  }

  async build(input: BuildIntelligenceQueryContextInput): Promise<IntelligenceQueryContext> {
    const request = buildContextRequest(input.query);
    const decisionContext = input.decisionContext ?? (input.envelope ? this.decisionContextService.build(input.envelope) : undefined);

    const relevanceBasis: string[] = [];
    const missingContext: string[] = [];

    for (const missing of input.query.missingContext) {
      missingContext.push(`${missing}: could not be resolved from the query, request context, or conversation context`);
    }
    if (!decisionContext) {
      missingContext.push("market-state: no verified envelope is available for the resolved symbol/timeframe");
    } else {
      relevanceBasis.push(`Same symbol as query (${decisionContext.symbol})`);
      if (input.query.timeframe) relevanceBasis.push(`Same timeframe as query (${decisionContext.timeframe})`);
    }

    // ---- Hypotheses: only those still within their real, stored prediction window. Selected from the
    // real, full Hypothesis[] on the envelope (not DecisionContext's deliberately narrower
    // DecisionHypothesisContext restatement) so downstream presenters see the complete D2.5.3 object. ----
    let selectedHypotheses: Hypothesis[] = [];
    if (request.includeHypotheses && decisionContext && input.envelope) {
      selectedHypotheses = input.envelope.hypotheses.filter((h) =>
        isWindowActive(h.statement.predictionWindow, decisionContext.generatedAt, input.generatedAt),
      );
      if (selectedHypotheses.length > 0) {
        relevanceBasis.push(`${selectedHypotheses.length} active (non-expired) hypothesis(es) for the current regime`);
      } else if (decisionContext.primaryHypotheses.length > 0) {
        missingContext.push("hypotheses: every generated hypothesis's prediction window has already closed");
      } else {
        missingContext.push(`hypotheses: none generated for regime "${decisionContext.regimeContext.regimeType}"`);
      }
    }

    // ---- Evidence: the real EvidenceBundle for this symbol (already same-symbol-scoped by
    // construction, D2.5.4/15D.4), deterministically ranked - never the hypothesis-derived
    // technical strings in DecisionContext.supportingEvidence/opposingEvidence, which are a
    // different, narrower D2.6.1 concept (see the spec's evidence-selection rationale). ----
    let selectedEvidence: EvidenceItem[] = [];
    if (request.includeEvidence && decisionContext) {
      const items = input.envelope?.evidence?.items ?? [];
      selectedEvidence = this.rankingService.rank(dedupEvidence(items));
      if (selectedEvidence.length > 0) {
        relevanceBasis.push(`${selectedEvidence.length} evidence item(s) for the same symbol, ranked by type priority and recency (EvidenceRankingService, 15D.4)`);
      } else {
        missingContext.push("evidence: no EvidenceBundle was supplied for this symbol");
      }
    }

    const selectedConflicts = request.includeConflicts && decisionContext ? decisionContext.unresolvedConflicts : [];
    if (request.includeConflicts && decisionContext) {
      if (selectedConflicts.length > 0) relevanceBasis.push(`${selectedConflicts.length} unresolved evidence conflict(s) preserved, never auto-resolved`);
    }

    const riskContext = request.includeRisk && decisionContext ? decisionContext.riskContext : undefined;
    if (request.includeRisk) {
      if (!riskContext?.dataAvailable) missingContext.push("risk: no RiskProfile was available for this analysis");
      else relevanceBasis.push("Risk context for the same symbol");
    }

    const historicalContext = request.includeHistoricalValidation && decisionContext ? decisionContext.historicalContext : undefined;
    if (request.includeHistoricalValidation) {
      if (historicalContext?.status !== "available") missingContext.push(`historical-validation: ${historicalContext?.status ?? "unavailable"}`);
      else relevanceBasis.push("Historical validation for the same symbol/timeframe/regime/hypothesis segment");
    }

    const intelligenceScore = request.includeScore && decisionContext ? decisionContext.intelligenceScore : undefined;
    if (request.includeScore && intelligenceScore) relevanceBasis.push("Intelligence Score for the current analysis, consumed unchanged from D2.5.5");

    // ---- Previous analysis: only when explicitly requested via conversation context, never guessed from question wording ----
    let previousAnalysis: IntelligenceQueryContext["previousAnalysis"];
    if (input.conversationContext?.previousAnalysisRunId) {
      const found = await this.analysisHistory.getAnalysisWithOutcomes(input.conversationContext.previousAnalysisRunId, input.userId);
      if (found) {
        previousAnalysis = found;
        relevanceBasis.push(`Previous analysis run ${found.analysisRun.id} explicitly referenced via conversation context`);
      } else {
        missingContext.push("previous-analysis: the referenced analysis run was not found, or does not belong to this user");
      }
    }

    const completeness = this.classifyCompleteness(input.query, decisionContext);

    return {
      query: input.query,
      decisionContext: request.scopes.includes("decision-context") ? decisionContext : undefined,
      selectedEvidence,
      selectedHypotheses,
      selectedConflicts,
      historicalContext,
      riskContext,
      intelligenceScore,
      previousAnalysis,
      completeness,
      relevanceBasis,
      missingContext,
      dataAsOf: decisionContext?.generatedAt,
      generatedAt: input.generatedAt,
      pipelineVersion: decisionContext?.pipelineVersion ?? MARKET_INTELLIGENCE_PIPELINE_VERSION,
      orchestrationVersion: INTELLIGENCE_QUERY_ORCHESTRATION_VERSION,
    };
  }

  private classifyCompleteness(query: IntelligenceQuery, decisionContext: IntelligenceDecisionContext | undefined): ContextCompleteness {
    if (!query.symbol || !decisionContext) return "insufficient";
    const allSatisfied = query.requestedScopes.every((scope) => isScopeSatisfied(scope, decisionContext));
    if (allSatisfied && query.timeframe) return "complete";
    return "partial";
  }
}
