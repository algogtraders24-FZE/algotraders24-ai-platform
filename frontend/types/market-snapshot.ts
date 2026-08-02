// types/market-snapshot.ts
// Sprint D2.2 (Phase 6) - the single, canonical, provider-neutral market data
// structure. Every module that needs a live quote (Market Intelligence,
// Dashboard, AI Assistant, future research modules) consumes THIS shape - not
// a provider response, and not one of the older ad-hoc quote shapes it
// supersedes. Optional fields mean "this provider had no value for it", never
// a guessed zero/neutral default (same honesty contract as
// MarketContextResult): a provider fills in only what it actually returned.
import type { MarketCategory, MarketSymbol } from "./market";

export type MarketStatus = "open" | "closed" | "unknown";

export interface MarketSnapshotOHLC {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketSnapshot {
  symbol: MarketSymbol;
  /** Human name from the market registry when known. */
  name?: string;
  assetClass: MarketCategory;
  /** Latest/close price in the quote currency. */
  price: number;
  bid?: number;
  ask?: number;
  /** Session OHLC when the provider supplies it (spot-only providers omit it). */
  ohlc?: MarketSnapshotOHLC;
  changePercent?: number;
  volume?: number;
  quoteCurrency: string;
  /** ISO 8601 UTC. The provider's own reading time when known, else retrievedAt. */
  timestamp: string;
  timezone: string;
  marketStatus: MarketStatus;
  provider: string;
  retrievedAt: string;
}
