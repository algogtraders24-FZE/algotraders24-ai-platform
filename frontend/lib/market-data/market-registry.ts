// lib/market-data/market-registry.ts
// Sprint D2.2 (Phase 5) - Multi-Market Foundation. A single, provider-
// INDEPENDENT catalog of the markets the platform knows about, spanning all
// five asset classes (forex, commodities, indices, stocks, crypto). This is
// the canonical source of truth for "what is symbol X?" - its name, asset
// class, and base/quote currency - decoupled from any vendor's symbol
// spelling. A provider maps these canonical symbols to its own vendor symbols
// (see each provider's SYMBOL_MAP) and advertises which ones it can actually
// serve; the registry itself never calls a vendor.
//
// The architecture supports every asset class today even though only a subset
// is enabled: `enabled` marks which markets at least one configured provider
// is expected to serve now. Turning on a new market later is a data change
// here plus a provider mapping - never a change to the service, pipeline, or
// any consumer. This is the seam that lets Polygon / broker feeds / new asset
// classes plug in without touching the rest of the platform.
import type { MarketCategory, MarketSymbol } from "@/types/market";

export interface MarketDefinition {
  /** Canonical platform symbol, e.g. "EURUSD", "XAUUSD", "BTCUSD". */
  symbol: MarketSymbol;
  name: string;
  assetClass: MarketCategory;
  baseCurrency: string;
  quoteCurrency: string;
  /** True when at least one configured provider is expected to serve this today. */
  enabled: boolean;
}

// Ordered, human-authored catalog. `enabled` reflects current Twelve Data
// coverage (forex majors, metals, top crypto); indices/stocks are modelled
// but disabled until a provider mapping is added - proving the multi-market
// design without claiming coverage that isn't wired.
const DEFINITIONS: readonly MarketDefinition[] = [
  // Forex
  { symbol: "EURUSD", name: "Euro / US Dollar", assetClass: "forex", baseCurrency: "EUR", quoteCurrency: "USD", enabled: true },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "forex", baseCurrency: "GBP", quoteCurrency: "USD", enabled: true },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", assetClass: "forex", baseCurrency: "USD", quoteCurrency: "JPY", enabled: true },
  // Commodities (metals as XAU/XAG spot)
  { symbol: "XAUUSD", name: "Gold Spot / US Dollar", assetClass: "commodities", baseCurrency: "XAU", quoteCurrency: "USD", enabled: true },
  { symbol: "XAGUSD", name: "Silver Spot / US Dollar", assetClass: "commodities", baseCurrency: "XAG", quoteCurrency: "USD", enabled: true },
  // Crypto
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", assetClass: "crypto", baseCurrency: "BTC", quoteCurrency: "USD", enabled: true },
  { symbol: "ETHUSD", name: "Ethereum / US Dollar", assetClass: "crypto", baseCurrency: "ETH", quoteCurrency: "USD", enabled: true },
  // Indices (modelled, not yet enabled - no provider mapping wired)
  { symbol: "SPX", name: "S&P 500 Index", assetClass: "indices", baseCurrency: "SPX", quoteCurrency: "USD", enabled: false },
  { symbol: "NDX", name: "Nasdaq 100 Index", assetClass: "indices", baseCurrency: "NDX", quoteCurrency: "USD", enabled: false },
  // Stocks (modelled, not yet enabled)
  { symbol: "AAPL", name: "Apple Inc.", assetClass: "stocks", baseCurrency: "AAPL", quoteCurrency: "USD", enabled: false },
];

const BY_SYMBOL: ReadonlyMap<string, MarketDefinition> = new Map(DEFINITIONS.map((d) => [d.symbol, d]));

/** The full catalog (all asset classes, enabled and not). */
export function listMarkets(): readonly MarketDefinition[] {
  return DEFINITIONS;
}

/** Markets currently expected to be serveable by a configured provider. */
export function listEnabledMarkets(): MarketDefinition[] {
  return DEFINITIONS.filter((d) => d.enabled);
}

export function listByAssetClass(assetClass: MarketCategory): MarketDefinition[] {
  return DEFINITIONS.filter((d) => d.assetClass === assetClass);
}

export function getMarket(symbol: string): MarketDefinition | undefined {
  return BY_SYMBOL.get(symbol);
}

export function isKnownMarket(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

export function isEnabledMarket(symbol: string): boolean {
  return BY_SYMBOL.get(symbol)?.enabled === true;
}

/** The asset classes the catalog spans - the multi-market surface, even where a class is not yet enabled. */
export function assetClasses(): MarketCategory[] {
  return Array.from(new Set(DEFINITIONS.map((d) => d.assetClass)));
}
