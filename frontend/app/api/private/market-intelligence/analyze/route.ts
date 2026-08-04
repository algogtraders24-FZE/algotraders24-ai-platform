// app/api/private/market-intelligence/analyze/route.ts
// Sprint L2.1 - First production caller of the Sprint 15D deterministic
// pipeline. Constructs MarketAnalysisOrchestrationService with a REAL,
// configured price provider + AlphaVantageNewsProvider injected - every
// other caller in this codebase (and this class's own constructor default)
// deliberately leaves that null, which makes every analysis resolve to
// "provider-unavailable" by design. This route is the one place that
// intentionally opts in to live market data.
//
// Sprint D2.3.S3 - swapped the price provider from a bare TwelveDataProvider
// to the shared MarketDataService instance (services/market-data/shared-
// instance.ts) - the same singleton the Workspace/Trading Copilot routes
// already use. MarketDataService implements the same MarketDataProvider
// interface (documented drop-in), so this is a zero-adapter swap that adds
// three things for free: Alpha Vantage as an automatic fallback when Twelve
// Data fails (Objective 1), the Provider Health Monitor recording real
// traffic from this route too (Objective 2, and it now shares a monitor
// with every other market-data-facing route since it's the same instance),
// and a stale-cache fallback before a hard failure (Objective 5). SOL/XRP
// join the already-added GBPUSD/USDJPY/XAUUSD/XAGUSD/BTCUSD, matching Twelve
// Data's SYMBOL_MAP (lib/market-data/providers/twelve-data.provider.ts).
// News evidence (AlphaVantageNewsProvider) is untouched - it queries by
// topic, not by ticker, so it was never symbol-restricted.
//
// Symbol scope is locked to what Twelve Data actually maps. Rejecting
// anything outside that here, before it ever reaches the pipeline, keeps
// the failure a clear 400 instead of a confusing round trip through five
// engines to reach the same "unsupported_symbol" provider error.
//
// Sprint L2.4 - added an optional `question` field, backward compatible:
// the standalone Market Intelligence page still sends only `symbol` and
// gets the same canned question as before. The AI Assistant (Sprint L2.4)
// sends the user's actual message here when it detects an explicit market
// analysis request, so Gemini's restatement addresses what was actually
// asked instead of always the same generic outlook question. This route
// itself gains no new coupling - still the same orchestrator, same
// pipeline, same symbol scope.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { MarketAnalysisOrchestrationService } from "@/services/ai/market-analysis-orchestration.service";
import { MarketIntelligencePipelineService } from "@/services/ai/market-intelligence-pipeline.service";
import { EvidenceCollectorService } from "@/services/ai/evidence/evidence-collector.service";
import { EvidenceRankingService } from "@/services/ai/evidence/evidence-ranking.service";
import { EvidenceFusionService } from "@/services/ai/evidence-fusion.service";
import { ReasoningEngineService } from "@/services/ai/reasoning/reasoning-engine.service";
import { RiskEngineService } from "@/services/ai/risk/risk-engine.service";
import { ConfidenceEngineService } from "@/services/ai/confidence/confidence-engine.service";
import { marketData } from "@/services/market-data/shared-instance";
import { AlphaVantageNewsProvider } from "@/lib/market-data/providers/alpha-vantage-news.provider";
import { systemClock } from "@/lib/market-data/cache";
import { requestLogService } from "@/services/tracking/RequestLogService";
import { analyticsEventService } from "@/services/analytics/AnalyticsEventService";
import { toMarketDataErrorDTO, statusCodeForReason, reasonForKind, type MarketDataErrorDTO } from "@/lib/market-data/error-dto";

const SUPPORTED_SYMBOLS = {
  EURUSD: "Euro (EUR/USD)",
  GBPUSD: "British Pound (GBP/USD)",
  USDJPY: "US Dollar / Japanese Yen (USD/JPY)",
  XAUUSD: "Gold (XAU/USD)",
  XAGUSD: "Silver (XAG/USD)",
  BTCUSD: "Bitcoin (BTC/USD)",
  ETHUSD: "Ethereum (ETH/USD)",
  SOLUSD: "Solana (SOL/USD)",
  XRPUSD: "XRP (XRP/USD)",
} as const;
type SupportedSymbol = keyof typeof SUPPORTED_SYMBOLS;

