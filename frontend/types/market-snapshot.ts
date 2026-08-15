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
  /** Sprint D2.8.1 - ask - bid, computed centrally by MarketDataService ONLY when both bid and ask are present and valid (ask >= bid). Never derived from price/candles, never a synthetic estimate. Absent whenever either side is absent. */
  spread?: number;
  /** Session OHLC when the provider supplies it (spot-only providers omit it). */
  ohlc?: MarketSnapshotOHLC;
  changePercent?: number;
  volume?: number;
  quoteCurrency: string;
  /** ISO 8601 UTC. The provider's own reading time when known, else retrievedAt - this IS the "source timestamp"; no separate field duplicates it. */
  timestamp: string;
  timezone: string;
  marketStatus: MarketStatus;
  provider: string;
  retrievedAt: string;
  /** Sprint D2.3.S3 - true only when this response was served from MarketDataService's own cache (fresh hit or a resilience stale-fallback) rather than a live provider call this request. Absent/false means live. */
  cached?: boolean;
  /** Sprint D2.3.S3 - age of the cached value in ms, only present when cached === true. */
  cacheAgeMs?: number;
  /** Sprint D2.6.3 - the winning provider's own symbol/pair spelling for this instrument (e.g. "BTCUSDT" for canonical "BTCUSD" on Binance), when the provider reports one distinct from the canonical `symbol` above. Undefined, never guessed, for a provider that has no separate concept of it. */
  providerSymbol?: string;
  /** Sprint D2.6.3 - true only when MarketDataService's provider-priority loop had to move past at least one higher-priority, configured provider (a real failure, not merely "not configured") to obtain this snapshot. Absent/false means the top-priority provider answered directly. Never fabricated - set only from the router's own real attempt history. */
  fallbackUsed?: boolean;
}
