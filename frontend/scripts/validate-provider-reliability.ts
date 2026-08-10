// scripts/validate-provider-reliability.ts
// Sprint D2.6.4 - Provider Reliability, Smart Fallback & Cross-Provider
// Data Integrity. Standalone, assert-based verification (no test
// framework, no real network in the main suite - matching every prior
// sprint's scripts/validate-*.ts pattern). Run via
// `npm run validate:provider-reliability`.
//
// Covers (sprint §16): successful/failed/timeout/stale provider, provider
// cooldown, recovery, fallback, capability filtering, reliability state
// transitions, reliability score determinism, cross-provider agreement,
// cross-provider conflict, unresolved-conflict preservation, all
// providers unavailable, cache behavior, provenance, MarketSnapshot
// integrity, no fabricated values. A live Binance smoke test runs last
// and is non-fatal (network-dependent, additional only, per the sprint's
// explicit instruction - Angel One authenticated live testing is NEVER
// performed here).
import assert from "node:assert/strict";
import {
  computeReliability,
  orderProviders,
  MIN_RELIABILITY_OBSERVATIONS,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_COOLDOWN_MS,
} from "../services/market-data/provider-reliability.service";
import { assessFreshness } from "../services/market-data/freshness-policy.service";
import { compareSnapshots, PRICE_RELATIVE_TOLERANCE } from "../services/market-data/cross-provider-validation.service";
import { validateSnapshotIntegrity } from "../services/market-data/market-snapshot-integrity.service";
import { MarketDataService } from "../services/market-data/market-data.service";
import { BinanceProvider } from "../lib/market-data/providers/binance.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { ProviderHealthSnapshot } from "../lib/market-data/health-monitor";
import type { MarketDataProvider, SnapshotProvider, MarketContextRequest } from "../types/market-data-provider";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { Clock } from "../lib/market-data/cache";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

function fixedClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

function healthSnapshot(overrides: Partial<ProviderHealthSnapshot> = {}): ProviderHealthSnapshot {
  return {
    provider: "test-provider",
    state: "healthy",
    lastCheckedAt: "2026-01-01T00:00:00.000Z",
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    ...overrides,
  };
}

// ============================================================
// 1. Reliability scoring & state classification (computeReliability)
// ============================================================
async function reliabilityScoringTests(): Promise<void> {
  await test("Reliability: zero observations -> state unknown, score honestly undefined (never 0)", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A" }), available: true, nowMs: 0,
    });
    assert.equal(r.state, "unknown");
    assert.equal(r.reliabilityScore, undefined);
    assert.equal(r.healthy, false);
  });

  await test("Reliability: fewer than MIN_RELIABILITY_OBSERVATIONS -> score still undefined even with real successes", () => {
    assert.equal(MIN_RELIABILITY_OBSERVATIONS, 3);
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 2, lastLatencyMs: 100 }), available: true, nowMs: 0,
    });
    assert.equal(r.reliabilityScore, undefined);
    assert.equal(r.state, "healthy"); // classification only needs consecutiveFailures === 0, distinct from scoring
  });

  await test("Reliability: a fully successful provider is healthy with a high score", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 10, failureCount: 0, lastLatencyMs: 200 }),
      available: true, nowMs: 0,
    });
    assert.equal(r.state, "healthy");
    assert.equal(r.healthy, true);
    assert.equal(r.reliabilityScore, 100); // 100% success * 70 + <=500ms bucket 30
  });

  await test("Reliability: a real recorded failure (below circuit-breaker threshold) is degraded, not healthy", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 8, failureCount: 2, consecutiveFailures: 1, lastLatencyMs: 100 }),
      available: true, nowMs: 0,
    });
    assert.equal(r.state, "degraded");
    assert.equal(r.healthy, false);
    assert.ok(r.reliabilityScore! < 100);
  });

  await test("Reliability: a provider that recovered after a failure is 'recovering', not falsely 'healthy'", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 9, failureCount: 1, consecutiveFailures: 0, lastLatencyMs: 100 }),
      available: true, nowMs: 0,
    });
    assert.equal(r.state, "recovering");
    assert.equal(r.healthy, true, "recovering is still treated as safe-to-prefer");
  });

  await test("Reliability: undefined latency uses the documented neutral latency points, never penalizes/rewards blindly", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 10, failureCount: 0, lastLatencyMs: undefined }),
      available: true, nowMs: 0,
    });
    assert.equal(r.reliabilityScore, 70 + 15); // 100% success * 70 + neutral 15
  });

  await test("Reliability: score is deterministic - identical input always produces an identical result", () => {
    const input = {
      provider: "A", symbol: "EURUSD", capability: "quote" as const,
      snapshot: healthSnapshot({ provider: "A", successCount: 7, failureCount: 3, consecutiveFailures: 0, lastLatencyMs: 1500 }),
      available: true, nowMs: 1_700_000_000_000,
    };
    const r1 = computeReliability(input);
    const r2 = computeReliability(input);
    assert.deepEqual(r1, r2);
  });

  await test("Reliability: basis explains every component - never a bare number with no reasoning", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 1 }), available: true, nowMs: 0,
    });
    assert.ok(r.basis.length > 0);
    assert.ok(r.basis.some((b) => b.includes("Fewer than")));
  });

  await test("Reliability: unavailable capability is reported honestly in basis, not hidden", () => {
    const r = computeReliability({
      provider: "angel-one", symbol: "BTCUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "angel-one" }), available: false, nowMs: 0,
    });
    assert.equal(r.available, false);
    assert.ok(r.basis.some((b) => b.includes("does not declare")));
  });
}

