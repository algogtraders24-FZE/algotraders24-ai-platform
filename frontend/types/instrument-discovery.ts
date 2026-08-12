// types/instrument-discovery.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Provider-neutral shapes for the discovery layer
// (services/market-data/discovery/*) - deliberately separate from
// CanonicalInstrument (types/canonical-instrument.ts): a DiscoveredCandidate
// is raw, normalized provider output that has NOT yet been given a
// canonical identity; UniversalInstrumentDiscoveryService is the only
// place that turns one into a real CanonicalInstrument (via
// registerDiscoveredInstrument()). No second symbol registry - this is
// the input to the one that already exists.
import type { InstrumentAssetClass, MarketDataCapability } from "./canonical-instrument";
import type { MarketCategory } from "./market";

/** One provider-native instrument found by a discovery call - real fields only, never fabricated when the provider didn't return them. */
export interface DiscoveredCandidate {
  provider: string;
  providerSymbol: string;
  /** Only present when the provider has a separate opaque instrument identifier (e.g. Angel One's token) - never invented. */
  providerInstrumentId?: string;
  displayName: string;
  exchange?: string;
  country?: string;
  currency?: string;
  assetClass: InstrumentAssetClass;
  marketCategory?: MarketCategory;
  /**
   * What this provider can genuinely serve for this candidate TODAY via
   * this platform's real adapters - empty for a provider whose adapter
   * is frozen to a static symbol table (Twelve Data/Alpha Vantage
   * discovery is search/chart-metadata only, never claims market-data
   * capability it cannot actually deliver).
   */
  capabilities: MarketDataCapability[];
}

/** One discovery provider's outcome for one query - always returned, even on total failure, so a caller never has to guess why a provider contributed nothing. */
export interface ProviderDiscoveryResult {
  provider: string;
  candidates: DiscoveredCandidate[];
  /** True when this result came from a cache read older than the provider's normal TTL (a resilience fallback after a live fetch failed) - never silently indistinguishable from a fresh result. */
  stale: boolean;
  /** True when neither a fresh fetch nor a usable stale cache entry was available - candidates is always [] in that case, never fabricated. */
  failed: boolean;
  reason?: string;
}
