// app/api/private/crypto-flow/route.ts
// Crypto Flow read API: real buyer / seller aggressor delta for BTC and ETH (Binance spot 1-minute klines).
// Follows the Economic Calendar route: withContext + getUserOrNull gate, ApiResponse envelope, validated
// query, upstream fetch cached by Next.js, short CDN cache. No database, no keys.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getCryptoFlow } from "@/services/crypto-flow/crypto-flow.service";
import { CRYPTO_FLOW_CACHE_SECONDS, CryptoFlowProviderError } from "@/services/crypto-flow/binance.provider";
import { CRYPTO_FLOW_SYMBOLS, isCryptoFlowSymbol, type CryptoFlowSymbol } from "@/types/crypto-flow";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const symbolParam = (url.searchParams.get("symbol") ?? "BTCUSDT").toUpperCase();
  if (!isCryptoFlowSymbol(symbolParam)) {
    return ApiResponse.error(
      { code: "VALIDATION", message: `symbol must be one of: ${CRYPTO_FLOW_SYMBOLS.join(", ")}` },
      ctx.requestId,
      400,
      ctx.startedAt,
    );
  }
  const symbol: CryptoFlowSymbol = symbolParam;

  try {
    const result = await getCryptoFlow(symbol);
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
