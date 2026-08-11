// services/intelligence/orchestration/real-time-intelligence.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// The single orchestrator that turns a trader's raw question into a
// VerifiedRealTimeIntelligenceContext by wiring together, in order, EVERY
// existing deterministic engine from D2.6.2 (query parsing) through
// D2.6.3/D2.6.4 (multi-provider market data + smart fallback) through
// D2.5.2/D2.5.3 (market state/regime/hypothesis) through the frozen 15D
// pipeline (evidence/reasoning/risk/confidence) through D2.5.4 (historical
// validation) through D2.5.5 (envelope) through D2.6.1/D2.6.2 (decision
// context/query context) through D2.5.1 (analysis-run persistence).
//
// NO Gemini/Claude/OpenAI call happens anywhere in this file. This service
// is, and must remain, fully deterministic: identical real inputs (a fixed
// clock, injected fake providers) always produce an identical
// VerifiedRealTimeIntelligenceContext. Presentation (turning this object
// into natural language) is a separate, later concern - see
// services/intelligence/chat/gemini-intelligence-presenter.service.ts.
import type { MarketSymbol } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { RegimeType } from "@/types/intelligence-regime";
import type { ConversationIntelligenceContext } from "@/types/intelligence-context-request";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { Candle } from "@/types/market-candle";
import type { MarketDataProvider, SnapshotProvider, TimeSeriesProvider } from "@/types/market-data-provider";
import type { MarketIntelligenceResult } from "@/types/market-intelligence-result";
import type { HistoricalValidation } from "@/types/intelligence-historical-validation";
import type {
  VerifiedRealTimeIntelligenceContext,
  DataQualityAssessment,
  DataQualityState,
  CrossProviderValidationSummary,
  ClarificationRequirement,
  RealTimeIntelligenceObservability,
} from "@/types/real-time-intelligence";
import { REAL_TIME_INTELLIGENCE_ORCHESTRATION_VERSION } from "@/types/real-time-intelligence";
import { IntelligenceQueryService, resolveSymbol } from "@/services/intelligence/query/intelligence-query.service";
import { IntelligenceQueryContextService } from "@/services/intelligence/query/intelligence-query-context.service";
import { AnalysisHistoryService } from "@/services/intelligence/query/analysis-history.service";
import { MarketStateService } from "@/services/intelligence/market-state/market-state.service";
import { RegimeService } from "@/services/intelligence/regime/regime.service";
import { HypothesisService } from "@/services/intelligence/hypothesis/hypothesis.service";
import { PROVIDER_INTERVAL } from "@/services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { HistoricalValidationService } from "@/services/intelligence/memory/historical-validation.service";
import { IntelligenceEnvelopeService } from "@/services/intelligence/envelope/intelligence-envelope.service";
import { IntelligenceAnalysisRunService } from "@/services/intelligence/memory/analysis-run.service";
import { MarketIntelligencePipelineService } from "@/services/ai/market-intelligence-pipeline.service";
import { assessFreshness } from "@/services/market-data/freshness-policy.service";
import { validateSnapshotIntegrity } from "@/services/market-data/market-snapshot-integrity.service";
import { compareSnapshots, summarizeConflicts } from "@/services/market-data/cross-provider-validation.service";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { marketData as sharedMarketData } from "@/services/market-data/shared-instance";
import { TwelveDataProvider } from "@/lib/market-data/providers/twelve-data.provider";
import { BinanceProvider } from "@/lib/market-data/providers/binance.provider";
import { AngelOneProvider } from "@/lib/market-data/providers/angel-one.provider";
import { systemClock, type Clock } from "@/lib/market-data/cache";

export const REAL_TIME_INTELLIGENCE_VERSION = "1.0.0";

