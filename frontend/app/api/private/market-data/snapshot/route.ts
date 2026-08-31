// app/api/private/market-data/snapshot/route.ts
// Sprint D2.3 (Phase 2) - a thin, read-only endpoint that returns the shared
// MarketSnapshot for one symbol via the D2.2 MarketDataService (Twelve Data
// primary + Alpha Vantage fallback). It CONSUMES the market-data layer; it does
// not modify it. Powers the Workspace Header (live price, provider, updated)
// and, later, the Market Ribbon. Symbol scope is the registry's enabled
// markets, validated for a clean 400.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { marketData } from "@/services/market-data/shared-instance";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { isEnabledMarket, listEnabledMarkets } from "@/lib/market-data/market-registry";
import { toMarketDataErrorDTO, statusCodeForReason } from "@/lib/market-data/error-dto";
import { paperTradingService } from "@/services/paper-trading/paper-trading.service";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const symbol = new URL(req.url).searchParams.get("symbol");
  if (typeof symbol !== "string" || !isEnabledMarket(symbol)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `symbol must be one of: ${listEnabledMarkets().map((m) => m.symbol).join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  try {
    const snapshot = await marketData.getSnapshot({ symbol });
    // Paper Trading, Phase P2 - piggybacks limit-order fills and
    // stop-out checks on this real price observation (see
    // paper-trading.service.ts's own onPriceObserved() header comment
    // for why here, not a dedicated poll). Awaited so it can't outlive
    // this serverless invocation, but wrapped so it can never turn a
    // real, successful snapshot into a failed response - every chart on
    // the platform depends on this route staying reliable regardless of
    // paper-trading's own internal state.
    try {
      await paperTradingService.onPriceObserved(symbol, snapshot.bid, snapshot.ask);
    } catch {
      // onPriceObserved() already logs its own failures internally -
      // this outer catch exists only so an unexpected throw here can
      // never reach the response below.
    }
    return ApiResponse.success({ snapshot }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
      // Sprint D2.3.S3 - standardized failure DTO (lib/market-data/error-dto.ts)
      // at `error.details`, so every market-data-facing route returns the
      // same shape. The site-wide ApiResponse envelope is unchanged.
      const dto = toMarketDataErrorDTO(error, { cached: marketData.hasCacheEntry(symbol) });
      return ApiResponse.error(
        { code: dto.reason.toUpperCase(), message: error.message, details: dto as unknown as Record<string, unknown> },
        ctx.requestId,
        statusCodeForReason(dto.reason),
        ctx.startedAt,
      );
    }
    throw error;
  }
});
