// services/ai/market-analysis-orchestration.service.ts
// Sprint 15D.2 - First controlled Market Intelligence orchestration layer.
// Chains: request validation -> intent/prompt routing (the dormant
// scaffold, activated via resolvePromptRouting from Sprint 15D.1) ->
// MarketContextService -> a bounded, non-fabricating AI prompt -> the
// canonical lib/ai AIService -> AnalysisRunService. Never touches Context
// Manager, RAG, embeddings, pgvector, the Gemini provider directly, or
// app/api/private/knowledge/chat/route.ts - those remain exactly as
// Sprint 15C left them.
//
// The AI dependency is typed as Pick<AIService, "complete"> rather than
// the concrete class: AIService's constructor parameters are private,
// which makes the class nominally typed in TypeScript - a plain fake
// object can never satisfy it structurally. Pick<> exposes only the one
// public method actually used here, so production code still defaults to
// the real canonical AIService (createAIService()), while a validation
// script can inject a network-free test double - the same
// controlled-test-double approach Sprint 15D.1 already established for
// MarketDataProvider, applied to the one other external dependency here.
//
// No real MarketDataProvider exists yet (Sprint 15D.1 scope), so with the
// default constructor arguments every real call today deterministically
// reaches the provider-unavailable outcome - by design, per the Sprint
// 15D locked rule against using mock market data in any production path.
import { createAIService, AIProviderError, type AIService } from "@/lib/ai";
import { resolvePromptRouting, type ResolvedPromptRouting } from "./prompts/resolve-routing.service";
import { MarketContextService } from "./market-context.service";
import { AnalysisRunService } from "./analysis-run.service";
import { MarketDataProviderUnavailableError } from "@/types/market-data-provider";
import type { MarketContext } from "@/types/market-context";
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
    private readonly marketContext: MarketContextService = new MarketContextService(),
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

    let context: MarketContext;
    try {
      context = await this.marketContext.getMarketContext({ symbol: validated.symbol });
    } catch (error) {
      const reason =
        error instanceof MarketDataProviderUnavailableError
          ? error.message
          : "Market data is currently unavailable.";
      const updated = await this.analysisRuns.markUnavailable(run.id, validated.userId, reason);
      return { status: "provider-unavailable", run: updated ?? run, reason };
    }

    const prompt = this.buildPrompt(validated, routing, context);

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
        symbol: context.symbol,
        intent: routing.intent,
        summary: completion.content,
        confidence: context.confidence,
        evidence: context.confidence.basis,
      };
      const updated = await this.analysisRuns.completeRun(run.id, validated.userId, context, completion.content);
      return { status: "completed", run: updated ?? run, result };
    } catch (error) {
      const message = error instanceof AIProviderError ? error.message : "The AI analysis could not be completed.";
      const updated = await this.analysisRuns.markFailed(run.id, validated.userId, message);
      return { status: "ai-failed", run: updated ?? run, message };
    }
  }

  // Deterministic, bounded prompt built ONLY from resolved routing and
  // whatever the MarketContext actually contains. Every field that has no
  // evidence is stated as explicitly unavailable - never guessed - and the
  // model is explicitly instructed not to invent values for it.
  private buildPrompt(
    request: MarketAnalysisRequest,
    routing: ResolvedPromptRouting,
    context: MarketContext,
  ): string {
    const lines: string[] = [];

    lines.push(routing.persona.systemRole);
    lines.push(routing.template);
    lines.push(`User question: ${request.question}`);
    lines.push(`Symbol: ${context.symbol}`);
    lines.push(`Trend: ${context.state.trend ?? "unavailable - do not assume a direction"}`);
    lines.push(`Volatility: ${context.state.volatility ?? "unavailable"}`);
    lines.push(`Liquidity: ${context.state.liquidity ?? "unavailable"}`);
    lines.push(`Technical summary: ${context.technical.summary ?? "unavailable"}`);
    lines.push(
      context.news.headlines.length > 0
        ? `Recent headlines: ${context.news.headlines.join("; ")}`
        : "Recent headlines: none available",
    );
    lines.push(`Risk level: ${context.risk.level ?? "unavailable"}`);
    if (context.risk.notes) lines.push(`Risk notes: ${context.risk.notes}`);
    lines.push(`Sentiment: ${context.sentiment ?? "unavailable"}`);
    lines.push(
      `Confidence in available data: ${context.confidence.score}/100 based on ${context.confidence.basis.length} evidence item(s).`,
    );

    lines.push("Evidence:");
    if (context.confidence.basis.length === 0) {
      lines.push("- None available. State clearly that this analysis is limited by data availability.");
    } else {
      for (const item of context.confidence.basis) {
        lines.push(`- ${item.claim} (source: ${item.source}, as of ${item.asOf})`);
      }
    }

    lines.push(`Respond using this structure: ${routing.schema.sections.join(", ")}.`);
    lines.push(
      "Explicitly state uncertainty wherever a field above is marked unavailable. " +
        "Never invent specific prices, directional bias, or headlines not present in the evidence above.",
    );

    const prompt = lines.join("\n");
    return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
  }
}
