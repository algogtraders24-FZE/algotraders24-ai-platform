// services/market-data/provider-reliability.service.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. Pure, deterministic functions over the EXISTING,
// UNMODIFIED lib/market-data/health-monitor.ts's real recorded outcomes
// - no second health/tracking system. This file only interprets and
// ranks what MarketDataService's own ProviderHealthMonitor already
// observed; it never records an outcome itself.
//
// NON-NEGOTIABLE MEANING: the reliability score measures how reliably a
// provider actually delivers data - never a market-confidence score,
// never influenced by price direction or trading outcome. See
// types/provider-reliability.ts's header for the full statement.
import type { MarketSymbol } from "@/types/market";
import type { MarketDataProvider } from "@/types/market-data-provider";
import type { MarketDataCapability } from "@/types/canonical-instrument";
import type { ProviderHealthSnapshot } from "@/lib/market-data/health-monitor";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { providerSupportsInstrument } from "@/lib/market-data/provider-capabilities";
import type { ProviderReliability, ProviderReliabilityState } from "@/types/provider-reliability";

export const PROVIDER_RELIABILITY_VERSION = "1.0.0";

/**
 * Below this many real, recorded outcomes, a reliability score is
 * honestly "unknown" (undefined) rather than defaulted to 0 or 100 -
 * same discipline as D2.5.4's MIN_HISTORICAL_VALIDATION_SAMPLE and
 * D2.5.5's IntelligenceScore. A conventional, documented, UNTUNED "V1
 * heuristic" constant - there isn't remotely enough real production
 * traffic yet to tune it against without being circular.
 */
export const MIN_RELIABILITY_OBSERVATIONS = 3;

/** Consecutive failures required to trip the circuit breaker. Documented, untuned. */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
/** How long a tripped provider stays in cooldown before it's eligible for a real recovery-probe attempt again. Documented, untuned. */
export const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

// Scoring formula weights (sum to 100) - two real, observable dimensions
// only. Deliberately NOT: LLM, ML, historical profitability, price
// direction, or any trading outcome, per the sprint's explicit
// prohibition.
const SUCCESS_RATE_WEIGHT = 70;
const LATENCY_WEIGHT = 30;
const LATENCY_BUCKETS: readonly { maxMs: number; points: number }[] = [
  { maxMs: 500, points: LATENCY_WEIGHT },
  { maxMs: 2000, points: 20 },
  { maxMs: 5000, points: 10 },
  { maxMs: Number.POSITIVE_INFINITY, points: 0 },
];
/** Applied only when no lastLatencyMs is available at all - a real "we don't know" case, deliberately mid-scale so it neither rewards nor punishes an unmeasured provider. */
const NEUTRAL_LATENCY_POINTS = 15;
/** Reliability score used for ranking purposes ONLY when a provider's own score is unknown (fewer than MIN_RELIABILITY_OBSERVATIONS) - never written into the provider's own reported `reliabilityScore` field (which stays honestly undefined), only used as the ordering tie-break's neutral placeholder. */
const NEUTRAL_RANKING_SCORE = 50;

function isInCooldown(snapshot: ProviderHealthSnapshot, nowMs: number): boolean {
  if (snapshot.consecutiveFailures < CIRCUIT_BREAKER_FAILURE_THRESHOLD) return false;
  const lastCheckedMs = new Date(snapshot.lastCheckedAt).getTime();
  return nowMs - lastCheckedMs < CIRCUIT_BREAKER_COOLDOWN_MS;
}

function classifyState(snapshot: ProviderHealthSnapshot, nowMs: number): ProviderReliabilityState {
  const total = snapshot.successCount + snapshot.failureCount;
  if (total === 0) return "unknown";
  if (isInCooldown(snapshot, nowMs)) return "unavailable";
  if (snapshot.consecutiveFailures === 0 && snapshot.failureCount > 0) return "recovering";
  if (snapshot.consecutiveFailures === 0) return "healthy";
  // Covers both "1-2 consecutive failures" and "tripped the threshold but
  // cooldown has elapsed, not yet re-attempted" - both are honestly
  // "not fully trusted yet", never falsely reported as healthy.
  return "degraded";
}