/**
 * Sprint §8 worked example: "Analyze Apple" with no timeframe resolves
 * from this documented, versioned default rather than blocking on a
 * clarification round-trip for something as common as an unqualified
 * question. This NEVER overwrites `query.timeframe` itself (D2.6.2's own
 * "never a platform-wide default" contract on that field stays true) - it
 * is only the working timeframe used to fetch candles/build MarketState.
 * IntelligenceQueryContextService.classifyCompleteness() already downgrades
 * completeness to "partial" whenever `query.timeframe` is unresolved, so
 * the trader-facing context still honestly signals "you didn't specify a
 * timeframe" even while the analysis itself proceeds.
 */
export const DEFAULT_INTELLIGENCE_TIMEFRAME: SignalTimeframe = "1h";
const DEFAULT_CANDLE_OUTPUT_SIZE = 100;

type LiveSnapshotProvider = MarketDataProvider & SnapshotProvider;

// Sprint §4 - only providers that genuinely implement SnapshotProvider can
// serve a real second MarketSnapshot for comparison. Alpha Vantage is
// deliberately excluded (it's spot-only via getMarketContext, never
// getSnapshot - see market-data.service.ts's own header) - the catalog's
// "quote" capability tag on Alpha Vantage describes its getMarketContext
// support, not a MarketSnapshot it cannot produce. A cataloged provider
// with no entry here honestly falls through to the "no adapter
// registered" branch below, never a crash.
const REAL_PROVIDER_REGISTRY: Record<string, () => LiveSnapshotProvider> = {
  "twelve-data": () => new TwelveDataProvider(),
  binance: () => new BinanceProvider(),
  "angel-one": () => new AngelOneProvider(),
};

export interface RealTimeIntelligenceRequest {
  requestId: string;
  /** Session-derived, never client-supplied - see sprint §15. */
  userId: string;
  question: string;
  symbol?: MarketSymbol;
  timeframe?: SignalTimeframe;
  conversationContext?: ConversationIntelligenceContext;
  /** Sprint §4 - opt-in only. A second real provider is never fetched by default; doing so on every request would double provider cost/latency for a capability the sprint itself calls "optional". */
  crossProviderValidation?: boolean;
  /** Caller-supplied for determinism/testability - never Date.now() internally. */
  requestedAt?: string;
}

export interface RealTimeIntelligenceDeps {
  marketData?: MarketDataProvider & SnapshotProvider & TimeSeriesProvider;
  queryService?: IntelligenceQueryService;
  queryContextService?: IntelligenceQueryContextService;
  analysisHistory?: AnalysisHistoryService;
  marketStateService?: MarketStateService;
  regimeService?: RegimeService;
  hypothesisService?: HypothesisService;
  historicalValidationService?: HistoricalValidationService;
  envelopeService?: IntelligenceEnvelopeService;
  analysisRunService?: IntelligenceAnalysisRunService;
  pipeline?: MarketIntelligencePipelineService;
  providerRegistry?: Record<string, () => LiveSnapshotProvider>;
  clock?: Clock;
}

function assessDataQuality(snapshot: MarketSnapshot | undefined, nowMs: number, invalidReason?: string): DataQualityAssessment {
  if (!snapshot) {
    return {
      state: "unavailable",
      basis: [invalidReason ?? "No real snapshot could be obtained from any configured, capable provider"],
    };
  }
  const freshness = assessFreshness({ subject: { kind: "quote", assetClass: snapshot.assetClass }, timestamp: snapshot.timestamp, nowMs });
  let state: DataQualityState;
  const basis: string[] = [...freshness.basis];
  if (freshness.status === "unknown") {
    state = "unknown";
  } else if (freshness.status === "stale") {
    state = "stale";
  } else if (snapshot.cached) {
    state = "cached";
    basis.push("Served from an existing cache entry within the freshness threshold - not a brand-new live provider call this request");
  } else {
    state = "fresh";
  }
  return {
    state,
    freshnessStatus: freshness.status,
    cached: snapshot.cached,
    cacheAgeMs: snapshot.cacheAgeMs,
    provider: snapshot.provider,
    providerSymbol: snapshot.providerSymbol,
    fallbackUsed: snapshot.fallbackUsed,
    timestamp: snapshot.timestamp,
    basis,
  };
}

