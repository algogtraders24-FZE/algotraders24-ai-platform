// lib/market-data/instrument-catalog.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. The hand-authored, provider-neutral catalog of
// CanonicalInstruments this platform can search for and resolve -
// exactly the same "ordered, human-authored, list only what's real"
// discipline market-registry.ts already established, extended with
// aliases and real provider mappings.
//
// Relationship to market-registry.ts: that file remains the lightweight,
// unmodified catalog the EXISTING 15D/D2.5/D2.6 pipeline and UI already
// depend on (symbol/name/assetClass/enabled) - untouched by this sprint.
// This file is the richer, SEARCHABLE superset introduced for instrument
// discovery; every instrument that also exists in market-registry.ts
// uses the exact same `id` (canonical MarketSymbol) so the two catalogs
// never diverge for a symbol that appears in both.
//
// Source-of-truth split for providerMappings (deliberate, see the
// D2.6.3 architecture spec §3 audit):
//   - twelve-data / alpha-vantage: these adapters are EXISTING, FROZEN,
//     already-tested code with their own internal SYMBOL_MAP - never
//     rewritten to read from this catalog. The mappings below are a
//     truthful, manually-kept-in-sync MIRROR of what those adapters
//     already hardcode, for search/display purposes only.
//   - binance / angel-one: these are the NEW adapters this sprint adds.
//     They have no prior frozen symbol table, so they read their symbol
//     resolution directly FROM this catalog (see
//     lib/market-data/providers/binance.provider.ts /
//     angel-one.provider.ts) - a single source of truth, not a second
//     copy to keep in sync.
//
// `verified` on a ProviderMapping means: this exact provider/symbol/
// token combination was confirmed to identify a REAL instrument via a
// real, live check (either a live market-data call, or - for Angel One,
// where live authentication was deliberately not attempted this session,
// see angel-one.provider.ts's header - a live, unauthenticated fetch of
// Angel One's own public instrument scrip master). It does NOT mean
// "this session executed a fully authenticated end-to-end quote fetch
// for this instrument" - see each entry's own comment for exactly what
// was confirmed and when.
import type { CanonicalInstrument } from "@/types/canonical-instrument";