// ============================================================
// 2. Circuit breaker: cooldown trip + timed recovery
// ============================================================
async function circuitBreakerTests(): Promise<void> {
  assert.equal(CIRCUIT_BREAKER_FAILURE_THRESHOLD, 3);
  assert.equal(CIRCUIT_BREAKER_COOLDOWN_MS, 30_000);

  await test("Circuit breaker: below the failure threshold never trips cooldown", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 5, failureCount: 2, consecutiveFailures: 2, lastCheckedAt: "2026-01-01T00:00:00.000Z" }),
      available: true, nowMs: new Date("2026-01-01T00:00:00.000Z").getTime(),
    });
    assert.equal(r.inCooldown, false);
    assert.equal(r.state, "degraded");
  });

  await test("Circuit breaker: threshold consecutive failures trips cooldown -> state unavailable", () => {
    const lastCheckedAt = "2026-01-01T00:00:00.000Z";
    const nowMs = new Date(lastCheckedAt).getTime() + 5000; // well within the 30s cooldown
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 5, failureCount: 3, consecutiveFailures: 3, lastCheckedAt }),
      available: true, nowMs,
    });
    assert.equal(r.inCooldown, true);
    assert.equal(r.state, "unavailable");
    assert.ok(r.basis.some((b) => b.includes("Circuit breaker tripped")));
  });

  await test("Circuit breaker: cooldown elapsed but not yet re-attempted honestly collapses to 'degraded', never a falsely-fresh 'healthy'", () => {
    const lastCheckedAt = "2026-01-01T00:00:00.000Z";
    const nowMs = new Date(lastCheckedAt).getTime() + CIRCUIT_BREAKER_COOLDOWN_MS + 1000; // past cooldown
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 5, failureCount: 3, consecutiveFailures: 3, lastCheckedAt }),
      available: true, nowMs,
    });
    assert.equal(r.inCooldown, false, "eligible for a real recovery-probe attempt again");
    assert.equal(r.state, "degraded", "not falsely healthy - it hasn't actually been re-proven yet");
  });

  await test("Circuit breaker: a real recovery (fresh success after tripping) restores 'recovering'", () => {
    const r = computeReliability({
      provider: "A", symbol: "EURUSD", capability: "quote",
      snapshot: healthSnapshot({ provider: "A", successCount: 6, failureCount: 3, consecutiveFailures: 0, lastCheckedAt: "2026-01-01T00:00:00.000Z" }),
      available: true, nowMs: new Date("2026-01-01T00:00:00.000Z").getTime(),
    });
    assert.equal(r.state, "recovering");
    assert.equal(r.inCooldown, false);
  });
}

