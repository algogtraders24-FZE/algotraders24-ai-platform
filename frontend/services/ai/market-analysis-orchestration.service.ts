// services/ai/market-analysis-orchestration.service.ts
// Sprint 15D.2 - First controlled Market Intelligence orchestration layer.
// Sprint 15D.10 - Rewired: request validation -> intent/prompt routing (the
// dormant scaffold, activated via resolvePromptRouting from Sprint 15D.1)
// -> MarketIntelligencePipelineService (Sprint 15D.8, itself chaining the
// unmodified Evidence/Reasoning/Risk/Confidence engines) ->
// ExplainableAnalysisService (Sprint 15D.9) -> a prompt built ONLY from
// that ExplainableAnalysis -> the canonical lib/ai AIService ->
// AnalysisRunService. MarketContextService is no longer used here (it was
// the 15D.1-era data path; the 15D.8 pipeline now owns market-data
// retrieval end to end) - it remains fully intact and independently
// validated for any other caller. Never touches Context Manager, RAG,
// embeddings, pgvector, the Gemini provider directly, or
// app/api/private/knowledge/chat/route.ts - those remain exactly as
// Sprint 15C left them.
//
// Gemini's role in this flow is deliberately narrow: buildPrompt() below
// passes it ONLY the already-computed, deterministic ExplainableAnalysis
// fields, with an explicit instruction to restate them in natural language
// and never perform new analysis or introduce a fact not already present.
// The AI dependency is typed as Pick<AIService, "complete"> rather than the
// concrete class: AIService's constructor parameters are private, which
// makes the class nominally typed in TypeScript - a plain fake object can
// never satisfy it structurally. Pick<> exposes only the one public method
// actually used here, so production code still defaults to the real
// canonical AIService (createAIService()), while a validation script can
// inject a network-free test double.
//
// `intelligencePipeline` defaults to `new MarketIntelligencePipelineService()`,
// which itself defaults its own `provider` argument to null - so with no
// provider injected anywhere, every real call today deterministically
// reaches the provider-unavailable outcome, exactly the same behavior (and
// the same locked rule against fabricated/unexpectedly-live market data in
// a default code path) this file already had before this sprint.
import { createAIService, AIProviderError, type AIService } from "@/lib/ai";
import { resolvePromptRouting, type ResolvedPromptRouting } from "./prompts/resolve-routing.service";
import { MarketIntelligencePipelineService } from "./market-intelligence-pipeline.service";
import { ExplainableAnalysisService } from "./explainable/explainable-analysis.service";
import { AnalysisRunService } from "./analysis-run.service";
import type { MarketIntelligenceResult } from "@/types/market-intelligence-result";
import type { ExplainableAnalysis } from "@/types/explainable-analysis";
import type { EvidenceItem } from "@/types/evidence";
import type { MarketContext, Evidence } from "@/types/market-context";
import type {
  MarketAnalysisRequest,
  MarketAnalysisResult,
  MarketAnalysisOutcome,
} from "@/types/market-analysis-orchestration";
import { RepositoryError } from "@/types/repository";

const MAX_PROMPT_CHARS = 6000;

export class MarketAnalysisOrchestrationService {
  // `ai` defaults to null, not createAIService(): a default *parameter*
  // value is evaluated eagerly the moment the constructor runs, which
  // would require a configured GEMINI_API_KEY just to instantiate this
  // class - even on the invalid-request/provider-unavailable paths that
  // never touch the AI at all. getAI() resolves the canonical AIService
  // lazily instead, only when a request has already cleared context
  // retrieval and genuinely needs it.
  constructor(
    private readonly intelligencePipeline: MarketIntelligencePipelineService = new MarketIntelligencePipelineService(),
    private readonly explainableAnalysis: ExplainableAnalysisService = new ExplainableAnalysisService(),
    private readonly analysisRuns: AnalysisRunService = new AnalysisRunService(),
    private readonly ai: Pick<AIService, "complete"> | null = null,
  ) {}