export const INSTRUMENT_CATALOG: readonly CanonicalInstrument[] = [
  // ---- Forex (existing, enabled market-registry.ts entries) ----
  {
    id: "EURUSD",
    symbol: "EUR/USD",
    displayName: "Euro / US Dollar",
    assetClass: "forex",
    marketCategory: "forex",
    currency: "USD",
    aliases: ["euro", "eur"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "EUR/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      { provider: "alpha-vantage", providerSymbol: "EUR", supportedCapabilities: ["quote"], verified: true },
    ],
  },
  {
    id: "GBPUSD",
    symbol: "GBP/USD",
    displayName: "British Pound / US Dollar",
    assetClass: "forex",
    marketCategory: "forex",
    currency: "USD",
    aliases: ["pound", "sterling", "cable", "gbp"],
    providerMappings: [{ provider: "twelve-data", providerSymbol: "GBP/USD", supportedCapabilities: ["quote", "candles"], verified: true }],
  },
  {
    id: "USDJPY",
    symbol: "USD/JPY",
    displayName: "US Dollar / Japanese Yen",
    assetClass: "forex",
    marketCategory: "forex",
    currency: "JPY",
    aliases: ["yen", "jpy"],
    providerMappings: [{ provider: "twelve-data", providerSymbol: "USD/JPY", supportedCapabilities: ["quote", "candles"], verified: true }],
  },

  // ---- Commodities ----
  {
    id: "XAUUSD",
    symbol: "XAU/USD",
    displayName: "Gold Spot / US Dollar",
    assetClass: "commodity",
    marketCategory: "commodities",
    currency: "USD",
    aliases: ["gold", "xau"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "XAU/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      // Sprint L2.1 confirmed CURRENCY_EXCHANGE_RATE genuinely rejects XAU
      // for the currently configured Alpha Vantage key/tier ("Invalid API
      // call") - the code path is real and correct, but this exact
      // mapping is honestly marked unverified (not working today), never
      // silently omitted or falsely marked verified.
      { provider: "alpha-vantage", providerSymbol: "XAU", supportedCapabilities: ["quote"], verified: false },
    ],
  },
  {
    id: "XAGUSD",
    symbol: "XAG/USD",
    displayName: "Silver Spot / US Dollar",
    assetClass: "commodity",
    marketCategory: "commodities",
    currency: "USD",
    aliases: ["silver", "xag"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "XAG/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      // Same confirmed-unavailable status as XAUUSD above - see that entry's comment.
      { provider: "alpha-vantage", providerSymbol: "XAG", supportedCapabilities: ["quote"], verified: false },
    ],
  },

  // ---- Crypto ----
  {
    id: "BTCUSD",
    symbol: "BTC/USD",
    displayName: "Bitcoin / US Dollar",
    assetClass: "crypto",
    marketCategory: "crypto",
    currency: "USD",
    aliases: ["bitcoin", "btc"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "BTC/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      // Live-verified 2026-08-10 against https://api.binance.com/api/v3/ticker/24hr and /klines (see binance.provider.ts header).
      { provider: "binance", providerSymbol: "BTCUSDT", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "ETHUSD",
    symbol: "ETH/USD",
    displayName: "Ethereum / US Dollar",
    assetClass: "crypto",
    marketCategory: "crypto",
    currency: "USD",
    aliases: ["ethereum", "eth"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "ETH/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      { provider: "binance", providerSymbol: "ETHUSDT", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "SOLUSD",
    symbol: "SOL/USD",
    displayName: "Solana / US Dollar",
    assetClass: "crypto",
    marketCategory: "crypto",
    currency: "USD",
    aliases: ["solana", "sol"],
    providerMappings: [
      // Sprint D2.3.S3 - live-verified against Twelve Data's own /quote endpoint (see twelve-data.provider.ts header).
      { provider: "twelve-data", providerSymbol: "SOL/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      { provider: "binance", providerSymbol: "SOLUSDT", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "XRPUSD",
    symbol: "XRP/USD",
    displayName: "XRP / US Dollar",
    assetClass: "crypto",
    marketCategory: "crypto",
    currency: "USD",
    aliases: ["ripple", "xrp"],
    providerMappings: [
      { provider: "twelve-data", providerSymbol: "XRP/USD", supportedCapabilities: ["quote", "candles"], verified: true },
      { provider: "binance", providerSymbol: "XRPUSDT", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },

  // ---- India (NSE) via Angel One - genuinely new asset coverage this
  // sprint, outside market-registry.ts's existing 5-asset-class union. ----
  {
    id: "NIFTY50",
    symbol: "NIFTY 50",
    displayName: "NIFTY 50 Index",
    assetClass: "index",
    marketCategory: "indices",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["nifty", "nifty50", "nifty 50", "nifty index"],
    providerMappings: [
      // Symbol/token confirmed live 2026-08-10 against Angel One's own
      // public, unauthenticated instrument scrip master (https://
      // margincalculator.angelbroking.com/OpenAPI_File/files/
      // OpenAPIScripMaster.json) - real token "99926000", exch_seg
      // "NSE". Sprint D2.6.6 additionally ran a real, authenticated live
      // quote fetch on 2026-08-11 (see angel-one.provider.ts's header) -
      // this exact mapping was confirmed to return a real price.
      { provider: "angel-one", providerSymbol: "Nifty 50", providerInstrumentId: "99926000", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "RELIANCE",
    symbol: "RELIANCE",
    displayName: "Reliance Industries Ltd",
    assetClass: "equity",
    marketCategory: "stocks",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["reliance industries", "reliance ltd"],
    providerMappings: [
      // Symbol/token confirmed live 2026-08-10 against the same public
      // scrip master - real token "2885", symbol "RELIANCE-EQ", exch_seg
      // "NSE". Sprint D2.6.6 additionally ran a real, authenticated live
      // quote fetch on 2026-08-11 (see angel-one.provider.ts's header) -
      // this exact mapping was confirmed to return a real price.
      { provider: "angel-one", providerSymbol: "RELIANCE-EQ", providerInstrumentId: "2885", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "BANKNIFTY",
    symbol: "BANK NIFTY",
    displayName: "NIFTY Bank Index",
    assetClass: "index",
    marketCategory: "indices",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["banknifty", "bank nifty", "nifty bank"],
    providerMappings: [
      // Sprint D2.6.6 - symbol/token confirmed live 2026-08-11 against
      // the same public, unauthenticated scrip master: real token
      // "99926009", symbol "Nifty Bank" (instrumenttype "AMXIDX", the
      // same cash-index convention already verified for NIFTY50's
      // "99926000" - NOT the plain futures-style "BANKNIFTY"/26009
      // entry the same file also contains, which is a different real
      // instrument). This exact mapping was additionally confirmed via a
      // real, authenticated live quote fetch on 2026-08-11 (see
      // angel-one.provider.ts's header).
      { provider: "angel-one", providerSymbol: "Nifty Bank", providerInstrumentId: "99926009", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "TCS",
    symbol: "TCS",
    displayName: "Tata Consultancy Services Ltd",
    assetClass: "equity",
    marketCategory: "stocks",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["tata consultancy", "tata consultancy services", "tcs ltd"],
    providerMappings: [
      // Sprint D2.6.6 - symbol/token confirmed live 2026-08-11 against
      // the same public scrip master - real token "11536", symbol
      // "TCS-EQ", exch_seg "NSE". Authenticated quote retrieval NOT
      // live-verified this session.
      { provider: "angel-one", providerSymbol: "TCS-EQ", providerInstrumentId: "11536", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "INFY",
    symbol: "INFY",
    displayName: "Infosys Ltd",
    assetClass: "equity",
    marketCategory: "stocks",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["infosys", "infosys ltd", "infosys limited"],
    providerMappings: [
      // Sprint D2.6.6 - symbol/token confirmed live 2026-08-11 against
      // the same public scrip master - real token "1594", symbol
      // "INFY-EQ", exch_seg "NSE". Authenticated quote retrieval NOT
      // live-verified this session.
      { provider: "angel-one", providerSymbol: "INFY-EQ", providerInstrumentId: "1594", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },
  {
    id: "HDFCBANK",
    symbol: "HDFCBANK",
    displayName: "HDFC Bank Ltd",
    assetClass: "equity",
    marketCategory: "stocks",
    exchange: "NSE",
    country: "IN",
    currency: "INR",
    aliases: ["hdfc bank", "hdfc bank ltd"],
    providerMappings: [
      // Sprint D2.6.6 - symbol/token confirmed live 2026-08-11 against
      // the same public scrip master - real token "1333", symbol
      // "HDFCBANK-EQ", exch_seg "NSE". Authenticated quote retrieval NOT
      // live-verified this session.
      { provider: "angel-one", providerSymbol: "HDFCBANK-EQ", providerInstrumentId: "1333", supportedCapabilities: ["quote", "candles"], verified: true },
    ],
  },

  // ---- Genuinely searchable, genuinely unavailable - the honest "no
  // fabricated coverage" state (sprint §16). Mirrors market-registry
  // .ts's own AAPL entry (assetClass "stocks", enabled: false): no
  // configured provider in this platform serves US equities today, so
  // this instrument has zero providerMappings on purpose. Search finds
  // it (it's a real instrument); the router will honestly report
  // "unavailable" if ever asked to fetch a quote for it - never a
  // fabricated price. ----
  {
    id: "AAPL",
    symbol: "AAPL",
    displayName: "Apple Inc.",
    assetClass: "equity",
    marketCategory: "stocks",
    exchange: "NASDAQ",
    country: "US",
    currency: "USD",
    aliases: ["apple", "apple inc"],
    providerMappings: [],
  },
];

const BY_ID: ReadonlyMap<string, CanonicalInstrument> = new Map(INSTRUMENT_CATALOG.map((i) => [i.id, i]));

// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. An additive, in-memory, server-side-only registry for
// instruments found by live provider discovery (Binance exchangeInfo,
// Angel One's scrip master, Twelve Data/Alpha Vantage symbol search) -
// NOT a second symbol registry: it is read by the exact same
// getCanonicalInstrument()/listCanonicalInstruments()/mappingsForProvider()
// functions every existing caller (WorkspaceContext, chat resolution,
// BinanceProvider, AngelOneProvider, InstrumentSearchService) already
// uses, so a discovered instrument becomes resolvable platform-wide the
// moment it is registered, with zero new lookup path anywhere else.
//
// A discovered id can NEVER collide with or overwrite a hand-authored
// INSTRUMENT_CATALOG entry (registerDiscoveredInstrument() below is a
// no-op for any id already present in BY_ID) - the static catalog is
// always authoritative for the 16 instruments it curates. No database
// writes happen here at all (see services/market-data/discovery/*'s own
// header for why - in-memory + TTL-cached is sufficient and avoids any
// "database explosion from uncontrolled duplicate instruments").
const DISCOVERED: Map<string, CanonicalInstrument> = new Map();

/**
 * Registers a provider-discovered instrument so every existing catalog
 * consumer can resolve it. Idempotent and additive only: a no-op when
 * `id` is already a real, hand-authored catalog entry (never silently
 * overwritten); a fresh discovery of an id already in DISCOVERED
 * replaces that entry's providerMappings (a provider's own metadata for
 * the same instrument may legitimately change between discovery runs -
 * e.g. a re-issued Angel One token - never a merge with a DIFFERENT
 * provider's earlier discovery of a similarly-named instrument, since
 * `id` for a discovered instrument is always a deterministic,
 * provider-scoped composite - see services/market-data/discovery/
 * universal-instrument-discovery.service.ts's identity rules).
 */
export function registerDiscoveredInstrument(instrument: CanonicalInstrument): void {
  if (BY_ID.has(instrument.id)) return;
  DISCOVERED.set(instrument.id, instrument);
}

/** Test/dev-only reset of the discovery registry - never called from production code paths. */
export function clearDiscoveredInstruments(): void {
  DISCOVERED.clear();
}

export function getCanonicalInstrument(id: string): CanonicalInstrument | undefined {
  return BY_ID.get(id) ?? DISCOVERED.get(id);
}

export function listCanonicalInstruments(): readonly CanonicalInstrument[] {
  return DISCOVERED.size === 0 ? INSTRUMENT_CATALOG : [...INSTRUMENT_CATALOG, ...DISCOVERED.values()];
}

/** All providerMappings for one provider across the whole catalog (static + discovered) - what an adapter (Binance, Angel One) reads as its own symbol table, single source of truth. */
export function mappingsForProvider(provider: string): { instrument: CanonicalInstrument; mapping: CanonicalInstrument["providerMappings"][number] }[] {
  const results: { instrument: CanonicalInstrument; mapping: CanonicalInstrument["providerMappings"][number] }[] = [];
  for (const instrument of listCanonicalInstruments()) {
    for (const mapping of instrument.providerMappings) {
      if (mapping.provider === provider) results.push({ instrument, mapping });
    }
  }
  return results;
}