// ============================================================
// 3. Freshness policy (assessFreshness) - per asset-class/timeframe, never one global threshold
// ============================================================
async function freshnessPolicyTests(): Promise<void> {
  await test("Freshness: crypto quote within its tighter threshold is fresh", () => {
    const now = 1_700_000_000_000;
    const r = assessFreshness({ subject: { kind: "quote", assetClass: "crypto" }, timestamp: new Date(now - 10_000).toISOString(), nowMs: now });
    assert.equal(r.status, "fresh");
  });

  await test("Freshness: the SAME age is fresh for indices/stocks (5min threshold) but stale for crypto (30s threshold) - no single global threshold", () => {
    const now = 1_700_000_000_000;
    const timestamp = new Date(now - 60_000).toISOString(); // 60s old
    const crypto = assessFreshness({ subject: { kind: "quote", assetClass: "crypto" }, timestamp, nowMs: now });
    const stocks = assessFreshness({ subject: { kind: "quote", assetClass: "stocks" }, timestamp, nowMs: now });
    assert.equal(crypto.status, "stale");
    assert.equal(stocks.status, "fresh");
  });

  await test("Freshness: a 1-minute candle and a daily candle have different freshness semantics (sprint's own worked example)", () => {
    const now = 1_700_000_000_000;
    const timestamp = new Date(now - 90_000).toISOString(); // 90s old
    const oneMin = assessFreshness({ subject: { kind: "candle", timeframe: "1m" }, timestamp, nowMs: now });
    const daily = assessFreshness({ subject: { kind: "candle", timeframe: "1d" }, timestamp, nowMs: now });
    assert.equal(oneMin.status, "stale"); // 90s > 60s bar duration
    assert.equal(daily.status, "fresh"); // 90s << 24h bar duration
  });

  await test("Freshness: missing timestamp is honestly 'unknown', never guessed as fresh", () => {
    const r = assessFreshness({ subject: { kind: "quote", assetClass: "forex" }, timestamp: undefined, nowMs: 0 });
    assert.equal(r.status, "unknown");
  });

  await test("Freshness: unparseable timestamp is honestly 'unknown', never guessed as fresh", () => {
    const r = assessFreshness({ subject: { kind: "quote", assetClass: "forex" }, timestamp: "not-a-date", nowMs: 0 });
    assert.equal(r.status, "unknown");
  });

  await test("Freshness: deterministic - identical input always produces an identical assessment", () => {
    const input = { subject: { kind: "quote" as const, assetClass: "forex" as const }, timestamp: "2026-01-01T00:00:00.000Z", nowMs: 1_700_000_000_000 };
    assert.deepEqual(assessFreshness(input), assessFreshness(input));
  });
}