export class RealTimeIntelligenceService {
  private readonly marketData: MarketDataProvider & SnapshotProvider & TimeSeriesProvider;
  private readonly queryService: IntelligenceQueryService;
  private readonly queryContextService: IntelligenceQueryContextService;
  private readonly analysisHistory: AnalysisHistoryService;
  private readonly marketStateService: MarketStateService;
  private readonly regimeService: RegimeService;
  private readonly hypothesisService: HypothesisService;
  private readonly historicalValidationService: HistoricalValidationService;
  private readonly envelopeService: IntelligenceEnvelopeService;
  private readonly analysisRunService: IntelligenceAnalysisRunService;
  private readonly pipeline: MarketIntelligencePipelineService;
  private readonly providerRegistry: Record<string, () => LiveSnapshotProvider>;
  private readonly clock: Clock;

  constructor(deps: RealTimeIntelligenceDeps = {}) {
    this.marketData = deps.marketData ?? sharedMarketData;
    this.queryService = deps.queryService ?? new IntelligenceQueryService();
    this.queryContextService = deps.queryContextService ?? new IntelligenceQueryContextService();
    this.analysisHistory = deps.analysisHistory ?? new AnalysisHistoryService();
    this.marketStateService = deps.marketStateService ?? new MarketStateService();
    this.regimeService = deps.regimeService ?? new RegimeService();
    this.hypothesisService = deps.hypothesisService ?? new HypothesisService();
    this.historicalValidationService = deps.historicalValidationService ?? new HistoricalValidationService();
    this.envelopeService = deps.envelopeService ?? new IntelligenceEnvelopeService();
    this.analysisRunService = deps.analysisRunService ?? new IntelligenceAnalysisRunService();
    this.pipeline = deps.pipeline ?? new MarketIntelligencePipelineService(this.marketData);
    this.providerRegistry = deps.providerRegistry ?? REAL_PROVIDER_REGISTRY;
    this.clock = deps.clock ?? systemClock;
  }

