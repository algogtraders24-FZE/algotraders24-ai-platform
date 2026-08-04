// services/market-data/shared-instance.ts
// Sprint D2.3 (Phase 9) - a single MarketDataService shared by every
// workspace snapshot route. Before this, /api/private/market-data/snapshot
// (WorkspaceHeader) and /api/private/market-data/snapshots (MarketRibbon)
// each constructed their own MarketDataService, so the same symbol's
// snapshot was fetched from the upstream provider on two independent
// schedules whenever it was both the active header symbol and a ribbon
// symbol. One shared instance means one cache, so either route's fetch can
// satisfy the other's cache window.
//
// TTL defaults to 60s - a middle ground between the ribbon's original 90s
// (rate-limit-conscious, but stale-feeling for an actively-watched header
// symbol) and the header's original 30s - and is overridable via
// MARKET_CACHE_TTL_MS so it can be tuned per environment without a code
// change (e.g. widened further if the provider's rate limit gets tight).
import { MarketDataService } from "./market-data.service";

const DEFAULT_CACHE_TTL_MS = 60_000;

function resolveCacheTtlMs(): number {
  const raw = Number(process.env.MARKET_CACHE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

export const marketData = new MarketDataService({ cacheTtlMs: resolveCacheTtlMs() });
