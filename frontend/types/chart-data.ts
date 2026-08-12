// types/chart-data.ts
// Sprint D2.7.2 - AT24 Native Chart Engine Foundation. The canonical,
// provider-neutral shape the native chart engine renders. Deliberately NOT
// a new candle model: `ChartCandle` is a thin, chart-local view over the
// EXISTING `Candle` (types/market-candle.ts) - only the datetime string is
// converted to an epoch-millisecond `time` field the coordinate system can
// do arithmetic on directly. Every OHLCV value is copied through unchanged,
// never recomputed/rounded/fabricated. See lib/chart-engine/candle-
// normalizer.ts for the one place raw Candle[] becomes ChartCandle[].
import type { SignalTimeframe } from "./signal";

export interface ChartCandle {
  /** Epoch milliseconds, UTC - derived from Candle.datetime, never a guessed value. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type ChartCandleTrend = "bullish" | "bearish" | "doji";

/**
 * The explicit chart-provider boundary this sprint introduces (see Phase 13
 * of the sprint brief): which visualization renders the Workspace's chart
 * panel. "tradingview" is the existing, proven D2.6.11 integration;
 * "native" is this sprint's new engine. Neither is a fallback for the
 * other - the Workspace lets the user choose explicitly.
 */
export type ChartProviderKind = "native" | "tradingview";

/**
 * Every state the native chart's data-fetching hook can honestly be in.
 * "unsupported" is distinct from "error": it means chart-instrument-
 * resolver.ts (or the candles route's own symbol lookup) has already
 * determined no real data can ever be fetched for this instrument, not
 * that a fetch attempt failed. "stale" is reserved for a future caching
 * layer - this sprint's route performs a live fetch on every request
 * (MarketDataService.getTimeSeries is not cached at the service level,
 * see that method's own comment), so "stale" is not currently reachable,
 * but is declared now so a future sprint's cache doesn't need a second
 * status enum.
 */
export type ChartDataStatus = "loading" | "ready" | "empty" | "stale" | "error" | "unsupported";

export interface ChartSeries {
  symbol: string;
  timeframe: SignalTimeframe;
  /** Oldest-first, integrity-validated (see candle-normalizer.ts) - never includes a candle that failed validation. */
  candles: ChartCandle[];
  /** How many raw candles the normalizer discarded for failing integrity checks (NaN/Infinity/high<low/etc) - 0 when the source data was fully clean. Reported honestly, never hidden. */
  rejectedCount: number;
  /** ISO 8601 UTC - when THIS route successfully obtained the series, not a provider-reported time (MarketDataService.getTimeSeries does not expose which provider served the request or its own timestamp - a known limitation, see the sprint spec). */
  retrievedAt: string;
}

export interface ChartDataResult {
  status: ChartDataStatus;
  series?: ChartSeries;
  /** Present for "error"/"unsupported" - honest, never a raw provider error string or credential. */
  message?: string;
}
