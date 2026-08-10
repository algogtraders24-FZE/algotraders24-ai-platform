// types/provider-reliability.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. See docs/architecture/D2.6.4-provider-reliability-spec.md
// for the full formula, state-transition rules, and honesty discipline
// these contracts exist to enforce.
//
// NON-NEGOTIABLE MEANING (repeat this before touching this file): a
// reliability score measures ONE thing - "how reliable is this provider
// at actually delivering real data right now" - derived entirely from
// real, already-recorded request outcomes (lib/market-data/health-
// monitor.ts's existing ProviderHealthMonitor, never a second tracking
// system). It is NEVER a market-confidence score, NEVER a probability a
// trade succeeds, and NEVER influenced by price direction, historical
// profitability, or any trading outcome. Two completely different
// concepts share the word "reliable"/"confidence" elsewhere in this
// codebase (D2.5.5's IntelligenceScore, 15D.7's ConfidenceProfile) -
// this type must never be conflated with either.
import type { MarketSymbol } from "./market";
import type { MarketDataCapability } from "./canonical-instrument";

/**
 * Five states, deterministically derived from the existing
 * ProviderHealthMonitor's real recorded outcomes plus the current time -
 * never a new, independently-tracked state machine.
 * - "unknown": zero observations exist yet - never presented as "healthy".
 * - "healthy": no failures anywhere in the recent observation window.
 * - "degraded": at least one recent failure, but below the circuit-
 *   breaker trip threshold - still eligible for real requests.
 * - "unavailable": tripped the circuit breaker (consecutive failures at
 *   or above the documented threshold) and still within its cooldown
 *   window - deprioritized, not fully excluded, from provider ordering.
 * - "recovering": the most recent attempt succeeded (zero consecutive
 *   failures right now), but a real failure still exists somewhere in
 *   the recent window - trust is rebuilding, not yet fully restored.
 */
export type ProviderReliabilityState = "healthy" | "degraded" | "unavailable" | "recovering" | "unknown";

export interface ProviderReliability {
  provider: string;
  symbol: MarketSymbol;
  capability: MarketDataCapability;
  /** True only when this provider is configured AND declares this capability for this symbol in the instrument catalog (or the symbol is outside the catalog entirely, in which case this defaults true and the provider's own reactive unsupported_symbol check remains the source of truth). */
  available: boolean;
  state: ProviderReliabilityState;
  /** Convenience: true for "healthy" or "recovering" - the two states a caller should treat as safe to prefer. */
  healthy: boolean;
  consecutiveFailures: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastLatencyMs?: number;
  /** undefined (never 0) when fewer than MIN_RELIABILITY_OBSERVATIONS real outcomes exist - see the spec's honesty discipline. */
  recentSuccessRate?: number;
  recentFailureRate?: number;
  /** True only while the circuit breaker's cooldown window is still active for this provider - the router's actual skip/deprioritize signal. */
  inCooldown: boolean;
  /** 0-100. undefined (never 0, never 100) when fewer than MIN_RELIABILITY_OBSERVATIONS real outcomes exist. NEVER a market-confidence score - see this file's header. */
  reliabilityScore?: number;
  /** Deterministic, human-readable explanation of every component above - never a bare number with no reasoning. */
  basis: string[];
  generatedAt: string;
  /** Independent of any other version in this codebase - bumps only when this scoring/state formula itself changes. */
  version: string;
}

export type FreshnessStatus = "fresh" | "stale" | "unknown";

/**
 * status is never silently resolved to one provider "winning":
 * - "none": only one provider's value was available - nothing to compare.
 * - "acceptable-difference": both providers reported, within the
 *   documented tolerance for this field.
 * - "stale-provider": one provider's data is meaningfully older than
 *   the other's (per FreshnessPolicyService) - not a value conflict.
 * - "unresolved-conflict": both providers are fresh, both real, and
 *   materially disagree - preserved explicitly, never auto-resolved.
 */
export type CrossProviderConflictStatus = "none" | "acceptable-difference" | "stale-provider" | "unresolved-conflict";

export interface CrossProviderConflict {
  instrument: MarketSymbol;
  field: "price" | "open" | "high" | "low" | "close" | "volume" | "timestamp";
  providerA: string;
  providerB: string;
  valueA: number | string;
  valueB: number | string;
  timestampA?: string;
  timestampB?: string;
  /** Real, computed relative difference (|a-b|/max(|a|,|b|)) for numeric fields - undefined for the timestamp field, which is compared by elapsed time instead. */
  divergence?: number;
  status: CrossProviderConflictStatus;
  detectedAt: string;
  basis: string[];
}

export interface MarketSnapshotIntegrityIssue {
  field: string;
  description: string;
}

export interface MarketSnapshotIntegrityResult {
  symbol: MarketSymbol;
  valid: boolean;
  freshnessStatus: FreshnessStatus;
  /** Every reason `valid` is false, or every non-fatal observation when `valid` is true - never silent. */
  issues: MarketSnapshotIntegrityIssue[];
  checkedAt: string;
}