  async build(request: RealTimeIntelligenceRequest): Promise<VerifiedRealTimeIntelligenceContext> {
    const nowMs = this.clock.now();
    const generatedAt = request.requestedAt ?? new Date(nowMs).toISOString();

    const query = this.queryService.parse({
      rawQuestion: request.question,
      requestContextSymbol: request.symbol,
      requestContextTimeframe: request.timeframe,
      conversationContext: request.conversationContext,
      requestedAt: generatedAt,
    });

    const observability = (overrides: Partial<RealTimeIntelligenceObservability> = {}): RealTimeIntelligenceObservability => ({
      requestId: request.requestId,
      userId: request.userId,
      symbol: query.symbol,
      timeframe: query.timeframe,
      dataFreshness: "unknown",
      generatedAt,
      ...overrides,
    });

    // Sprint §8 - never guess a symbol. No market-data/intelligence engine
    // is ever called below this point when the symbol didn't resolve.
    if (!query.symbol) {
      const resolution = resolveSymbol(request.question, request.symbol, request.conversationContext);
      const clarification: ClarificationRequirement =
        resolution.ambiguousCandidates.length > 0
          ? {
              reason: "ambiguous-symbol",
              message: `Multiple instruments were mentioned (${resolution.ambiguousCandidates.join(", ")}) - please specify which one you mean.`,
              candidates: resolution.ambiguousCandidates,
            }
          : {
              reason: "unresolved-symbol",
              message: "I could not identify which instrument you're asking about. Please specify a symbol (e.g. BTCUSD, XAUUSD, EURUSD).",
            };
      return {
        status: "clarification-required",
        clarification,
        query,
        observability: observability(),
        generatedAt,
        orchestrationVersion: REAL_TIME_INTELLIGENCE_ORCHESTRATION_VERSION,
      };
    }

    const symbol = query.symbol;
    const resolvedTimeframe: SignalTimeframe = query.timeframe ?? DEFAULT_INTELLIGENCE_TIMEFRAME;

    // ---- Real market data (D2.6.3/D2.6.4 - smart fallback is entirely
    // this service's own concern; never re-implemented or re-ordered here). ----
    let snapshot: MarketSnapshot | undefined;
    try {
      snapshot = await this.marketData.getSnapshot({ symbol });
    } catch {
      snapshot = undefined;
    }

    let dataQuality: DataQualityAssessment;
    if (snapshot) {
      const integrity = validateSnapshotIntegrity({ requestedSymbol: symbol, snapshot, nowMs });
      if (!integrity.valid) {
        // Sprint §2/§8 - a structurally invalid snapshot is never handed to
        // the intelligence engines; it is treated exactly like a total
        // fetch failure, never manufactured into a "usable" value.
        dataQuality = assessDataQuality(undefined, nowMs, integrity.issues.map((i) => `${i.field}: ${i.description}`).join("; "));
        snapshot = undefined;
      } else {
        dataQuality = assessDataQuality(snapshot, nowMs);
      }
    } else {
      dataQuality = assessDataQuality(undefined, nowMs);
    }

    if (!snapshot) {
      return {
        status: "insufficient-data",
        query,
        dataQuality,
        observability: observability({ dataFreshness: dataQuality.state }),
        generatedAt,
        orchestrationVersion: REAL_TIME_INTELLIGENCE_ORCHESTRATION_VERSION,
      };
    }

    let candles: Candle[] = [];
    try {
      candles = await this.marketData.getTimeSeries({
        symbol,
        interval: PROVIDER_INTERVAL[resolvedTimeframe],
        outputSize: DEFAULT_CANDLE_OUTPUT_SIZE,
      });
    } catch {
      candles = []; // MarketStateService treats too-few-candles as an honest "not computable", never fabricated
    }

    // ---- Best-effort regime continuity (never fatal to the analysis). ----
    let previousRegime: RegimeType | undefined;
    if (request.conversationContext?.previousAnalysisRunId) {
      try {
        const previousRun = await this.analysisHistory.getOwnedAnalysisRun(request.conversationContext.previousAnalysisRunId, request.userId);
        previousRegime = previousRun?.hypothesisSnapshot?.regime.regimeType;
      } catch {
        previousRegime = undefined;
      }
    }

    const marketState = this.marketStateService.assemble({ symbol, timeframe: resolvedTimeframe, snapshot, candles });
    const regime = this.regimeService.classify({ marketState, previousRegime });

    // ---- 15D leg: evidence/reasoning/risk/confidence, via the frozen,
    // unmodified pipeline - never a second evidence/risk/confidence
    // implementation. A provider-unavailable/provider-error outcome here
    // is never fatal: MarketState/Regime/Hypothesis can still stand on
    // the real snapshot+candles already obtained above. ----
    const pipelineOutcome = await this.pipeline.run({ symbol, asOf: snapshot.timestamp });
    const evidence = pipelineOutcome.status === "completed" ? pipelineOutcome.result.evidence : undefined;
    const risk = pipelineOutcome.status === "completed" ? pipelineOutcome.result.risk : undefined;
    const confidence = pipelineOutcome.status === "completed" ? pipelineOutcome.result.confidence : undefined;

    const hypotheses = this.hypothesisService.generate({ marketState, regime, evidence });

    // Sprint §5/D2.5.4 - historical validation is only meaningful for
    // exactly one hypothesis, matching IntelligenceEnvelopeService's own
    // documented contract.
    let historicalValidation: HistoricalValidation | undefined;
    if (hypotheses.length === 1) {
      try {
        historicalValidation = await this.historicalValidationService.buildHistoricalValidation(
          { symbol, timeframe: resolvedTimeframe, regimeType: regime.regimeType, hypothesisType: hypotheses[0].type },
          request.userId,
        );
      } catch {
        historicalValidation = undefined;
      }
    }

    const envelope = this.envelopeService.build({ marketState, regime, hypotheses, evidence, risk, confidence, historicalValidation, generatedAt });

    const queryContext = await this.queryContextService.build({
      query,
      envelope,
      userId: request.userId,
      conversationContext: request.conversationContext,
      generatedAt,
    });

    let crossProviderValidation: CrossProviderValidationSummary | undefined;
    if (request.crossProviderValidation) {
      crossProviderValidation = await this.runCrossProviderValidation(symbol, snapshot, nowMs);
    }

    // ---- Persistence (sprint §5) - the exact hypothesis snapshot D2.5.4
    // needs, never just a final text response. Best-effort: a persistence
    // failure must never take down a response the trader already has. ----
    let analysisRunId: string | undefined;
    try {
      const analysisResult: MarketIntelligenceResult | null = pipelineOutcome.status === "completed" ? pipelineOutcome.result : null;
      const run = await this.analysisRunService.createAnalysisRun({
        userId: request.userId,
        symbol,
        timeframe: resolvedTimeframe,
        analysisResult,
        hypothesisSnapshot: { marketState, regime, hypotheses, capturedAt: generatedAt },
      });
      analysisRunId = run.id;
    } catch {
      analysisRunId = undefined;
    }

    return {
      status: "resolved",
      query,
      queryContext,
      envelope,
      dataQuality,
      crossProviderValidation,
      analysisRunId,
      observability: observability({
        dataFreshness: dataQuality.state,
        providerUsed: snapshot.provider,
        fallbackUsed: snapshot.fallbackUsed,
        pipelineVersion: envelope.pipelineVersion,
        intelligenceEngineVersion: envelope.intelligenceEngineVersion,
      }),
      generatedAt,
      orchestrationVersion: REAL_TIME_INTELLIGENCE_ORCHESTRATION_VERSION,
    };
  }