function isSupportedSymbol(value: unknown): value is SupportedSymbol {
  return typeof value === "string" && value in SUPPORTED_SYMBOLS;
}

const pipeline = new MarketIntelligencePipelineService(
  marketData,
  new EvidenceCollectorService(),
  new EvidenceRankingService(),
  new ReasoningEngineService(),
  new RiskEngineService(),
  new ConfidenceEngineService(),
  systemClock,
  new EvidenceFusionService(),
  new AlphaVantageNewsProvider(),
);
const orchestrator = new MarketAnalysisOrchestrationService(pipeline);

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      ctx.requestId,
      401,
      ctx.startedAt,
    );
  }

  const body = (await req.json().catch(() => null)) as { symbol?: unknown; question?: unknown } | null;
  if (!isSupportedSymbol(body?.symbol)) {
    return ApiResponse.error(
      {
        code: "VALIDATION",
        message: `symbol must be one of: ${Object.keys(SUPPORTED_SYMBOLS).join(", ")}`,
      },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  const symbol = body.symbol;
  const label = SUPPORTED_SYMBOLS[symbol];

  const MAX_QUESTION_CHARS = 500;
  let question = `What is the current market outlook for ${label}, based on the available evidence?`;
  if (body?.question !== undefined) {
    if (typeof body.question !== "string" || body.question.trim().length === 0) {
      return ApiResponse.error({ code: "VALIDATION", message: "question must be a non-empty string" }, ctx.requestId, 400, ctx.startedAt);
    }
    question = body.question.trim().slice(0, MAX_QUESTION_CHARS);
  }

  const outcome = await orchestrator.analyze({
    userId: sessionUser.profile.id,
    symbol,
    question,
  });

  // Sprint L2.7 - Phase 6: durable request tracking, additive only. Never
  // touches the orchestrator/pipeline itself; a failure here never fails
  // the analysis response (best-effort, same convention as L2.2's
  // retrievalCount increment).
  await requestLogService.record(sessionUser.profile.id, "market_analysis").catch(() => {});
  // Sprint R1.2 - Phase 2: real "market_analysis" beta-analytics event,
  // additive alongside the existing RequestLog write above - separate
  // tables for separate purposes (usage metering vs. beta funnel/journey).
  await analyticsEventService.record(sessionUser.profile.id, "market_analysis").catch(() => {});

  switch (outcome.status) {
    case "completed":
      return ApiResponse.success({ result: outcome.result }, ctx.requestId, 200, ctx.startedAt);
    case "invalid-request":
      return ApiResponse.error({ code: "VALIDATION", message: outcome.message }, ctx.requestId, 400, ctx.startedAt);
    case "provider-unavailable": {
      // Sprint D2.3.S3 - no MarketDataProviderError exists for this branch
      // (it fires before any provider call is even attempted), so the DTO is
      // built directly rather than via toMarketDataErrorDTO - same shape,
      // honestly reflecting "nothing was configured to try".
      const details: MarketDataErrorDTO = {
        success: false,
        reason: "unconfigured",
        provider: outcome.provider,
        cached: false,
        timestamp: new Date().toISOString(),
      };
      return ApiResponse.error(
        { code: "PROVIDER_UNAVAILABLE", message: outcome.reason, details: details as unknown as Record<string, unknown> },
        ctx.requestId,
        503,
        ctx.startedAt,
      );
    }
    case "provider-error": {
      const cached = marketData.hasCacheEntry(symbol);
      const details = outcome.cause ? toMarketDataErrorDTO(outcome.cause, { cached }) : undefined;
      const status = outcome.cause ? statusCodeForReason(reasonForKind(outcome.cause.kind)) : 502;
      return ApiResponse.error(
        { code: "PROVIDER_ERROR", message: outcome.reason, details: details as unknown as Record<string, unknown> | undefined },
        ctx.requestId,
        status,
        ctx.startedAt,
      );
    }
    case "ai-failed":
      return ApiResponse.error({ code: "AI_FAILED", message: outcome.message }, ctx.requestId, 500, ctx.startedAt);
  }
});
