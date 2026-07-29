// app/api/private/market-intelligence/analyze/route.ts
// Sprint L2.1 - First production caller of the Sprint 15D deterministic
// pipeline. Constructs MarketAnalysisOrchestrationService with a REAL,
// configured AlphaVantageProvider + AlphaVantageNewsProvider injected -
// every other caller in this codebase (and this class's own constructor
// default) deliberately leaves that null, which makes every analysis
// resolve to "provider-unavailable" by design. This route is the one place
// that intentionally opts in to live market data.
//
// Symbol scope is locked to what AlphaVantageProvider actually maps
// (lib/market-data/providers/alpha-vantage.provider.ts's SYMBOL_MAP).
// Rejecting anything outside that here, before it ever reaches the
// pipeline, keeps the failure a clear 400 instead of a confusing round
// trip through five engines to reach the same "unsupported_symbol"
// provider error.
//
// Sprint L2.1 live testing found the configured ALPHA_VANTAGE_API_KEY
// genuinely serves EURUSD but rejects XAUUSD/XAGUSD ("Invalid API call") -
// see the provider file's header for the full evidence. EURUSD is
// SUPPORTED (works end to end); XAUUSD/XAGUSD are listed as PENDING so the
// dashboard can show them honestly rather than omit or fake them.
//
// Services are constructed once at module scope, not per-request: Alpha
// Vantage's own provider has a 60s in-memory TTL cache
// (lib/market-data/providers/alpha-vantage.provider.ts), which only
// protects anything if the same provider instance survives across
// requests on a warm server process.
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
import { AlphaVantageProvider } from "@/lib/market-data/providers/alpha-vantage.provider";
import { AlphaVantageNewsProvider } from "@/lib/market-data/providers/alpha-vantage-news.provider";
import { systemClock } from "@/lib/market-data/cache";

const SUPPORTED_SYMBOLS = {
  EURUSD: "Euro (EUR/USD)",
} as const;
type SupportedSymbol = keyof typeof SUPPORTED_SYMBOLS;

function isSupportedSymbol(value: unknown): value is SupportedSymbol {
  return typeof value === "string" && value in SUPPORTED_SYMBOLS;
}

const pipeline = new MarketIntelligencePipelineService(
  new AlphaVantageProvider(),
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

  const body = (await req.json().catch(() => null)) as { symbol?: unknown } | null;
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

  const outcome = await orchestrator.analyze({
    userId: sessionUser.profile.id,
    symbol,
    question: `What is the current market outlook for ${label}, based on the available evidence?`,
  });

  switch (outcome.status) {
    case "completed":
      return ApiResponse.success({ result: outcome.result }, ctx.requestId, 200, ctx.startedAt);
    case "invalid-request":
      return ApiResponse.error({ code: "VALIDATION", message: outcome.message }, ctx.requestId, 400, ctx.startedAt);
    case "provider-unavailable":
      return ApiResponse.error(
        { code: "PROVIDER_UNAVAILABLE", message: outcome.reason },
        ctx.requestId,
        503,
        ctx.startedAt,
      );
    case "provider-error":
      return ApiResponse.error(
        { code: "PROVIDER_ERROR", message: outcome.reason },
        ctx.requestId,
        503,
        ctx.startedAt,
      );
    case "ai-failed":
      return ApiResponse.error({ code: "AI_FAILED", message: outcome.message }, ctx.requestId, 500, ctx.startedAt);
  }
});
