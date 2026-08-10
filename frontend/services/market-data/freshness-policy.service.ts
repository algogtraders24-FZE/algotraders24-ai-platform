// services/market-data/freshness-policy.service.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. A single, asset-class-and-timeframe-aware freshness
// policy - never one global threshold for every market (sprint §10's
// explicit example: a 1-minute candle and a daily candle do not share
// freshness semantics). Pure, deterministic, no I/O.
//
// This is a NEW analysis layer over EXISTING real fields
// (MarketSnapshot.timestamp, Candle.datetime) - it does not replace or
// duplicate lib/market-data/cache.ts's TtlCache/staleFallback mechanism,
// which remains the only thing that decides what MarketDataService
// actually serves. This service answers a different question: "given
// this real timestamp, how fresh is it per an honest, documented,
// per-asset-class/per-timeframe policy" - useful for the new
// MarketSnapshotIntegrityService (services/market-data/market-snapshot-
// integrity.service.ts) and for reporting, never for gating what the
// existing cache already gates.
import type { MarketCategory } from "@/types/market";
import type { SignalTimeframe } from "@/types/signal";
import type { FreshnessStatus } from "@/types/provider-reliability";

export const FRESHNESS_POLICY_VERSION = "1.0.0";

/**
 * Live-quote freshness thresholds, per asset class - documented, untuned
 * "V1 heuristic" constants (same honesty-labeling discipline as every
 * other scoring constant in this codebase). Crypto trades 24/7 and this
 * platform's crypto providers (Binance, Twelve Data) refresh quickly, so
 * it gets the tightest threshold; equities/indices (Angel One) are
 * expected to refresh less aggressively.
 */
const QUOTE_FRESHNESS_THRESHOLD_MS: Record<MarketCategory, number> = {
  crypto: 30_000,
  forex: 60_000,
  commodities: 60_000,
  indices: 5 * 60_000,
  stocks: 5 * 60_000,
};

/**
 * Candle freshness is relative to the timeframe's own bar duration, not
 * a fixed millisecond value - the sprint's own worked example. A candle
 * is "fresh" as long as its own bar period hasn't fully elapsed since it
 * closed; a stricter/looser multiplier is a real, documented policy
 * choice, not an arbitrary one.
 */
const TIMEFRAME_MS: Record<SignalTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};
const CANDLE_FRESHNESS_BAR_MULTIPLIER = 1;

export type FreshnessSubject = { kind: "quote"; assetClass: MarketCategory } | { kind: "candle"; timeframe: SignalTimeframe };

export interface AssessFreshnessInput {
  subject: FreshnessSubject;
  /** The real timestamp being assessed - MarketSnapshot.timestamp for a quote, or the latest Candle.datetime for a series. */
  timestamp: string | undefined;
  nowMs: number;
}

export interface FreshnessAssessment {
  status: FreshnessStatus;
  thresholdMs?: number;
  ageMs?: number;
  basis: string[];
  version: string;
}

function thresholdFor(subject: FreshnessSubject): number {
  return subject.kind === "quote" ? QUOTE_FRESHNESS_THRESHOLD_MS[subject.assetClass] : TIMEFRAME_MS[subject.timeframe] * CANDLE_FRESHNESS_BAR_MULTIPLIER;
}

/** Pure: identical inputs always produce an identical assessment. Never "fresh" when the timestamp is missing/unparseable - that is honestly "unknown", never guessed as fresh. */
export function assessFreshness(input: AssessFreshnessInput): FreshnessAssessment {
  const threshold = thresholdFor(input.subject);
  const label = input.subject.kind === "quote" ? `quote (${input.subject.assetClass})` : `candle (${input.subject.timeframe} bar)`;

  if (!input.timestamp) {
    return { status: "unknown", basis: [`No real timestamp was supplied for this ${label} - freshness cannot be assessed`], version: FRESHNESS_POLICY_VERSION };
  }
  const timestampMs = new Date(input.timestamp).getTime();
  if (Number.isNaN(timestampMs)) {
    return { status: "unknown", basis: [`Timestamp "${input.timestamp}" for this ${label} is not a parseable date - freshness cannot be assessed`], version: FRESHNESS_POLICY_VERSION };
  }

  const ageMs = Math.max(0, input.nowMs - timestampMs);
  const status: FreshnessStatus = ageMs <= threshold ? "fresh" : "stale";
  return {
    status,
    thresholdMs: threshold,
    ageMs,
    basis: [`This ${label} is ${ageMs}ms old against a documented ${threshold}ms freshness threshold`],
    version: FRESHNESS_POLICY_VERSION,
  };
}
