// app/api/private/market-data/snapshots/route.ts
// Sprint D2.3 (Phase 4) - batch snapshots for the Market Ribbon. Read-only;
// CONSUMES the D2.2 MarketDataService (no infra change). Fetches each requested
// symbol sequentially so a cold load never fires a burst that trips the
// provider's per-minute rate limit; the service's 30s cache absorbs repeat
// polls. Only registry-enabled symbols are accepted (a symbol no provider maps
// is rejected, never faked). Each result is independent - one symbol failing
// does not fail the batch.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { marketData } from "@/services/market-data/shared-instance";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { isEnabledMarket } from "@/lib/market-data/market-registry";
import { reasonForKind, type MarketDataFailureReason } from "@/lib/market-data/error-dto";

// The shared cache TTL (default 60s, MARKET_CACHE_TTL_MS-overridable - see
// services/market-data/shared-instance.ts) keeps repeat polls off the
// provider between ticks, since Twelve Data's free tier allows only a
// handful of requests per minute. Sprint D2.3 (Phase 9): this instance is
// shared with /api/private/market-data/snapshot too, so the same symbol
// fetched from either route hits the upstream provider once.
const MAX_SYMBOLS = 12;

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && isEnabledMarket(s))
    .slice(0, MAX_SYMBOLS);

  const results: Array<
    | { symbol: string; ok: true; price: number; changePercent?: number; marketStatus: string; provider: string; cached?: boolean }
    | { symbol: string; ok: false; kind: string; reason: MarketDataFailureReason }
  > = [];

  for (const symbol of symbols) {
    try {
      const s = await marketData.getSnapshot({ symbol });
      results.push({
        symbol,
        ok: true,
        price: s.price,
        changePercent: s.changePercent,
        marketStatus: s.marketStatus,
        provider: s.provider,
        cached: s.cached,
      });
    } catch (error) {
      // Sprint D2.3.S3 - `reason` mirrors the same vocabulary every other
      // market-data route uses (lib/market-data/error-dto.ts), so a batch
      // item's failure format is never a third, different shape. `kind` is
      // kept alongside for any existing consumer reading the raw value.
      const kind = error instanceof MarketDataProviderError ? error.kind : "unknown";
      results.push({ symbol, ok: false, kind, reason: error instanceof MarketDataProviderError ? reasonForKind(kind) : "unknown" });
    }
  }

  return ApiResponse.success({ snapshots: results }, ctx.requestId, 200, ctx.startedAt);
});