function computeScore(snapshot: ProviderHealthSnapshot): number | undefined {
  const total = snapshot.successCount + snapshot.failureCount;
  if (total < MIN_RELIABILITY_OBSERVATIONS) return undefined;
  const successRate = snapshot.successCount / total;
  const successComponent = successRate * SUCCESS_RATE_WEIGHT;
  const latencyComponent =
    snapshot.lastLatencyMs === undefined
      ? NEUTRAL_LATENCY_POINTS
      : (LATENCY_BUCKETS.find((b) => (snapshot.lastLatencyMs as number) <= b.maxMs)?.points ?? 0);
  return Math.round(Math.max(0, Math.min(100, successComponent + latencyComponent)));
}

export interface ComputeReliabilityInput {
  provider: string;
  symbol: MarketSymbol;
  capability: MarketDataCapability;
  snapshot: ProviderHealthSnapshot;
  available: boolean;
  nowMs: number;
}

/** Pure: identical inputs always produce an identical ProviderReliability. */
export function computeReliability(input: ComputeReliabilityInput): ProviderReliability {
  const { snapshot, nowMs } = input;
  const total = snapshot.successCount + snapshot.failureCount;
  const state = classifyState(snapshot, nowMs);
  const cooldown = isInCooldown(snapshot, nowMs);
  const score = computeScore(snapshot);

  // lastCheckedAt is updated on every real push (success or failure) - so
  // when the most recent push was a success (consecutiveFailures === 0
  // and at least one success exists), it IS the last success time; when
  // the most recent push was a failure, it IS the last failure time.
  // Never a fabricated separate timestamp.
  const lastSuccessAt = snapshot.consecutiveFailures === 0 && snapshot.successCount > 0 ? snapshot.lastCheckedAt : undefined;
  const lastFailureAt = snapshot.consecutiveFailures > 0 ? snapshot.lastCheckedAt : undefined;

  const basis: string[] = [`${snapshot.successCount}/${total} recent request(s) in the rolling observation window succeeded`];
  if (snapshot.consecutiveFailures > 0) {
    basis.push(`${snapshot.consecutiveFailures} consecutive failure(s), last kind: "${snapshot.lastErrorKind ?? "unknown"}"`);
  }
  if (cooldown) {
    const cooldownUntil = new Date(new Date(snapshot.lastCheckedAt).getTime() + CIRCUIT_BREAKER_COOLDOWN_MS).toISOString();
    basis.push(`Circuit breaker tripped (>=${CIRCUIT_BREAKER_FAILURE_THRESHOLD} consecutive failures) - cooling down until ${cooldownUntil}`);
  }
  if (!input.available) {
    basis.push(`This instrument's catalog entry does not declare "${input.capability}" support for provider "${input.provider}"`);
  }
  if (score === undefined) {
    basis.push(`Fewer than ${MIN_RELIABILITY_OBSERVATIONS} observations (${total} so far) - reliability score is honestly unknown, never defaulted to 0`);
  }

  return {
    provider: input.provider,
    symbol: input.symbol,
    capability: input.capability,
    available: input.available,
    state,
    healthy: state === "healthy" || state === "recovering",
    consecutiveFailures: snapshot.consecutiveFailures,
    lastSuccessAt,
    lastFailureAt,
    lastLatencyMs: snapshot.lastLatencyMs,
    recentSuccessRate: total >= MIN_RELIABILITY_OBSERVATIONS ? snapshot.successCount / total : undefined,
    recentFailureRate: total >= MIN_RELIABILITY_OBSERVATIONS ? snapshot.failureCount / total : undefined,
    inCooldown: cooldown,
    reliabilityScore: score,
    basis,
    generatedAt: new Date(nowMs).toISOString(),
    version: PROVIDER_RELIABILITY_VERSION,
  };
}