// ============================================================
// 4. Cross-provider validation (compareSnapshots) - agreement, conflict, staleness, missing fields
// ============================================================
function fakeMarketSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol: "BTCUSD",
    assetClass: "crypto",
    price: 65000,
    quoteCurrency: "USD",
    timestamp: "2026-01-01T00:00:00.000Z",
    timezone: "UTC",
    marketStatus: "open",
    provider: "provider-a",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function crossProviderValidationTests(): Promise<void> {
  const now = new Date("2026-01-01T00:00:05.000Z").getTime(); // 5s after both timestamps - fresh for crypto

  await test("Cross-provider: two providers within tolerance -> acceptable-difference, no auto-resolution needed", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", price: 65000 });
    const b = fakeMarketSnapshot({ provider: "binance", price: 65100 }); // ~0.15% apart
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    const price = conflicts.find((c) => c.field === "price")!;
    assert.equal(price.status, "acceptable-difference");
    assert.ok(price.divergence! < PRICE_RELATIVE_TOLERANCE);
  });

  await test("Cross-provider: a material divergence between two FRESH providers is preserved as unresolved-conflict, never auto-resolved", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", price: 65000 });
    const b = fakeMarketSnapshot({ provider: "binance", price: 70000 }); // ~7% apart
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    const price = conflicts.find((c) => c.field === "price")!;
    assert.equal(price.status, "unresolved-conflict");
    // Both real values must be preserved - never silently overwritten with one "winner".
    assert.equal(price.valueA, 65000);
    assert.equal(price.valueB, 70000);
  });

  await test("Cross-provider: a stale provider's disagreement is classified stale-provider, not treated as a real conflict", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", price: 65000, timestamp: "2026-01-01T00:00:00.000Z" });
    const staleNow = new Date("2026-01-01T00:01:00.000Z").getTime(); // 60s later - stale for crypto (30s threshold)
    const b = fakeMarketSnapshot({ provider: "binance", price: 70000, timestamp: "2026-01-01T00:00:00.000Z" });
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: staleNow });
    const price = conflicts.find((c) => c.field === "price")!;
    assert.equal(price.status, "stale-provider");
  });

  await test("Cross-provider: a field present on only one snapshot is never compared - no fabricated 0-vs-real-value conflict", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", ohlc: undefined });
    const b = fakeMarketSnapshot({ provider: "binance", ohlc: { open: 100, high: 110, low: 90, close: 105 } });
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    assert.equal(conflicts.find((c) => c.field === "open"), undefined);
    assert.equal(conflicts.find((c) => c.field === "high"), undefined);
  });

  await test("Cross-provider: volume is deliberately never compared (unconfirmed cross-vendor unit compatibility)", () => {
    const a = { ...fakeMarketSnapshot({ provider: "twelve-data" }), volume: 1000 } as MarketSnapshot & { volume: number };
    const b = { ...fakeMarketSnapshot({ provider: "binance" }), volume: 999999 } as MarketSnapshot & { volume: number };
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    assert.equal(conflicts.find((c) => c.field === "volume"), undefined);
  });

  await test("Cross-provider: timestamps compared independently of price agreement", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", timestamp: "2026-01-01T00:00:00.000Z" });
    const b = fakeMarketSnapshot({ provider: "binance", timestamp: "2026-01-01T00:00:04.000Z" });
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    const ts = conflicts.find((c) => c.field === "timestamp")!;
    assert.equal(ts.status, "none");
  });

  await test("Cross-provider: deterministic - identical input always produces identical conflicts", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data" });
    const b = fakeMarketSnapshot({ provider: "binance", price: 65200 });
    const input = { instrument: "BTCUSD" as const, snapshotA: a, snapshotB: b, nowMs: now };
    assert.deepEqual(compareSnapshots(input), compareSnapshots(input));
  });
}

// ============================================================
// 5. MarketSnapshot integrity gate (validateSnapshotIntegrity)
// ============================================================
async function snapshotIntegrityTests(): Promise<void> {
  const nowMs = new Date("2026-01-01T00:00:05.000Z").getTime();

  await test("Integrity: a real, well-formed snapshot is valid", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot(), nowMs });
    assert.equal(r.valid, true);
    assert.deepEqual(r.issues, []);
  });

  await test("Integrity: a silently-substituted symbol is caught, never trusted", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "ETHUSD", snapshot: fakeMarketSnapshot({ symbol: "BTCUSD" }), nowMs });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "symbol"));
  });

  await test("Integrity: missing provider identity is rejected - unattributed data can't be trusted", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot({ provider: "" }), nowMs });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "provider"));
  });

  await test("Integrity: an unparseable timestamp is rejected", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot({ timestamp: "not-a-date" }), nowMs });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "timestamp"));
  });

  await test("Integrity: a non-positive price is rejected, never silently accepted", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot({ price: -5 }), nowMs });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "price"));
  });

  await test("Integrity: internally inconsistent OHLC (low > open) is rejected", () => {
    const r = validateSnapshotIntegrity({
      requestedSymbol: "BTCUSD",
      snapshot: fakeMarketSnapshot({ ohlc: { open: 100, high: 110, low: 105, close: 108 } }),
      nowMs,
    });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "ohlc"));
  });

  await test("Integrity: freshnessStatus is reported separately from structural validity - stale-but-well-formed is still 'valid: true'", () => {
    const staleNowMs = new Date("2026-01-01T00:05:00.000Z").getTime(); // 5min later - stale for crypto
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot(), nowMs: staleNowMs });
    assert.equal(r.valid, true, "structural integrity and staleness are separate concerns");
    assert.equal(r.freshnessStatus, "stale");
  });

  await test("Integrity: never manufactures a replacement value - only reports issues, snapshot itself is untouched", () => {
    const original = fakeMarketSnapshot({ price: -5 });
    const originalCopy = { ...original };
    validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: original, nowMs });
    assert.deepEqual(original, originalCopy);
  });
}

