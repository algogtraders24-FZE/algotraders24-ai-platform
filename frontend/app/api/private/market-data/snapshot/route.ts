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
import { MarketDataService } from "@/services/market-data/market-data.service";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { isEnabledMarket, listEnabledMarkets } from "@/lib/market-data/market-registry";

const marketData = new MarketDataService();

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
    return ApiResponse.success({ snapshot }, ctx.requestId, 200, ctx.startedAt);
  } catch (error) {
    if (error instanceof MarketDataProviderError) {
      const status = error.kind === "unconfigured" ? 503 : 502;
      return ApiResponse.error({ code: "PROVIDER_ERROR", message: error.message }, ctx.requestId, status, ctx.startedAt);
    }
    throw error;
  }
});
