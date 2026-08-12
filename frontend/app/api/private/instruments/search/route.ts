// app/api/private/instruments/search/route.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. A thin, read-only, server-side endpoint - the single new
// API boundary this sprint added, following the same withContext/
// ApiResponse/getUserOrNull pattern every other private route in this
// project already uses (see app/api/private/market-data/snapshot/route.ts).
// Never exposes a provider secret/credential - CanonicalInstrument/
// ProviderMapping only ever carry public symbols/tokens, never an API key
// or session token.
//
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Same route, same auth boundary, same base response fields
// (id/symbol/displayName/assetClass/exchange/country/currency/matchType/
// providers) - existing consumers (GlobalSymbolSelector) are unaffected.
// Now delegates to UniversalInstrumentDiscoveryService instead of calling
// InstrumentSearchService directly - that service still owns 100% of the
// ranking logic (reused, not duplicated) and additionally searches live
// provider discovery when the existing catalog alone doesn't answer the
// query well. New, additive response fields: marketCategory,
// discoverySource, capabilities (quote/candles/intelligence/chart), and
// chart (supported/chartSymbol/reason) - this route never imports a
// provider adapter or a D2.5/D2.6 internal engine directly, only the
// discovery orchestrator.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { UniversalInstrumentDiscoveryService } from "@/services/market-data/discovery/universal-instrument-discovery.service";

const discoveryService = new UniversalInstrumentDiscoveryService();
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

  const { results, diagnostics } = await discoveryService.search(q, limit);

  const payload = results.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    displayName: r.displayName,
    assetClass: r.assetClass,
    marketCategory: r.marketCategory,
    exchange: r.exchange,
    country: r.country,
    currency: r.currency,
    matchType: r.matchType,
    discoverySource: r.discoverySource,
    // Only the public, non-secret provenance fields - never a key/token/session value.
    providers: r.providers,
    capabilities: r.capabilities,
    chart: r.chart,
  }));

  return ApiResponse.success({ results: payload, discoveryTriggered: diagnostics.discoveryTriggered }, ctx.requestId, 200, ctx.startedAt);
});
