// types/market-candle.ts
// Sprint D2.2 (Phase 7) - a normalized OHLC candle, provider-neutral, the
// input to the indicator engine. Volume is optional: forex/metals feeds often
// omit it while stocks include it, and a missing volume must stay absent
// (never a fabricated 0). Candle arrays are always ordered OLDEST-first so
// indicator math reads left-to-right.
export interface Candle {
  /** ISO date/datetime string as returned by the provider (already UTC-anchored where the provider gives a time). */
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TimeSeriesRequest {
  symbol: string;
  /** Provider interval, e.g. "1day", "1h". Providers map/validate this. Default "1day". */
  interval?: string;
  /** Number of candles requested. Default 100. */
  outputSize?: number;
}