  private getAI(): Pick<AIService, "complete"> {
    return this.ai ?? createAIService();
  }

  private assertValidRequest(request: MarketAnalysisRequest): MarketAnalysisRequest {
    const fields: Array<[unknown, string]> = [
      [request?.userId, "userId"],
      [request?.symbol, "symbol"],
      [request?.question, "question"],
    ];
    for (const [value, field] of fields) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new RepositoryError({
          code: "VALIDATION",
          entity: "MarketAnalysisRequest",
          operation: "validate",
          message: `${field} must be a non-empty string`,
        });
      }
    }
    return request;
  }

  /**
   * Runs one market analysis request end to end. Never throws - every
   * failure mode (invalid input, no market data, AI failure) is returned
   * as an explicit MarketAnalysisOutcome variant, never disguised as a
   * completed analysis.
   */
  async analyze(request: MarketAnalysisRequest): Promise<MarketAnalysisOutcome> {
    let validated: MarketAnalysisRequest;
    try {
      validated = this.assertValidRequest(request);
    } catch (error) {
      const message = error instanceof RepositoryError ? error.message : "Invalid analysis request";
      return { status: "invalid-request", message };
    }

    // Request validated - only now does a persisted (in-memory, this
    // sprint) run begin. An invalid request never creates one.
    const routing = resolvePromptRouting(validated.question);
    const run = await this.analysisRuns.startRun(validated.userId, validated.symbol);

    const intelligenceOutcome = await this.intelligencePipeline.run({ symbol: validated.symbol });
    if (intelligenceOutcome.status === "provider-unavailable") {
      const updated = await this.analysisRuns.markUnavailable(run.id, validated.userId, intelligenceOutcome.reason);
      return { status: "provider-unavailable", run: updated ?? run, reason: intelligenceOutcome.reason };
    }
    if (intelligenceOutcome.status === "provider-error") {
      const updated = await this.analysisRuns.markFailed(run.id, validated.userId, intelligenceOutcome.reason);
      return { status: "provider-error", run: updated ?? run, reason: intelligenceOutcome.reason };
    }

    const intelligence = intelligenceOutcome.result;
    const explainable = this.explainableAnalysis.explain(intelligence);
    const prompt = this.buildPrompt(validated, routing, explainable);

    try {
      const completion = await this.getAI().complete(prompt);
      if (completion.content.trim().length === 0) {
        // An empty response is not a completed analysis - do not hide it
        // as a success with a blank summary.
        const updated = await this.analysisRuns.markFailed(
          run.id,
          validated.userId,
          "The AI returned an empty response.",
        );
        return { status: "ai-failed", run: updated ?? run, message: "The AI returned an empty response." };
      }

      const result: MarketAnalysisResult = {
        symbol: intelligence.symbol,
        intent: routing.intent,
        summary: completion.content,
        explainable,
        risk: intelligence.risk,
        confidence: intelligence.confidence,
      };
      const legacyContext = this.toAnalysisRunContext(intelligence, explainable);
      const updated = await this.analysisRuns.completeRun(run.id, validated.userId, legacyContext, completion.content);
      return { status: "completed", run: updated ?? run, result };
    } catch (error) {
      const message = error instanceof AIProviderError ? error.message : "The AI analysis could not be completed.";
      const updated = await this.analysisRuns.markFailed(run.id, validated.userId, message);
      return { status: "ai-failed", run: updated ?? run, message };
    }
  }

  // Deterministic, bounded prompt built ONLY from the resolved routing and
  // the already-computed ExplainableAnalysis - never from raw evidence,
  // reasoning, risk, or confidence data directly. Gemini's only job here is
  // to phrase what it is given: it is explicitly told not to add, remove,
  // or contradict a single fact, and every section that states an absence
  // ("no thesis can be formed", "no assumptions were required") must be
  // carried through as-is, never smoothed over into invented content.
  private buildPrompt(
    request: MarketAnalysisRequest,
    routing: ResolvedPromptRouting,
    explainable: ExplainableAnalysis,
  ): string {
    const lines: string[] = [];

    lines.push(routing.persona.systemRole);
    lines.push(
      "You are given a fully-computed, deterministic market intelligence analysis below. " +
        "Your only task is to express it in clear, natural language for the user - you are a translator, not an analyst. " +
        "Do not add facts, prices, headlines, risk levels, or conclusions that are not explicitly present below. " +
        "Do not change the stated risk level, confidence level, or any evidence claim. " +
        "If a section below states that something is unavailable or could not be determined, say so plainly - never invent a substitute or perform new analysis to fill the gap.",
    );
    lines.push(`User question: ${request.question}`);
    lines.push(`Symbol: ${explainable.symbol}`);
    lines.push(`Executive summary: ${explainable.executiveSummary}`);
    lines.push(`Market thesis: ${explainable.marketThesis}`);

    lines.push("Supporting evidence:");
    lines.push(
      explainable.supportingEvidence.length > 0
        ? explainable.supportingEvidence.map((line) => `- ${line.text}`).join("\n")
        : "- None available.",
    );
    lines.push("Opposing evidence:");
    lines.push(
      explainable.opposingEvidence.length > 0
        ? explainable.opposingEvidence.map((line) => `- ${line.text}`).join("\n")
        : "- None available.",
    );
    lines.push("Unknown factors:");
    lines.push(explainable.unknownFactors.map((line) => `- ${line}`).join("\n"));
    lines.push("Assumptions:");
    lines.push(explainable.assumptions.map((line) => `- ${line}`).join("\n"));
    lines.push("Limitations:");
    lines.push(explainable.limitations.map((line) => `- ${line}`).join("\n"));
    lines.push(`Confidence summary: ${explainable.confidenceSummary}`);
    lines.push(`Risk summary: ${explainable.riskSummary}`);
    lines.push(`Recommendation basis: ${explainable.recommendationBasis}`);

    lines.push(`Respond using this structure: ${routing.schema.sections.join(", ")}.`);
    lines.push(
      "Restate the analysis above naturally and completely - never perform new reasoning, " +
        "never invent a price, direction, headline, or conclusion not already stated above.",
    );

    const prompt = lines.join("\n");
    return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
  }

  // Compatibility bridge for AnalysisRunService.completeRun(), whose
  // signature (and AnalysisRun.context: MarketContext | null) is
  // deliberately left unchanged by this sprint - AnalysisRunService is
  // independently validated by Sprint 15D.1's own suite and this sprint
  // does not touch it. Every field below is either a real value copied
  // down from the new pipeline's richer types, or stays undefined/empty
  // when nothing in the new pipeline computes an equivalent - never a
  // guessed value invented just to fill the older, narrower shape.
  private toAnalysisRunContext(intelligence: MarketIntelligenceResult, explainable: ExplainableAnalysis): MarketContext {
    const toEvidence = (items: readonly EvidenceItem[]): Evidence[] =>
      items.map((item) => ({ claim: item.claim, source: item.source, asOf: item.asOf }));
    const allEvidence = toEvidence(intelligence.evidence.items);
    const headlines = intelligence.evidence.items.filter((item) => item.type === "news").map((item) => item.claim);

    return {
      symbol: intelligence.symbol,
      // trend/volatility/liquidity: no equivalent typed signal exists in
      // the 15D.4-15D.8 pipeline output - left absent, never guessed.
      state: { symbol: intelligence.symbol, evidence: allEvidence },
      technical: { symbol: intelligence.symbol, summary: explainable.marketThesis, evidence: allEvidence },
      news: { symbol: intelligence.symbol, headlines, evidence: allEvidence },
      risk: {
        symbol: intelligence.symbol,
        level: intelligence.risk.overallLevel,
        notes: explainable.riskSummary,
        evidence: allEvidence,
      },
      confidence: { score: intelligence.confidence.overallScore, basis: toEvidence(intelligence.confidence.basis) },
      generatedAt: intelligence.metadata.generatedAt,
    };
  }
}
