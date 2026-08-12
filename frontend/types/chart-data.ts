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
import type { FreshnessStatus } from "./provider-reliability";

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
 * that a fetch attempt failed. "stale" (Sprint D2.7.3) is now reachable:
 * the candles route's own short-lived TtlCache can serve an entry whose
 * age exceeds the D2.6.4 freshness policy for the requested timeframe -
 * always honestly stamped via `ChartSeries.freshness`, never presented as
 * live. "partial" (Sprint D2.7.3) means the series has at least one usable
 * candle but the normalizer also rejected at least one raw candle -
 * distinct from "ready" (zero rejections) so the UI can signal the
 * distinction without the caller having to inspect `rejectedCount` itself.
 */
export type ChartDataStatus = "loading" | "ready" | "partial" | "empty" | "stale" | "error" | "unsupported";

export interface ChartSeries {
  symbol: string;
  timeframe: SignalTimeframe;
  /** Oldest-first, integrity-validated (see candle-normalizer.ts) - never includes a candle that failed validation. */
  candles: ChartCandle[];
  /** How many raw candles the normalizer discarded for failing integrity checks (NaN/Infinity/high<low/etc) - 0 when the source data was fully clean. Reported honestly, never hidden. */
  rejectedCount: number;
  /** ISO 8601 UTC - when THIS route successfully obtained the series (a cache hit reports the ORIGINAL fetch time, not now - see `cacheAgeMs`). */
  retrievedAt: string;
  /**
   * Sprint D2.7.3 - real provider provenance, sourced from
   * MarketDataService.getTimeSeriesWithProvenance() (never a guess, never
   * fabricated). `provider` is the real MarketDataProvider.name that
   * served these candles. `providerSymbol` is looked up from the EXISTING
   * canonical instrument catalog's providerMappings for that provider -
   * undefined only when the catalog genuinely has no mapping recorded.
   * `fallbackUsed` mirrors MarketSnapshot's own D2.6.3 semantics exactly.
   */
  provider?: string;
  providerSymbol?: string;
  fallbackUsed?: boolean;
  /** True only when this response was served from the candles route's own short-lived cache rather than a live fetch this request. */
  cached?: boolean;
  /** Age of the cached value in ms - present only when `cached` is true. */
  cacheAgeMs?: number;
  /** D2.6.4's existing, timeframe-aware freshness policy (lib/market-data/... via services/market-data/freshness-policy.service.ts) applied to the latest candle's real timestamp - never a fabricated "fresh". */
  freshness?: FreshnessStatus;
  /** ISO 8601 UTC - the latest candle's own real datetime (the data's "as of" time), distinct from `retrievedAt` (when the route obtained it). Undefined only when the series is empty. */
  timestamp?: string;
}

export interface ChartDataResult {
  status: ChartDataStatus;
  series?: ChartSeries;
  /** Present for "error"/"unsupported" - honest, never a raw provider error string or credential. */
  message?: string;
}

/**
 * Sprint D2.7.3, Phase 11 - Multi-Symbol Compare Foundation. Architecture
 * ONLY - no UI consumes this yet (deliberately deferred, per the sprint
 * brief's own permission: "defer actual UI and document the extension
 * point" when implementing it risks expanding scope). A comparison series
 * is deliberately NOT normalized onto the primary series' raw price axis -
 * two unrelated instruments (e.g. NIFTY50 vs BANKNIFTY, or XAUUSD vs
 * XAGUSD) never share one y-scale; a real future renderer would plot this
 * as an independently-scaled overlay (its own right-hand axis, or a
 * percent-change-from-start normalization computed at render time, never
 * by mutating the underlying prices here) or a fully separate panel. This
 * type exists so a future sprint's ChartPanel/NativeChart can accept a
 * second ChartSeries without inventing a second data-fetch pattern - it
 * reuses the exact same ChartSeries/ChartCandle shape as the primary
 * series, just tagged with its own independent scale flag.
 */
export interface ComparisonSeries {
  primary: ChartSeries;
  comparison: ChartSeries;
  /** Always true today (no normalization is implemented yet) - documents the non-negotiable constraint for whoever builds the real renderer: never plot two different instruments' raw prices on one shared axis. */
  independentScale: true;
}