  // Sprint §4 - optional, standalone. Fetches a REAL second snapshot
  // directly from a different capable provider (never through
  // MarketDataService's own single-winner router, which would just return
  // the same snapshot again) and compares via D2.6.4's own
  // compareSnapshots/summarizeConflicts - never re-implements comparison
  // logic here.
  private async runCrossProviderValidation(symbol: MarketSymbol, primary: MarketSnapshot, nowMs: number): Promise<CrossProviderValidationSummary> {
    const generatedAt = new Date(nowMs).toISOString();
    const instrument = getCanonicalInstrument(symbol);
    const candidates = (instrument?.providerMappings ?? []).filter(
      (m) => m.provider !== primary.provider && m.supportedCapabilities.includes("quote"),
    );
    if (candidates.length === 0) {
      return { status: "insufficient-data", providers: [primary.provider], basis: ["No second real provider supports this instrument's quote capability"], generatedAt };
    }

    const secondaryProviderName = candidates[0].provider;
    const factory = this.providerRegistry[secondaryProviderName];
    if (!factory) {
      return {
        status: "insufficient-data",
        providers: [primary.provider],
        basis: [`Provider "${secondaryProviderName}" has no adapter registered for a direct cross-validation fetch`],
        generatedAt,
      };
    }

    let secondary: MarketSnapshot;
    try {
      secondary = await factory().getSnapshot({ symbol });
    } catch (error) {
      return {
        status: "insufficient-data",
        providers: [primary.provider],
        basis: [`Second provider "${secondaryProviderName}" could not be reached: ${error instanceof Error ? error.message : String(error)}`],
        generatedAt,
      };
    }

    const conflicts = compareSnapshots({ instrument: symbol, snapshotA: primary, snapshotB: secondary, nowMs });
    const summary = summarizeConflicts(conflicts);
    return { status: summary.status, providers: [primary.provider, secondary.provider], basis: summary.basis, generatedAt };
  }
}
