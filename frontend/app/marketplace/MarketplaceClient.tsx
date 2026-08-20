"use client";
// app/marketplace/MarketplaceClient.tsx
// Sprint M8 - Client half of the Marketplace catalog page. Server-rendered
// first page comes in as `initialResult` (SEO + no-JS content, same
// approach the existing /products page uses for its own data); every
// subsequent filter/sort/page change re-fetches from the real,
// server-side-filtering /api/marketplace/search endpoint - never a
// client-side array filter over a pre-fetched full table (M8 brief
// section 22).
//
// Deliberately avoids next/navigation's useSearchParams(): this codebase
// hit a real, confirmed production bug where useSearchParams()'s required
// Suspense boundary discarded a fully-server-rendered page on cold load
// (see app/products/ProductsClient.tsx's header comment). Initial
// deep-link params are read from window.location.search in an effect
// instead, exactly like that fix.
import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";
import MarketplaceFilters, { DEFAULT_FILTERS, type MarketplaceFiltersValue } from "@/components/marketplace/MarketplaceFilters";
import MarketplaceGrid from "@/components/marketplace/MarketplaceGrid";
import MarketplacePagination from "@/components/marketplace/MarketplacePagination";
import type { MarketplaceSearchResult, TrustState } from "@/types/marketplace";
import { TRUST_STATES } from "@/types/marketplace";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 350;

function filtersFromLocation(): Partial<MarketplaceFiltersValue> {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const trustState = params.get("trustState");
  return {
    q: params.get("q") ?? "",
    platform: params.get("platform") ?? "",
    asset: params.get("asset") ?? "",
    strategy: params.get("strategy") ?? "",
    trustState: (TRUST_STATES as string[]).includes(trustState ?? "") ? (trustState as TrustState) : "",
  };
}

export default function MarketplaceClient({ initialResult }: { initialResult: MarketplaceSearchResult }) {
  const [filters, setFilters] = useState<MarketplaceFiltersValue>(DEFAULT_FILTERS);
  const [result, setResult] = useState<MarketplaceSearchResult>(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMounted = useRef(false);

  // Deep-link support (?q=, ?platform=, etc.) - read once after mount, same
  // pattern/reasoning as ProductsClient.tsx.
  useEffect(() => {
    const fromUrl = filtersFromLocation();
    if (Object.values(fromUrl).some(Boolean)) {
      setFilters((prev) => ({ ...prev, ...fromUrl }));
    }
  }, []);

  const load = useCallback(async (f: MarketplaceFiltersValue, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (f.q) params.set("q", f.q);
      if (f.platform) params.set("platform", f.platform);
      if (f.asset) params.set("asset", f.asset);
      if (f.strategy) params.set("strategy", f.strategy);
      if (f.trustState) params.set("trustState", f.trustState);
      params.set("sort", f.sort);
      params.set("page", String(p));
      params.set("pageSize", String(PAGE_SIZE));

      const res = await fetch(`/api/marketplace/search?${params.toString()}`);
      const body = await res.json();
      if (!res.ok || body.status !== "ok") {
        throw new Error(body?.error?.message ?? "Failed to load marketplace listings");
      }
      setResult(body.data as MarketplaceSearchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace listings");
    } finally {
      setLoading(false);
    }
  }, []);

  // Filter/sort changes: debounced, reset to page 1.
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return; // skip the redundant fetch on first mount - initialResult already has page 1
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void load(filters, 1);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handlePageChange = (next: number) => {
    void load(filters, next);
  };

  const hasActiveFilters = Boolean(filters.q || filters.platform || filters.asset || filters.strategy || filters.trustState);

  return (
    <div className="flex flex-col gap-6">
      <MarketplaceFilters value={filters} onChange={setFilters} />

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8" aria-busy="true" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <MarketplaceGrid items={result.items} hasActiveFilters={hasActiveFilters} />
      )}

      {!loading && <MarketplacePagination page={result.page} pageSize={result.pageSize} total={result.total} onPageChange={handlePageChange} />}
    </div>
  );
}
