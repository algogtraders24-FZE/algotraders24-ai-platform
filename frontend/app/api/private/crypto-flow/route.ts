// app/api/private/crypto-flow/route.ts
// Crypto Flow read API: real buyer / seller aggressor delta from the Binance 1-minute klines.
//   GET ?symbol=ALL (default)  -> overview of every instrument (no series; an instrument whose feed fails is marked unavailable)
//   GET ?symbol=BTCUSDT        -> one instrument with its 4-hour series
// Follows the Economic Calendar route: withContext + getUserOrNull gate, ApiResponse envelope, validated
// query, upstream fetch cached by Next.js, short CDN cache. No database, no keys.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getCryptoFlow, getCryptoFlowOverview } from "@/services/crypto-flow/crypto-flow.service";
import { CRYPTO_FLOW_CACHE_SECONDS, CryptoFlowProviderError } from "@/services/crypto-flow/binance.provider";
import { CRYPTO_FLOW_SYMBOLS, isCryptoFlowSymbol } from "@/types/crypto-flow";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const symbolParam = (url.searchParams.get("symbol") ?? "ALL").toUpperCase();
  const overview = symbolParam === "ALL";
  if (!overview && !isCryptoFlowSymbol(symbolParam)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `symbol must be ALL or one of: ${CRYPTO_FLOW_SYMBOLS.join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }

  try {
    const result = overview ? await getCryptoFlowOverview() : await getCryptoFlow(symbolParam);
    const res = ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
    res.headers.set("Cache-Control", `private, max-age=0, s-maxage=${CRYPTO_FLOW_CACHE_SECONDS}, stale-while-revalidate=${CRYPTO_FLOW_CACHE_SECONDS * 2}`);
    return res;
  } catch (error) {
    if (error instanceof CryptoFlowProviderError) {
      return ApiResponse.error(
        { code: "UPSTREAM_UNAVAILABLE", message: "The market data feed is temporarily unavailable. Try again shortly." },
        ctx.requestId,
        502,
        ctx.startedAt,
      );
    }
    throw error;
  }
});
