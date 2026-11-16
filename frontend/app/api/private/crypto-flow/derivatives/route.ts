// app/api/private/crypto-flow/derivatives/route.ts
// Derivatives positioning (public Binance USDS-M futures data): funding, open interest and long/short crowding.
//   GET                   -> funding table for every instrument that has a perpetual
//   GET ?symbol=BTCUSDT   -> detail: funding, open-interest change (4 h, 24 h) with price, account and top-trader long share, taker ratio
// Same gate and envelope as the Crypto Flow route. No database, no keys.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getDerivativesDetail, getDerivativesOverview } from "@/services/crypto-flow/crypto-flow.service";
import { CryptoFlowProviderError } from "@/services/crypto-flow/binance.provider";
import { isCryptoFlowSymbol } from "@/types/crypto-flow";

export const dynamic = "force-dynamic";

export const GET = withContext(async (req, ctx) => {
  const user = await getUserOrNull();
  if (!user) return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (symbol && !isCryptoFlowSymbol(symbol)) return ApiResponse.error({ code: "VALIDATION", message: "Unknown symbol" }, ctx.requestId, 400, ctx.startedAt);
  try {
    const data = symbol ? await getDerivativesDetail(symbol) : await getDerivativesOverview();
    if (symbol && !data) return ApiResponse.error({ code: "NOT_FOUND", message: "No perpetual futures data for this instrument." }, ctx.requestId, 404, ctx.startedAt);
    const res = ApiResponse.success(data, ctx.requestId, 200, ctx.startedAt);
    res.headers.set("Cache-Control", "private, max-age=0, s-maxage=60, stale-while-revalidate=120");
    return res;
  } catch (error) {
    if (error instanceof CryptoFlowProviderError) {
      return ApiResponse.error({ code: "UPSTREAM_UNAVAILABLE", message: "The market data feed is temporarily unavailable. Try again shortly." }, ctx.requestId, 502, ctx.startedAt);
    }
    throw error;
  }
});