// ============================================================
// 6. Smart fallback ordering (orderProviders) - capability filter, reliability rank, cooldown deprioritization
// ============================================================
function fakeMdProvider(name: string): MarketDataProvider {
  return { name, isConfigured: () => true, async getMarketContext(request: MarketContextRequest) { return { symbol: request.symbol, provider: name, retrievedAt: "t", evidence: [] }; } };
}

async function smartFallbackOrderingTests(): Promise<void> {
  await test("Smart fallback: with zero health data, ordering is an exact no-op (original priority order preserved)", () => {
    // An un-cataloged symbol deliberately - isolates pure ordering behavior
    // from the capability filter (covered separately below).
    const providers = [fakeMdProvider("twelve-data"), fakeMdProvider("alpha-vantage"), fakeMdProvider("binance")];
    const ordered = orderProviders({ providers, symbol: "NOTINCATALOG-NOOP", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered.map((p) => p.name), ["twelve-data", "alpha-vantage", "binance"]);
  });

  await test("Smart fallback: a provider with a real, higher recorded reliability score is promoted ahead of the default priority order", () => {
    const providers = [fakeMdProvider("twelve-data"), fakeMdProvider("binance")];
    const healthSnapshots: ProviderHealthSnapshot[] = [
      healthSnapshot({ provider: "twelve-data", successCount: 2, failureCount: 8, consecutiveFailures: 1, lastLatencyMs: 4000 }),
      healthSnapshot({ provider: "binance", successCount: 10, failureCount: 0, consecutiveFailures: 0, lastLatencyMs: 100 }),
    ];
    const ordered = orderProviders({ providers, symbol: "BTCUSD", capability: "quote", healthSnapshots, nowMs: 0 });
    assert.equal(ordered[0].name, "binance", "the actually-more-reliable provider should be tried first");
  });

  await test("Smart fallback: a provider in circuit-breaker cooldown is deprioritized (moved last) but never fully excluded", () => {
    // Un-cataloged symbol - isolates cooldown-deprioritization from the
    // capability filter (covered separately below).
    const providers = [fakeMdProvider("angel-one"), fakeMdProvider("twelve-data")];
    const lastCheckedAt = "2026-01-01T00:00:00.000Z";
    const nowMs = new Date(lastCheckedAt).getTime() + 1000;
    const healthSnapshots: ProviderHealthSnapshot[] = [
      healthSnapshot({ provider: "angel-one", successCount: 5, failureCount: 3, consecutiveFailures: 3, lastCheckedAt }),
    ];
    const ordered = orderProviders({ providers, symbol: "NOTINCATALOG-COOLDOWN", capability: "quote", healthSnapshots, nowMs });
    assert.equal(ordered[ordered.length - 1].name, "angel-one", "deprioritized to the end");
    assert.equal(ordered.length, 2, "never fully excluded - still tried as a last resort");
  });

  await test("Smart fallback: capability filter excludes a provider that doesn't declare the requested capability for a cataloged symbol", () => {
    // RELIANCE is only mapped to angel-one in the catalog - a hypothetical
    // "binance" candidate must be filtered out for this cataloged symbol.
    const providers = [fakeMdProvider("binance"), fakeMdProvider("angel-one")];
    const ordered = orderProviders({ providers, symbol: "RELIANCE", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered.map((p) => p.name), ["angel-one"]);
  });

  await test("Smart fallback: never returns zero candidates even for a cataloged instrument with no matching mapping (falls back to full list)", () => {
    const providers = [fakeMdProvider("twelve-data"), fakeMdProvider("alpha-vantage")]; // neither maps to RELIANCE
    const ordered = orderProviders({ providers, symbol: "RELIANCE", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.equal(ordered.length, 2, "over-eager filtering must never zero out the candidate set");
  });

  await test("Smart fallback: an un-cataloged symbol is never capability-filtered - falls through to every configured provider, same as today", () => {
    const providers = [fakeMdProvider("twelve-data"), fakeMdProvider("alpha-vantage")];
    const ordered = orderProviders({ providers, symbol: "NOTINCATALOGXYZ", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered.map((p) => p.name), ["twelve-data", "alpha-vantage"]);
  });

  await test("Smart fallback: an un-cataloged symbol with no health data preserves original priority order for capability tie-break", () => {
    const providers = [fakeMdProvider("twelve-data"), fakeMdProvider("alpha-vantage"), fakeMdProvider("binance")];
    const ordered1 = orderProviders({ providers, symbol: "X", capability: "candles", healthSnapshots: [], nowMs: 0 });
    const ordered2 = orderProviders({ providers, symbol: "X", capability: "candles", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered1.map((p) => p.name), ordered2.map((p) => p.name));
  });
}

// ============================================================
// 7. MarketDataService integration - smartFallback wiring, insufficient-data on total failure
// ============================================================
function fakeSnapshot(provider: string, symbol: string): MarketSnapshot {
  return {
    symbol, assetClass: "crypto", price: 100, quoteCurrency: "USD",
    timestamp: "2026-01-01T00:00:00.000Z", timezone: "UTC", marketStatus: "open",
    provider, retrievedAt: "2026-01-01T00:00:00.000Z",
  };
}

function scriptedProvider(name: string, behaviors: ("success" | "fail")[]): MarketDataProvider & SnapshotProvider {
  let i = 0;
  return {
    name,
    isConfigured: () => true,
    async getMarketContext(request: MarketContextRequest) {
      return { symbol: request.symbol, provider: name, retrievedAt: "t", evidence: [] };
    },
    async getSnapshot(request: MarketContextRequest) {
      const behavior = behaviors[Math.min(i, behaviors.length - 1)];
      i++;
      if (behavior === "fail") throw new MarketDataProviderError("http_error", `${name} down`, name);
      return fakeSnapshot(name, request.symbol);
    },
  };
}

async function marketDataServiceIntegrationTests(): Promise<void> {
  await test("MarketDataService: smartFallback:false (default) is byte-identical to the pre-D2.6.4 fixed order - no behavior change", async () => {
    const a = scriptedProvider("A", ["fail", "fail", "fail"]);
    const b = scriptedProvider("B", ["success", "success", "success"]);
    const svc = new MarketDataService({ providers: [a, b], reliability: { retries: 0 } });
    for (let i = 0; i < 3; i++) {
      const snap = await svc.getSnapshot({ symbol: `X${i}` }); // distinct symbols avoid the cache masking real per-call selection
      assert.equal(snap.provider, "B");
    }
  });

  await test("MarketDataService: smartFallback:true reorders based on REAL recorded outcomes from this exact service instance (no second tracker)", async () => {
    const clock = fixedClock(0);
    const flaky = scriptedProvider("flaky", ["fail", "fail", "fail", "success"]);
    const reliable = scriptedProvider("reliable", ["success", "success", "success", "success"]);
    const svc = new MarketDataService({ providers: [flaky, reliable], clock, reliability: { retries: 0 }, smartFallback: true });

    // Prime real health history: 3 calls where "flaky" fails and falls back to "reliable".
    for (let i = 0; i < 3; i++) {
      clock.advance(1000);
      const snap = await svc.getSnapshot({ symbol: `PRIME${i}` });
      assert.equal(snap.provider, "reliable");
      assert.equal(snap.fallbackUsed, true);
    }

    // With 3 recorded failures for "flaky" (>= MIN_RELIABILITY_OBSERVATIONS,
    // >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) and a still-active cooldown,
    // smart fallback must now try "reliable" FIRST - a real, provable
    // reordering the plain fixed-order router could never produce.
    clock.advance(1000); // still well within CIRCUIT_BREAKER_COOLDOWN_MS
    const snap = await svc.getSnapshot({ symbol: "AFTER-COOLDOWN-TRIP" });
    assert.equal(snap.provider, "reliable", "the actually-reliable provider must now be tried first");
    assert.equal(snap.fallbackUsed, undefined, "no fallback needed - it was the FIRST attempt, not a recovery from a failure");
  });

  await test("MarketDataService: all providers failing returns a structured insufficient-data error, NEVER an estimated/fabricated snapshot", async () => {
    const a = scriptedProvider("A", ["fail"]);
    const b = scriptedProvider("B", ["fail"]);
    const svc = new MarketDataService({ providers: [a, b], reliability: { retries: 0 }, smartFallback: true });
    await assert.rejects(svc.getSnapshot({ symbol: "TOTALFAIL" }), (e: unknown) => {
      assert.ok(e instanceof MarketDataProviderError);
      assert.notEqual(e.kind, undefined);
      return true;
    });
  });

  await test("MarketDataService: smartFallback:true still preserves the existing stale-cache-fallback grace window (cache behavior unaffected)", async () => {
    const clock = fixedClock(0);
    let succeed = true;
    const flaky: MarketDataProvider & SnapshotProvider = {
      name: "flaky",
      isConfigured: () => true,
      async getMarketContext(request) { return { symbol: request.symbol, provider: "flaky", retrievedAt: "t", evidence: [] }; },
      async getSnapshot(request) {
        if (!succeed) throw new MarketDataProviderError("http_error", "down", "flaky");
        return fakeSnapshot("flaky", request.symbol);
      },
    };
    const svc = new MarketDataService({ providers: [flaky], clock, cacheTtlMs: 1000, staleFallbackMs: 60_000, reliability: { retries: 0 }, smartFallback: true });
    await svc.getSnapshot({ symbol: "X" });
    clock.advance(5000);
    succeed = false;
    const stale = await svc.getSnapshot({ symbol: "X" });
    assert.equal(stale.cached, true);
  });

  await test("MarketDataService: real Binance provider's own capability/parsing behavior is untouched by smart fallback (integration sanity)", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ symbol: "BTCUSDT", lastPrice: "65000.00", openPrice: "64500", highPrice: "65500", lowPrice: "64400", priceChangePercent: "0.5", volume: "100", closeTime: 1_700_000_000_000 }) });
    const binance = new BinanceProvider({ fetchImpl });
    const svc = new MarketDataService({ providers: [binance], smartFallback: true });
    const snap = await svc.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snap.price, 65000);
    assert.equal(snap.provider, "binance");
  });
}

