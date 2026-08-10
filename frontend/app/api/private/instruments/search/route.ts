// app/api/private/instruments/search/route.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. A thin, read-only, server-side endpoint over
// InstrumentSearchService - the single new API boundary this sprint
// adds, following the same withContext/ApiResponse/getUserOrNull
// pattern every other private route in this project already uses (see
// app/api/private/market-data/snapshot/route.ts). Never exposes a
// provider secret/credential - CanonicalInstrument/ProviderMapping only
// ever carry public symbols/tokens, never an API key or session token.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { InstrumentSearchService } from "@/services/market-data/instrument-search.service";

const searchService = new InstrumentSearchService();
const MAX_LIMIT = 50;

export const GET = withContext(async (req, ctx) => {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Authentication required" }, ctx.requestId, 401, ctx.startedAt);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  if (typeof q !== "string" || q.trim().length === 0) {
    return ApiResponse.error({ code: "VALIDATION", message: "Query parameter 'q' is required" }, ctx.requestId, 400, ctx.startedAt);
  }
  const rawLimit = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : undefined;

  const results = searchService.search(q, limit).map(({ instrument, matchType }) => ({
    id: instrument.id,
    symbol: instrument.symbol,
    displayName: instrument.displayName,
    assetClass: instrument.assetClass,
    exchange: instrument.exchange,
    country: instrument.country,
    currency: instrument.currency,
    matchType,
    // Only the public, non-secret provenance fields - never a key/token/session value.
    providers: instrument.providerMappings.map((m) => ({
      provider: m.provider,
      providerSymbol: m.providerSymbol,
      capabilities: m.supportedCapabilities,
      verified: m.verified,
    })),
  }));

  return ApiResponse.success({ results }, ctx.requestId, 200, ctx.startedAt);
});