export interface OrderProvidersInput {
  providers: readonly MarketDataProvider[];
  symbol: MarketSymbol;
  capability: MarketDataCapability;
  /** MarketDataService's own existing healthReport() output - the single source of truth, never a second tracker. */
  healthSnapshots: readonly ProviderHealthSnapshot[];
  nowMs: number;
}

const EMPTY_SNAPSHOT: Omit<ProviderHealthSnapshot, "provider" | "lastCheckedAt"> = {
  state: "healthy",
  consecutiveFailures: 0,
  successCount: 0,
  failureCount: 0,
};

/**
 * Deterministic smart-fallback ordering (sprint §5): capability-filter
 * (via the D2.6.3 instrument catalog, when the symbol is cataloged -
 * never breaks an un-cataloged symbol's existing reactive
 * unsupported_symbol handling) -> reliability-rank -> cooldown-
 * deprioritize (never fully excluded - a provider in cooldown is still
 * tried LAST rather than never, so the system never becomes MORE likely
 * to return insufficient-data than the plain fixed-order fallback it
 * replaces). Ties (including the common all-"unknown" case on a freshly
 * started server, where every provider has zero real observations yet)
 * break on the ORIGINAL array index - the existing, documented priority
 * order - so this function is a pure no-op reordering until real health
 * data actually exists to justify a change.
 */
export function orderProviders(input: OrderProvidersInput): MarketDataProvider[] {
  const instrument = getCanonicalInstrument(input.symbol);
  const snapshotByProvider = new Map(input.healthSnapshots.map((s) => [s.provider, s]));

  const decorated = input.providers.map((provider, index) => {
    const snapshot: ProviderHealthSnapshot = snapshotByProvider.get(provider.name) ?? {
      ...EMPTY_SNAPSHOT,
      provider: provider.name,
      lastCheckedAt: new Date(input.nowMs).toISOString(),
    };
    // Sprint D2.6.6 - AND'd with the general provider-capability matrix
    // (lib/market-data/provider-capabilities.ts#providerSupportsInstrument)
    // additively: a provider with no registered profile is unaffected
    // (falls through to `true`), so this can only ever further EXCLUDE a
    // provider the catalog itself already excludes for every existing
    // instrument - never grant one the catalog doesn't map. Makes rules
    // like "never route an NSE instrument to Binance" an explicit,
    // asserted fact rather than an emergent property of which catalog
    // entries happen to omit which provider.
    const available =
      !instrument ||
      (instrument.providerMappings.some((m) => m.provider === provider.name && m.supportedCapabilities.includes(input.capability)) &&
        providerSupportsInstrument(provider.name, instrument));
    const reliability = computeReliability({ provider: provider.name, symbol: input.symbol, capability: input.capability, snapshot, available, nowMs: input.nowMs });
    return { provider, reliability, index };
  });

  // Proactive capability filter only applies when the symbol IS cataloged
  // - an un-cataloged symbol falls through to every configured provider,
  // exactly like today, relying on each provider's own reactive check.
  const capabilityFiltered = instrument ? decorated.filter((d) => d.reliability.available) : decorated;
  // Never return zero candidates just because the catalog filter was
  // over-eager (e.g. a genuinely miscataloged instrument) - fall back to
  // the full list rather than silently producing no candidates at all.
  const candidates = capabilityFiltered.length > 0 ? capabilityFiltered : decorated;

  const byScoreThenPriority = (a: (typeof candidates)[number], b: (typeof candidates)[number]): number => {
    const scoreA = a.reliability.reliabilityScore ?? NEUTRAL_RANKING_SCORE;
    const scoreB = b.reliability.reliabilityScore ?? NEUTRAL_RANKING_SCORE;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.index - b.index;
  };

  const notInCooldown = candidates.filter((d) => !d.reliability.inCooldown);
  const inCooldown = candidates.filter((d) => d.reliability.inCooldown);

  const ordered = notInCooldown.length > 0 ? [...notInCooldown.sort(byScoreThenPriority), ...inCooldown.sort(byScoreThenPriority)] : [...candidates].sort(byScoreThenPriority);

  return ordered.map((d) => d.provider);
}
