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
import { MarketDataService } from "@/services/market-data/market-data.service";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import { isEnabledMarket } from "@/lib/market-data/market-registry";

// A longer cache TTL than the default is deliberate for the ribbon: it polls
// several symbols on an interval, and Twelve Data's free tier allows only a
// handful of requests per minute. A 90s cache keeps repeat polls off the
// provider entirely, so the ribbon stays within budget after the first load.
// This is route-level configuration (an option the service already exposes),
// not a change to the market-data infrastructure.
const marketData = new MarketDataService({ cacheTtlMs: 90_000 });
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
    | { symbol: string; ok: true; price: number; changePercent?: number; marketStatus: string; provider: string }
    | { symbol: string; ok: false; kind: string }
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
      });
    } catch (error) {
      results.push({ symbol, ok: false, kind: error instanceof MarketDataProviderError ? error.kind : "unknown" });
    }
  }

  return ApiResponse.success({ snapshots: results }, ctx.requestId, 200, ctx.startedAt);
});
