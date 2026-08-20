// app/api/marketplace/search/route.ts
// Sprint M8 - Deliberately public (not under /api/private), same reasoning
// as app/api/analytics/event/route.ts: browsing/searching the Marketplace
// catalog must work for a visitor who has never signed in. Read-only -
// this route never writes anything. Real server-side filtering/sorting/
// pagination (M8 brief section 22) via MarketplaceCatalogue.search, not a
// client-side array filter over a full table fetch.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import { TRUST_STATES } from "@/types/marketplace";
import type { MarketplaceSearchParams, TrustState } from "@/types/marketplace";

const SORTS = ["newest", "recently_updated", "price_asc", "price_desc", "most_recent_evidence", "most_evidence"] as const;

function isTrustState(value: string | null): value is TrustState {
  return !!value && (TRUST_STATES as string[]).includes(value);
}

export const GET = withContext(async (req, ctx) => {
  const url = new URL(req.url);
  const sortParam = url.searchParams.get("sort");
  const trustParam = url.searchParams.get("trustState");

  const params: MarketplaceSearchParams = {
    q: url.searchParams.get("q") ?? undefined,
    platform: url.searchParams.get("platform") ?? undefined,
    asset: url.searchParams.get("asset") ?? undefined,
    strategy: url.searchParams.get("strategy") ?? undefined,
    trustState: isTrustState(trustParam) ? trustParam : undefined,
    sort: (SORTS as readonly string[]).includes(sortParam ?? "") ? (sortParam as MarketplaceSearchParams["sort"]) : "newest",
    page: Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1),
    pageSize: Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 24) || 24)),
  };

  const result = await MarketplaceCatalogue.search(params);
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
