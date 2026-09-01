// services/algo-test/historical-data/symbol-timeframe-map.ts
// P3.2A Blocker 2 - the exact, fixed transformation tables identified in
// docs/P3.1-DATA-COMPATIBILITY.md SS1/SS2. Neither existing convention
// changes; this module is the ONLY place the mapping happens.
import type { AssetClass, Timeframe } from "at24-quant-engine";

/**
 * Canonical AT24 symbol ("XAUUSD") -> market.db's broker-suffixed row key
 * ("XAUUSD_EXNESS"). market.db's own `symbols` table confirms this exact
 * set (queried directly, not guessed - see P3.2A-HISTORICAL-DATA-CONTRACT.md).
 * Only symbols this provider has verified real M5 coverage for are listed;
 * an unlisted symbol is a real, honest "unsupported", never a guess.
 */
export const CANONICAL_TO_MARKET_DB_SYMBOL: Readonly<Record<string, string>> = {
  XAUUSD: "XAUUSD_EXNESS",
  EURUSD: "EURUSD_EXNESS",
  GBPUSD: "GBPUSD_EXNESS",
  USOIL: "USOIL_EXNESS",
  BTCUSD: "BTCUSD_EXNESS",
};

export function toMarketDbSymbol(canonicalSymbol: string): string | undefined {
  return CANONICAL_TO_MARKET_DB_SYMBOL[canonicalSymbol.toUpperCase()];
}

/** Matches market.db's own `symbols` table (contract_size/description) - real asset classes, not guessed. */
export const CANONICAL_SYMBOL_ASSET_CLASS: Readonly<Record<string, AssetClass>> = {
  XAUUSD: "metal",
  EURUSD: "forex",
  GBPUSD: "forex",
  USOIL: "other",
  BTCUSD: "crypto",
};

export function toAssetClass(canonicalSymbol: string): AssetClass | undefined {
  return CANONICAL_SYMBOL_ASSET_CLASS[canonicalSymbol.toUpperCase()];
}

/**
 * Engine Timeframe ("M5") -> market.db's own lowercase-shorthand row key
 * ("5m"). This is the same lowercase family Native Chart's own
 * SignalTimeframe uses (docs/P3.1-DATA-COMPATIBILITY.md SS2) - market.db
 * was built against that convention, not the engine's.
 */
export const ENGINE_TIMEFRAME_TO_MARKET_DB: Readonly<Partial<Record<Timeframe, string>>> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
};

export function toMarketDbTimeframe(timeframe: Timeframe): string | undefined {
  return ENGINE_TIMEFRAME_TO_MARKET_DB[timeframe];
}
