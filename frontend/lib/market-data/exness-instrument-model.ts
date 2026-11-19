// lib/market-data/exness-instrument-model.ts
// Pure helpers (no Node imports, safe in the browser) for instruments listed by the Exness Trading API:
// grouping, display labels and the canonical-catalog entry that makes such an instrument chartable.
// Nothing here invents an instrument: callers only pass symbols the Exness API listed.
import type { CanonicalInstrument } from "@/types/canonical-instrument";
import type { MarketCategory } from "@/types/market";

export type ExnessGroup = "forex" | "metals" | "energy" | "indices" | "crypto" | "stocks";

export interface ExnessInstrumentDto {
  symbol: string;
  /** Display form, e.g. "EUR/USD". */
  label: string;
  name: string;
  group: ExnessGroup;
}

const CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "SEK", "NOK", "DKK", "SGD", "HKD", "ZAR", "MXN", "TRY", "PLN", "CZK", "HUF", "CNH", "THB", "ILS", "RUB", "INR"]);
const METALS = /^(XAU|XAG|XPT|XPD|XCU)/;
const ENERGY = /^(USOIL|UKOIL|XNGUSD|XBRUSD|XTIUSD|NGAS|BRENT|WTI)/;
const CRYPTO_BASES = ["BTC", "ETH", "LTC", "XRP", "SOL", "ADA", "DOT", "DOGE", "BNB", "BCH", "LINK", "AVAX", "MATIC", "SHIB", "TRX", "XLM", "UNI", "ATOM", "NEAR", "ETC", "EOS", "XMR", "DASH", "ZEC", "NEO", "IOTA", "TON", "PEPE", "APT", "ARB", "OP", "SUI"];
const INDICES = new Set(["US30", "US500", "USTEC", "US2000", "UK100", "DE30", "DE40", "JP225", "HK50", "AUS200", "FR40", "STOXX50", "ES35", "IT40", "NL25", "CN50", "SG30", "DXY", "VIX"]);

export const EXNESS_GROUP_LABEL: Record<ExnessGroup, string> = { forex: "Forex", metals: "Metals", energy: "Energy", indices: "Indices", crypto: "Crypto", stocks: "Stocks" };
export const EXNESS_GROUPS: readonly ExnessGroup[] = ["forex", "metals", "energy", "indices", "crypto", "stocks"];

export function classifyExnessSymbol(symbolRaw: string): ExnessGroup {
  const s = symbolRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (METALS.test(s)) return "metals";
  if (ENERGY.test(s)) return "energy";
  if (INDICES.has(s)) return "indices";
  if (/^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3))) return "forex";
  if (CRYPTO_BASES.some((b) => s.startsWith(b) && /(USD|USDT|EUR|JPY|GBP)$/.test(s) && s.length <= b.length + 4)) return "crypto";
  return "stocks";
}

export function labelForSymbol(symbolRaw: string, group: ExnessGroup): string {
  const s = symbolRaw.toUpperCase();
  if ((group === "forex" || group === "metals") && /^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3)}`;
  if (group === "crypto") {
    const base = CRYPTO_BASES.find((b) => s.startsWith(b));
    if (base && s.length > base.length) return `${base}/${s.slice(base.length).replace(/^T/, "")}`;
  }
  return s;
}

const ASSET_CLASS: Record<ExnessGroup, CanonicalInstrument["assetClass"]> = { forex: "forex", metals: "commodity", energy: "commodity", indices: "index", crypto: "crypto", stocks: "equity" };
const MARKET_CATEGORY: Record<ExnessGroup, MarketCategory> = { forex: "forex", metals: "commodities", energy: "commodities", indices: "indices", crypto: "crypto", stocks: "stocks" };

export function toExnessDto(symbolRaw: string, description?: string): ExnessInstrumentDto {
  const symbol = symbolRaw.toUpperCase();
  const group = classifyExnessSymbol(symbol);
  return { symbol, label: labelForSymbol(symbol, group), name: description ?? symbol, group };
}

/** The canonical-catalog entry (mt5 provider mapping) that makes a listed Exness instrument chartable. */
export function buildExnessCanonical(entry: ExnessInstrumentDto): CanonicalInstrument {
  return {
    id: entry.symbol,
    symbol: entry.label,
    displayName: entry.name,
    assetClass: ASSET_CLASS[entry.group],
    marketCategory: MARKET_CATEGORY[entry.group],
    currency: /^[A-Z]{6}$/.test(entry.symbol) ? entry.symbol.slice(3) : "USD",
    aliases: [],
    providerMappings: [{ provider: "mt5", providerSymbol: entry.symbol, supportedCapabilities: ["quote", "candles"], verified: true }],
    discovery: { source: "exness-api", discoveredAt: new Date().toISOString() },
  };
}
