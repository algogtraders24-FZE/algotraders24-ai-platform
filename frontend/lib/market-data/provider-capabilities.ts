// lib/market-data/provider-capabilities.ts
// Sprint D2.6.6 - Indian Market Data Fabric & Angel One Live Validation.
// Sprint §7: "capability filtering happens BEFORE reliability ranking."
// This file is the general, provider-level statement of what KIND of
// instrument a provider can ever serve (asset class / market category /
// exchange / country) - a documented, testable rule, rather than an
// emergent property of which catalog entries happen to list which
// provider. It does NOT replace the D2.6.3 catalog's own per-instrument
// providerMappings (still the tighter, authoritative source of truth for
// "is THIS exact instrument mapped to THIS exact provider") - the two
// are combined (AND'd) in provider-reliability.service.ts#orderProviders,
// additively, so every existing catalog-driven exclusion still applies
// unchanged. This general profile exists so a rule like "never route an
// NSE instrument to Binance" is an explicit, asserted fact in one place,
// not just something that happens to be true today because no one wrote
// a Binance mapping for NIFTY.
import type { InstrumentAssetClass, CanonicalInstrument } from "@/types/canonical-instrument";
import type { MarketCategory } from "@/types/market";

export const PROVIDER_CAPABILITIES_VERSION = "1.0.0";

export interface ProviderCapabilityProfile {
  provider: string;
  /** undefined = not restricted to specific exchanges (e.g. a global vendor with no exchange concept). */
  supportedExchanges?: string[];
  /** undefined = not restricted to specific countries. */
  supportedCountries?: string[];
  supportedAssetClasses: InstrumentAssetClass[];
  supportedMarketCategories: MarketCategory[];
  supportsRealtime: boolean;
  supportsHistorical: boolean;
  /** True only for a provider whose own instrument list is itself queried for search (none today - InstrumentSearchService searches the platform's own catalog, never a live provider endpoint). */
  supportsInstrumentSearch: boolean;
}

/**
 * Documented, untuned "V1" profile per configured provider - deliberately
 * conservative (only asset classes/markets this platform has REAL,
 * verified mappings for today are listed; a provider genuinely capable of
 * more in reality but not yet wired here is simply not claimed).
 */
export const PROVIDER_CAPABILITY_PROFILES: Readonly<Record<string, ProviderCapabilityProfile>> = {
  "twelve-data": {
    provider: "twelve-data",
    supportedAssetClasses: ["forex", "commodity", "crypto"],
    supportedMarketCategories: ["forex", "commodities", "crypto"],
    supportsRealtime: true,
    supportsHistorical: true,
    supportsInstrumentSearch: false,
  },
  "alpha-vantage": {
    provider: "alpha-vantage",
    supportedAssetClasses: ["forex", "commodity"],
    supportedMarketCategories: ["forex", "commodities"],
    supportsRealtime: true,
    supportsHistorical: false,
    supportsInstrumentSearch: false,
  },
  binance: {
    provider: "binance",
    supportedAssetClasses: ["crypto"],
    supportedMarketCategories: ["crypto"],
    supportsRealtime: true,
    supportsHistorical: true,
    supportsInstrumentSearch: false,
  },
  "angel-one": {
    provider: "angel-one",
    supportedExchanges: ["NSE", "BSE"],
    supportedCountries: ["IN"],
    supportedAssetClasses: ["index", "equity"],
    supportedMarketCategories: ["indices", "stocks"],
    supportsRealtime: true,
    supportsHistorical: true,
    supportsInstrumentSearch: false,
  },
};

/**
 * Pure, deterministic. A provider with no registered profile is never
 * MORE restricted than before this sprint - it falls through as
 * unrestricted (`true`), leaving the catalog's own providerMappings as
 * the sole gate, exactly D2.6.4's existing behavior. A registered
 * profile can only ever EXCLUDE, never grant, an instrument the catalog
 * doesn't already map - see the AND-combination in orderProviders().
 */
export function providerSupportsInstrument(providerName: string, instrument: CanonicalInstrument): boolean {
  const profile = PROVIDER_CAPABILITY_PROFILES[providerName];
  if (!profile) return true;
  if (!profile.supportedAssetClasses.includes(instrument.assetClass)) return false;
  if (instrument.marketCategory && !profile.supportedMarketCategories.includes(instrument.marketCategory)) return false;
  if (profile.supportedExchanges && instrument.exchange && !profile.supportedExchanges.includes(instrument.exchange)) return false;
  if (profile.supportedCountries && instrument.country && !profile.supportedCountries.includes(instrument.country)) return false;
  return true;
}
