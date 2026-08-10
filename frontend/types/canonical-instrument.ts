// types/canonical-instrument.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. See docs/architecture/D2.6.3-global-instrument-data-fabric-
// spec.md for the full architecture this contract supports.
//
// A CanonicalInstrument is the provider-NEUTRAL identity of a tradable
// market ("Bitcoin priced in US Dollars"), distinct from any single
// vendor's spelling of it ("BTCUSDT" on Binance, "BTC/USD" on Twelve
// Data). `id` is always the exact existing platform canonical symbol
// (types/market.ts#MarketSymbol, e.g. "BTCUSD") - the same string every
// downstream engine (MarketState/Regime/Hypothesis/DecisionContext)
// already keys on, so introducing this richer, searchable model never
// requires touching any of that code. Never invents metadata: a field
// left `undefined` means the real value genuinely isn't known, not a
// guess.
import type { MarketCategory, MarketSymbol } from "./market";

/**
 * Broader than MarketCategory (types/market.ts) - that union covers only
 * the 5 asset classes this platform's existing 15D/D2.5 pipeline has
 * ever priced; this one additionally distinguishes "equity"/"index"/
 * "etf"/"futures" for search/display purposes without changing
 * MarketCategory's own meaning anywhere it's already used.
 */
export type InstrumentAssetClass = "forex" | "crypto" | "equity" | "index" | "commodity" | "etf" | "futures" | "other";

/**
 * The only two market-data capabilities this platform can currently
 * exercise anywhere (a live spot/quote price, and historical OHLCV
 * candles) - deliberately not a longer list invented ahead of a real
 * consumer (e.g. no "orderbook"/"trades" capability exists because
 * nothing in this codebase reads one).
 */
export type MarketDataCapability = "quote" | "candles";

/**
 * One provider's real, verifiable mapping for a canonical instrument.
 * `verified: true` means this exact mapping's response shape was
 * actually confirmed against the real provider (live call or, where a
 * live call was deliberately not attempted this sprint, the provider's
 * own documented, stable response contract) before being declared here -
 * never added on assumption alone. A canonical instrument may have zero,
 * one, or several ProviderMappings; the router only ever attempts
 * providers listed here for that instrument.
 */
export interface ProviderMapping {
  /** Matches MarketDataProvider.name exactly (e.g. "binance", "twelve-data", "alpha-vantage", "angel-one"). */
  provider: string;
  providerSymbol: string;
  /** Only present when the provider has a separate opaque instrument identifier beyond its symbol string (e.g. an exchange token) - undefined, never fabricated, when none exists. */
  providerInstrumentId?: string;
  supportedCapabilities: MarketDataCapability[];
  verified: boolean;
}

export interface CanonicalInstrument {
  /** The exact existing platform canonical symbol (MarketSymbol) - the single key every downstream engine already uses. */
  id: MarketSymbol;
  /** Human-readable canonical symbol, e.g. "BTC/USD" - display only, never used as a lookup key. */
  symbol: string;
  displayName: string;
  assetClass: InstrumentAssetClass;
  /** Mirrors MarketCategory when this instrument is also priced by the existing 15D/D2.5 pipeline - undefined for instruments (e.g. NIFTY 50) outside that pipeline's current asset-class union. */
  marketCategory?: MarketCategory;
  exchange?: string;
  country?: string;
  currency?: string;
  /** Deterministic search aliases (lowercase, hand-authored) - e.g. ["bitcoin", "btc"] for BTCUSD. Never auto-generated/guessed. */
  aliases: string[];
  providerMappings: ProviderMapping[];
}
