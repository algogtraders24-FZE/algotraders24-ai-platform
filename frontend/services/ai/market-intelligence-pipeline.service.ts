// services/ai/market-intelligence-pipeline.service.ts
// Sprint 15D.8 - Intelligence Integration Pipeline. Pure orchestration:
// fetches one MarketContextResult from a MarketDataProvider, then chains it
// through the unmodified Sprint 15D.4-15D.7 engines in sequence -
// EvidenceCollectorService -> EvidenceRankingService -> ReasoningEngineService
// -> RiskEngineService -> ConfidenceEngineService - and assembles their
// outputs into one immutable MarketIntelligenceResult. No engine's logic is
// touched or reimplemented here; this file only sequences calls and shapes
// the envelope around their results.
//
// `provider` defaults to null, not a live AlphaVantageProvider: every other
// consumer of MarketDataProvider in this codebase (MarketContextService,
// MarketAnalysisOrchestrationService) makes the same deliberate choice, so
// a real call with no provider injected deterministically reaches
// "provider-unavailable" rather than silently starting to make live vendor
// calls - continuing the Sprint 15D locked rule against fabricated or
// unexpectedly-live market data in a default code path. A caller that wants
// real data injects a configured MarketDataProvider explicitly.
import type {
  MarketDataProvider,
  MarketContextResult,
} from "@/types/market-data-provider";
import { MarketDataProviderUnavailableError } from "@/types/market-data-provider";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { systemClock, type Clock } from "@/lib/market-data/cache";
import { EvidenceCollectorService } from "./evidence/evidence-collector.service";
import { EvidenceRankingService } from "./evidence/evidence-ranking.service";
import { ReasoningEngineService } from "./reasoning/reasoning-engine.service";
import { RiskEngineService } from "./risk/risk-engine.service";
import { ConfidenceEngineService } from "./confidence/confidence-engine.service";
import type {
  MarketIntelligenceRequest,
  MarketIntelligenceOutcome,
  MarketIntelligenceResult,
} from "@/types/market-intelligence-result";

// Bumped only when this pipeline's own stage composition changes (e.g. a
// stage is added/reordered) - not tied to any individual engine's version.
export const MARKET_INTELLIGENCE_PIPELINE_VERSION = "15D.8.0";

// Recursively freezes an object graph in place. Applied once, at the very
// end, to the assembled MarketIntelligenceResult - this freezes the
// engines' own output objects/arrays too (EvidenceBundle, ReasoningResult,
// RiskProfile, ConfidenceProfile and everything nested in them), but never
// mutates their *values*, and never touches the engine classes themselves.
// That satisfies "immutable output" without rewriting any engine's logic.
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export class MarketIntelligencePipelineService {
  constructor(
    private readonly provider: MarketDataProvider | null = null,
    private readonly evidenceCollector: EvidenceCollectorService = new EvidenceCollectorService(),
    private readonly evidenceRanking: EvidenceRankingService = new EvidenceRankingService(),
    private readonly reasoningEngine: ReasoningEngineService = new ReasoningEngineService(),
    private readonly riskEngine: RiskEngineService = new RiskEngineService(),
    private readonly confidenceEngine: ConfidenceEngineService = new ConfidenceEngineService(),
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Runs one market-intelligence pass end to end. Never disguises a
   * failure as a completed result: an unconfigured/unavailable provider or
   * a typed MarketDataProviderError is returned as an explicit outcome
   * variant. Any other, unexpected error is deliberately NOT caught here -
   * it propagates to the caller unmodified, so a genuine bug can never be
   * silently swallowed into a fake success ("failure propagation").
   */
  async run(request: MarketIntelligenceRequest): Promise<MarketIntelligenceOutcome> {
    const providerName = this.provider?.name ?? "none";
    const startedAtMs = this.clock.now();

    if (!this.provider || !this.provider.isConfigured()) {
      return {
        status: "provider-unavailable",
        symbol: request.symbol,
        provider: providerName,
        reason: `Market data provider "${providerName}" is not configured`,
      };
    }

    let raw: MarketContextResult;
    try {
      raw = await this.provider.getMarketContext({ symbol: request.symbol, asOf: request.asOf });
    } catch (error) {
      if (error instanceof MarketDataProviderUnavailableError) {
        return { status: "provider-unavailable", symbol: request.symbol, provider: providerName, reason: error.message };
      }
      if (error instanceof MarketDataProviderError) {
        return { status: "provider-error", symbol: request.symbol, provider: providerName, reason: error.message };
      }
      throw error;
    }

    // The provider's own retrievedAt is the one timestamp threaded through
    // every downstream stage - see the field comment on
    // MarketIntelligenceMetadata.generatedAt for why this is preferred over
    // a separately-read clock value.
    const generatedAt = raw.retrievedAt;

    const collected = this.evidenceCollector.collectFromMarketContextResult(raw, generatedAt);
    const bundle = this.evidenceRanking.buildBundle(request.symbol, collected, generatedAt);
    const reasoning = this.reasoningEngine.reason(bundle);
    const risk = this.riskEngine.assess(reasoning);
    const confidence = this.confidenceEngine.assess(bundle, reasoning, risk);

    const executionTimeMs = this.clock.now() - startedAtMs;

    const result: MarketIntelligenceResult = deepFreeze({
      symbol: request.symbol,
      evidence: bundle,
      reasoning,
      risk,
      confidence,
      metadata: {
        pipelineVersion: MARKET_INTELLIGENCE_PIPELINE_VERSION,
        providerStatus: { status: "ok", provider: providerName },
        executionTimeMs,
        generatedAt,
      },
    });

    return { status: "completed", result };
  }
}