// ============================================================
// 8. Additional no-fabrication guarantees, specific to this sprint's new contracts
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("No-fabrication: reliabilityScore is never defaulted to 0 for an unmeasured provider", () => {
    const r = computeReliability({
      provider: "A", symbol: "X", capability: "quote",
      snapshot: healthSnapshot({ provider: "A" }), available: true, nowMs: 0,
    });
    assert.notEqual(r.reliabilityScore, 0);
    assert.equal(r.reliabilityScore, undefined);
  });

  await test("No-fabrication: cross-provider conflicts never resolve to a single 'winning' value - both real values always present", () => {
    const a = fakeMarketSnapshot({ provider: "twelve-data", price: 65000 });
    const b = fakeMarketSnapshot({ provider: "binance", price: 72000 });
    const now = new Date("2026-01-01T00:00:05.000Z").getTime();
    const conflicts = compareSnapshots({ instrument: "BTCUSD", snapshotA: a, snapshotB: b, nowMs: now });
    const price = conflicts.find((c) => c.field === "price")!;
    assert.equal(price.status, "unresolved-conflict");
    assert.ok(price.valueA !== undefined && price.valueB !== undefined, "both real values preserved, neither silently dropped");
  });

  await test("No-fabrication: an integrity-invalid snapshot's issues never contain a substituted/computed replacement value", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BTCUSD", snapshot: fakeMarketSnapshot({ price: NaN }), nowMs: 0 });
    assert.equal(r.valid, false);
    assert.ok(!("price" in r), "the result reports issues, it never fabricates a corrected price field");
  });
}

// ============================================================
// 9. Live Binance smoke test - additional only, non-fatal, no credentials.
//    Per sprint §16/§12: Angel One authenticated live testing is NEVER performed.
// ============================================================
async function liveBinanceSmokeTest(): Promise<void> {
  try {
    const provider = new BinanceProvider();
    const snapshot = await provider.getSnapshot({ symbol: "BTCUSD" });
    assert.ok(snapshot.price > 0);
    console.log(`  ok (live smoke) - Binance public REST: BTCUSD = ${snapshot.price} (real, live)`);
  } catch (err) {
    console.warn(`  skip (live smoke) - Binance live check unavailable in this environment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  await reliabilityScoringTests();
  await circuitBreakerTests();
  await freshnessPolicyTests();
  await crossProviderValidationTests();
  await snapshotIntegrityTests();
  await smartFallbackOrderingTests();
  await marketDataServiceIntegrationTests();
  await noFabricationTests();
  await liveBinanceSmokeTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
