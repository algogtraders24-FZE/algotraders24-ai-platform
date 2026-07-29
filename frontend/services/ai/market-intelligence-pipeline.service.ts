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
// Sprint 15D.11 - Inserted EvidenceFusionService between collection and
// ranking: collected evidence is now tagged as a "market-data" source
// group and fused (deduplicated, attribution-preserved) before it reaches
// the still-unmodified EvidenceRankingService. Fusion's own canonical
// FusedEvidence[] output is immediately projected back down to
// EvidenceItem[] via EvidenceFusionService.toEvidenceItems() - ranking's
// own signature and logic never changed. `evidenceFusion` is appended
// after `clock`, not inserted next to evidenceCollector/evidenceRanking
// where it conceptually belongs, purely for backward compatibility: Sprint
// 15D.8's own validation script already constructs this class with
// explicit trailing positional arguments through `clock` - inserting a
// parameter earlier in the list would have silently shifted every one of
// those existing call sites.
//
// Sprint 15D.12 - Added an optional `newsProvider` (the first real
// implementation of Sprint 15D.11's NewsProvider interface,
// AlphaVantageNewsProvider). Defaults to null, same as `provider`: with
// nothing injected, behavior is byte-identical to Sprint 15D.11. When
// injected and configured, news evidence is fetched as a second,
// best-effort EvidenceSourceGroup ("news") alongside market-data. A news
// fetch failure (unconfigured, rate-limited, network error) is never
// fatal to the overall analysis - market data remains the only *required*
// source; the pipeline simply proceeds with zero news evidence, which
// every downstream engine already treats as an honest absence, not an
// error. `newsProvider` is appended last, for the same positional-
// backward-compatibility reason `evidenceFusion` was appended after
// `clock`.
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
import { EvidenceFusionService } from "./evidence-fusion.service";
import { ReasoningEngineService } from "./reasoning/reasoning-engine.service";
import { RiskEngineService } from "./risk/risk-engine.service";
import { ConfidenceEngineService } from "./confidence/confidence-engine.service";
import type { EvidenceSourceGroup, NewsProvider } from "@/types/evidence-fusion";
import type { EvidenceItem } from "@/types/evidence";
import type {
  MarketIntelligenceRequest,
  MarketIntelligenceOutcome,
  MarketIntelligenceResult,
} from "@/types/market-intelligence-result";

// Bumped only when this pipeline's own stage composition changes (e.g. a
// stage is added/reordered) - not tied to any individual engine's version.
// Bumped for Sprint 15D.12's optional news-source insertion.
export const MARKET_INTELLIGENCE_PIPELINE_VERSION = "15D.12.0";

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
    private readonly evidenceFusion: EvidenceFusionService = new EvidenceFusionService(),
    private readonly newsProvider: NewsProvider | null = null,
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
    // Sprint 15D.11: fuse before ranking. Sprint 15D.12 adds the first real
    // second source group ("news") when a NewsProvider is injected and
    // configured - a future EconomicCalendar/Sentiment provider follows
    // the exact same pattern: fetch, wrap in an EvidenceSourceGroup, push
    // onto this array. No other line in this method needs to change.
    const groups: EvidenceSourceGroup[] = [{ sourceType: "market-data", items: collected }];
    const newsItems = await this.fetchNewsEvidence(request);
    if (newsItems.length > 0) groups.push({ sourceType: "news", items: newsItems });

    const fused = this.evidenceFusion.fuse(groups);
    const fusedItems = this.evidenceFusion.toEvidenceItems(request.symbol, fused, generatedAt);
    const bundle = this.evidenceRanking.buildBundle(request.symbol, fusedItems, generatedAt);
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

  // Best-effort: news is an optional enrichment, never a requirement.
  // Unconfigured, or any failure (rate-limit, network, malformed
  // response), simply yields zero news evidence - exactly the same honest
  // "absent signal" every other evidence type already represents when a
  // provider has nothing to offer. This is the one deliberate exception to
  // this pipeline's usual "let unexpected errors propagate" policy: a
  // failure in an optional secondary source must never take down an
  // otherwise-successful analysis built on the required market-data source.
  private async fetchNewsEvidence(request: MarketIntelligenceRequest): Promise<EvidenceItem[]> {
    if (!this.newsProvider || !this.newsProvider.isConfigured()) return [];
    try {
      return await this.newsProvider.getNewsEvidence({ symbol: request.symbol, asOf: request.asOf });
    } catch {
      return [];
    }
  }
}
