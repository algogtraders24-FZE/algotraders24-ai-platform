// services/algo-test/historical-data/types.ts
// P3.2A Blocker 2 - the HistoricalDataProvider abstraction. The Quant
// Engine (at24-quant-engine) must receive normalized OHLCVBar[] without
// knowing where the bars came from - this file is the seam. Bars produced
// by any implementation of HistoricalDataProvider are already in
// at24-quant-engine's own OHLCVBar shape (re-exported from the package,
// never redefined here) so no adapter is needed downstream of getBars().
import type { OHLCVBar, Timeframe } from "at24-quant-engine";

/** A single provider's own timeframe token, before normalization to the engine's Timeframe enum. */
export type ProviderTimeframe = string;

export interface HistoricalBarsRequest {
  /** A canonical AT24 symbol, e.g. "XAUUSD" - never a provider-specific/broker-suffixed variant. */
  symbol: string;
  /** The engine's own Timeframe enum ("M5", etc.) - normalization to a provider's own convention happens inside the provider. */
  timeframe: Timeframe;
  /** ISO 8601 UTC. */
  startTime: string;
  /** ISO 8601 UTC. */
  endTime: string;
}

/**
 * Every implementation must return bars already validated (see
 * validate-bars.ts) - `bars` is empty and `rejected` is populated when the
 * source data failed validation, never a partially-fabricated result.
 */
export interface HistoricalBarsResult {
  bars: readonly OHLCVBar[];
  /** Real gaps/rejections found - never silently dropped, always surfaced. */
  rejected: readonly BarRejection[];
  /** Where this data actually came from - surfaced in result provenance, never hidden. */
  source: string;
}

export interface BarRejection {
  reason: "DUPLICATE_TIMESTAMP" | "OUT_OF_ORDER" | "INVALID_OHLC" | "SYMBOL_MISMATCH" | "TIMEFRAME_MISMATCH";
  detail: string;
  /** epoch ms, when known. */
  timestamp?: number;
}

export interface HistoricalDataProvider {
  readonly id: string;
  getBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResult>;
}
