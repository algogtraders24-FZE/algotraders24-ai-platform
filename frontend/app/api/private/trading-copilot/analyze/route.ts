// app/api/private/trading-copilot/analyze/route.ts
// Sprint D2.2 (Phase 7) - the real Trading Copilot analysis endpoint. Replaces
// the page's former mock pipeline: it runs the centralized MarketDataService
// (Twelve Data primary + Alpha Vantage fallback) for a live snapshot and
// historical candles, computes real technical indicators, derives a risk +
// data-confidence context, and has Gemini restate that structured context.
// No fabricated values ever reach the client - an indicator without enough
// candles is simply absent.
//
// Symbol scope is the registry's ENABLED markets, validated here for a clean
// 400 rather than a round trip that fails deeper. Services are constructed
// once at module scope so the providers' caches survive across warm requests.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { TradingCopilotService } from "@/services/ai/trading-copilot.service";
import { MarketContextBuilderService } from "@/services/ai/market-context-builder.service";
import { buildIntelligencePanelData } from "@/services/ai/intelligence-panel.service";
import { isEnabledMarket, listEnabledMarkets } from "@/lib/market-data/market-registry";
import { marketData } from "@/services/market-data/shared-instance";
import { toMarketDataErrorDTO, statusCodeForReason, reasonForKind } from "@/lib/market-data/error-dto";

// Sprint D2.3.S3 - explicitly inject the shared MarketDataService instance
// (services/market-data/shared-instance.ts) instead of relying on
// TradingCopilotService's own default `new MarketDataService()`. Otherwise
// this route's cache/health data would live on a second, disconnected
// instance that never agrees with what marketData.hasCacheEntry() below
// (or the Provider Health Monitor) actually observed.
//
// Sprint D2.3 Final Audit - the same gap existed one level deeper:
// TradingCopilotService's third constructor argument
// (MarketContextBuilderService) still defaulted to its own disconnected
// `new MarketDataService()`. Currently harmless (the only method actually
// called on it, explainStructured(), never touches that dependency), but a
// latent trap if a future change ever calls a method that does - explicitly
// wiring the shared instance here closes it the same way as the first arg.
const copilot = new TradingCopilotService(marketData, undefined, new MarketContextBuilderService(marketData));

export const POST = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const body = (await req.json().catch(() => null)) as { symbol?: unknown } | null;
  if (typeof body?.symbol !== "string" || !isEnabledMarket(body.symbol)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `symbol must be one of: ${listEnabledMarkets().map((m) => m.symbol).join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  const outcome = await copilot.analyze({ symbol: body.symbol });
  switch (outcome.status) {
    case "completed":
      // `panel` is a same-request projection of `analysis` (Sprint D2.3 P6) - the
      // Intelligence Workspace's AI Intelligence panel reads it. Additive field,
      // no second analysis: existing consumers of `analysis` are unaffected.
      return ApiResponse.success(
        { analysis: outcome.analysis, panel: buildIntelligencePanelData(outcome.analysis) },
        ctx.requestId,
        200,
        ctx.startedAt,
      );
    case "provider-unavailable":
    case "provider-error": {
      // Sprint D2.3.S3 - standardized failure DTO, same shape every other
      // market-data-facing route returns (lib/market-data/error-dto.ts).
      const cached = marketData.hasCacheEntry(outcome.symbol);
      const details = toMarketDataErrorDTO(outcome.cause, { cached });
      return ApiResponse.error(
        {
          code: outcome.status === "provider-unavailable" ? "PROVIDER_UNAVAILABLE" : "PROVIDER_ERROR",
          message: outcome.reason,
          details: details as unknown as Record<string, unknown>,
        },
        ctx.requestId,
        statusCodeForReason(reasonForKind(outcome.cause.kind)),
        ctx.startedAt,
      );
    }
  }
});
