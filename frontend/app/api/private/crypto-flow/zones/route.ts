// app/api/private/crypto-flow/zones/route.ts
// Flow Zones read API: where buyers and sellers have been trading (volume profile split by aggressor side) and where
// resting orders sit (order-book walls). GET ?symbol=BTCUSDT&lookback=24h   (lookback: 4h | 24h | 7d, default 24h)
// Same gate and envelope as the Crypto Flow route. No database, no keys; the upstream fetch is cached by Next.js.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { getCryptoFlowZones } from "@/services/crypto-flow/crypto-flow.service";
import { CRYPTO_FLOW_CACHE_SECONDS, CryptoFlowProviderError } from "@/services/crypto-flow/binance.provider";
import { CRYPTO_FLOW_LOOKBACKS, CRYPTO_FLOW_SYMBOLS, getCryptoFlowLookback, isCryptoFlowSymbol } from "@/types/crypto-flow";

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const lookback = (url.searchParams.get("lookback") ?? "24h").toLowerCase();
  if (!isCryptoFlowSymbol(symbol)) {
    return ApiResponse.error({ code: "VALIDATION", message: `symbol must be one of: ${CRYPTO_FLOW_SYMBOLS.join(", ")}` }, ctx.requestId, 400, ctx.startedAt);
  }
  if (!getCryptoFlowLookback(lookback)) {
    return ApiResponse.error({ code: "VALIDATION", message: `lookback must be one of: ${CRYPTO_FLOW_LOOKBACKS.map((l) => l.id).join(", ")}` }, ctx.requestId, 400, ctx.startedAt);
  }

  try {
    const result = await getCryptoFlowZones(symbol, lookback);
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
