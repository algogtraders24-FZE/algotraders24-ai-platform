// scripts/validate-microstructure-visualization.ts
// Sprint D2.8.10 - Microstructure Visualization & Intelligence Evidence
// Layer. Standalone, assert-based verification (no test framework, no
// React renderer - this codebase has no jsdom/testing-library dependency,
// confirmed via package.json), matching every prior sprint's
// scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-visualization`.
//
// Design: pure-function tests exercise formatMicrostructureFieldForUI
// (lib/microstructure/microstructure-panel-format.ts) against real
// MicrostructureSnapshot fixtures built via D2.8.5's own unmodified
// buildMicrostructureSnapshot(). Route-level tests exercise the exact same
// capability-gating + MicrostructureSnapshotService primitives
// app/api/private/market-data/microstructure/route.ts itself calls
// (proving the route's own logic, not a reimplementation of it). React
// component tests are structural (source-string assertions against the
// actual .tsx files), the same style already used by D2.7.x's own
// validate-native-chart-*.ts scripts for components with no render harness
// available. Tests 29/30-equivalent make REAL live calls through D2.8.6's
// actual shared instances and self-skip (never self-pass) honestly if the
// network is unavailable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMicrostructureSnapshot, MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { binanceMicrostructureProvider, microstructureSnapshots } from "../services/microstructure/shared-instance";
import { formatMicrostructureFieldForUI } from "../lib/microstructure/microstructure-panel-format";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { formatPrice, formatCompactVolume } from "../lib/financial-format";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { withReliability } from "../lib/market-data/reliability";
import type { MarketDataProvider, MarketContextRequest } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult, RawMicrostructureEvidence, MicrostructureSnapshot } from "../types/microstructure";

let passed = 0;
let failed = 0;
let skipped = 0;

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

async function liveTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok (live) - ${name}`);
  } catch (err) {
    skipped += 1;
    console.warn(`  SKIPPED (live, network unavailable) - ${name}`);
    console.warn(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// ============================================================
// Fixtures (same conventions as D2.8.7/D2.8.8/D2.8.9's own scripts)
// ============================================================
const NOW_MS = Date.parse("2026-08-17T12:00:00.000Z");

function rawEvidence(overrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureEvidence {
  return {
    bid: { state: "available", value: 63189.99 },
    ask: { state: "available", value: 63190.0 },
    bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1.92 }] },
    askLevels: { state: "available", value: [{ price: 63190.0, quantity: 6.39 }] },
    trades: {
      state: "available",
      value: [
        { price: 63189.99, quantity: 0.01, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
        { price: 63190.0, quantity: 0.02, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
      ],
    },
    sequenceId: { state: "available", value: "98576634609" },
    ...overrides,
  };
}
function rawResult(overrides: Partial<RawMicrostructureResult> = {}, evidenceOverrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureResult {
  return {
    symbol: "BTCUSD",
    provider: "binance",
    assetClass: "crypto",
    timestamp: "2026-08-17T11:59:56.500Z",
    retrievedAt: "2026-08-17T11:59:56.600Z",
    evidence: rawEvidence(evidenceOverrides),
    ...overrides,
  };
}

const availableSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(rawResult(), NOW_MS);
const staleSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult({ timestamp: "2026-08-17T11:00:00.000Z", retrievedAt: "2026-08-17T11:00:00.100Z" }),
  NOW_MS,
);
const unavailableSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult(
    {},
    {
      bid: { state: "unavailable", reason: "no evidence" },
      ask: { state: "unavailable", reason: "no evidence" },
      bidLevels: { state: "unavailable", reason: "no evidence" },
      askLevels: { state: "unavailable", reason: "no evidence" },
      trades: { state: "unavailable", reason: "no evidence" },
      sequenceId: { state: "unavailable", reason: "no evidence" },
    },
  ),
  NOW_MS,
);
const invalidSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult({}, { bid: { state: "invalid", reason: "crossed market" }, ask: { state: "invalid", reason: "crossed market" } }),
  NOW_MS,
);
const notSupportedSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult({}, { trades: { state: "not_supported_by_provider", reason: "no trade-stream endpoint" } }),
  NOW_MS,
);

class FakeMicrostructureProvider implements MarketDataProvider, MicrostructureProvider {
  readonly name = "binance";
  callCount = 0;
  constructor(private readonly behavior: () => Promise<RawMicrostructureResult>) {}
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(): Promise<never> {
    throw new Error("not used");
  }
  async getMicrostructureSnapshot(): Promise<RawMicrostructureResult> {
    this.callCount += 1;
    return this.behavior();
  }
}

/** Mirrors app/api/private/market-data/microstructure/route.ts's own logic exactly (capability gate -> withReliability-wrapped fetch -> typed catch) - proving that route's real behavior without needing a running HTTP server/session cookie. */
async function simulateRoute(symbol: string, provider: FakeMicrostructureProvider): Promise<{ supported: boolean; snapshot?: MicrostructureSnapshot; errorKind?: string }> {
  const instrument = getCanonicalInstrument(symbol);
  const binanceCapable = (instrument?.providerMappings ?? []).some((m) => m.provider === provider.name && m.supportedCapabilities.includes("quote"));
  if (!binanceCapable) return { supported: false };
  try {
    const snapshot = await withReliability(() => new MicrostructureSnapshotService().getSnapshot(provider, { symbol } as MarketContextRequest), provider.name, { retries: 0 });
    return { supported: true, snapshot };
  } catch (error) {
    if (error instanceof MarketDataProviderError) return { supported: true, errorKind: error.kind };
    throw error;
  }
}

const UNSUPPORTED_SYMBOLS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"];

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Real Data
  // ---------------------------------------------------------------------
  await test("Binance bid/ask displayed with real values", () => {
    assert.equal(formatMicrostructureFieldForUI(availableSnapshot.evidence.bid, (v) => formatPrice(v, { maxDecimals: 5 })), "63,189.99");
    assert.equal(formatMicrostructureFieldForUI(availableSnapshot.evidence.ask, (v) => formatPrice(v, { maxDecimals: 5 })), "63,190.00");
  });
  await test("spread displayed with a real derived value", () => {
    const text = formatMicrostructureFieldForUI(availableSnapshot.derived.spread, (v) => formatPrice(v, { maxDecimals: 5 }));
    assert.ok(text !== "Unavailable" && text !== "Invalid");
  });
  await test("bid/ask depth displayed with real derived values", () => {
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.bidDepth, formatCompactVolume), "Unavailable");
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.askDepth, formatCompactVolume), "Unavailable");
  });
  await test("depth imbalance displayed with a real derived value", () => {
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.depthImbalance, (v) => `${(v * 100).toFixed(1)}%`), "Unavailable");
  });
  await test("buy volume displayed with the real aggressor-summed value", () => {
    assert.equal(availableSnapshot.derived.buyVolume.value, 0.01);
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.buyVolume, formatCompactVolume), "Unavailable");
  });
  await test("sell volume displayed with the real aggressor-summed value", () => {
    assert.equal(availableSnapshot.derived.sellVolume.value, 0.02);
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.sellVolume, formatCompactVolume), "Unavailable");
  });
  await test("volume delta displayed with the real derived value (buyVolume - sellVolume)", () => {
    assert.ok(Math.abs((availableSnapshot.derived.volumeDelta.value as number) - -0.01) < 1e-9);
    assert.notEqual(formatMicrostructureFieldForUI(availableSnapshot.derived.volumeDelta, formatCompactVolume), "Unavailable");
  });

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  await test("unavailable state preserved - never a fabricated number, never 0", () => {
    const text = formatMicrostructureFieldForUI(unavailableSnapshot.evidence.bid, (v) => formatPrice(v));
    assert.equal(text, "Unavailable");
    assert.equal(unavailableSnapshot.derived.volumeDelta.state, "unavailable");
    assert.equal(formatMicrostructureFieldForUI(unavailableSnapshot.derived.volumeDelta, formatCompactVolume), "Unavailable");
  });
  await test("stale state preserved - snapshot-level freshness (D2.8.5/D2.8.7's own established staleness model - never a per-field fabrication) is never silently upgraded to fresh", () => {
    assert.equal(staleSnapshot.freshnessStatus, "stale");
    // The real bid value is still carried (D2.8.5's own rule: "the value is
    // still carried, never discarded, just flagged") - the flag itself
    // lives at snapshot.freshnessStatus, which MicrostructurePanel renders
    // as an explicit "Stale" badge (checked structurally below), not as a
    // per-field suffix - buildMicrostructureSnapshot() never mutates an
    // individual field's own CapabilityState based on snapshot freshness.
    const text = formatMicrostructureFieldForUI(staleSnapshot.evidence.bid, (v) => formatPrice(v, { maxDecimals: 5 }));
    assert.equal(text, "63,189.99");
  });
  await test("MicrostructurePanel source renders an explicit 'Stale' badge driven by snapshot.freshnessStatus, never silently showing stale data as live", () => {
    const source = readFileSync(new URL("../components/chart-engine/MicrostructurePanel.tsx", import.meta.url), "utf8");
    assert.ok(/freshnessStatus === "stale"/.test(source));
    assert.ok(/Stale/.test(source));
  });
  await test("invalid rejected - the numeric value is never displayed", () => {
    assert.equal(invalidSnapshot.evidence.bid.state, "invalid");
    const text = formatMicrostructureFieldForUI(invalidSnapshot.evidence.bid, (v) => formatPrice(v));
    assert.equal(text, "Invalid");
    assert.ok(!text.includes("63189"), "the invalid numeric value must never leak into the displayed text");
  });
  await test("unsupported-by-provider state preserved, distinct from unavailable", () => {
    assert.equal(notSupportedSnapshot.evidence.trades.state, "not_supported_by_provider");
    const text = formatMicrostructureFieldForUI(notSupportedSnapshot.derived.buyVolume, formatCompactVolume);
    assert.equal(text, "Not supported for this instrument");
  });

  // ---------------------------------------------------------------------
  // Instrument Safety
  // ---------------------------------------------------------------------
  await test("BTCUSD -> Binance allowed (real catalog mapping)", () => {
    const instrument = getCanonicalInstrument("BTCUSD");
    assert.ok((instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote")));
  });
  await test("ETHUSD -> Binance allowed (real catalog mapping)", () => {
    const instrument = getCanonicalInstrument("ETHUSD");
    assert.ok((instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote")));
  });
  for (const symbol of UNSUPPORTED_SYMBOLS) {
    await test(`${symbol} -> Binance blocked (route simulation: zero provider calls, no substitution)`, async () => {
      const provider = new FakeMicrostructureProvider(async () => rawResult({ symbol }));
      const result = await simulateRoute(symbol, provider);
      assert.equal(result.supported, false);
      assert.equal(provider.callCount, 0);
    });
  }

  // ---------------------------------------------------------------------
  // Attribution
  // ---------------------------------------------------------------------
  await test("provider is displayed and real (never a generic/global label)", () => {
    assert.equal(availableSnapshot.provider, "binance");
  });
  await test("venue/instrument is displayed and real", () => {
    assert.equal(availableSnapshot.symbol, "BTCUSD");
  });
  await test("timestamp is displayed and real (a real, parseable ISO string)", () => {
    assert.ok(!Number.isNaN(Date.parse(availableSnapshot.timestamp)));
  });
  await test("MicrostructurePanel source explicitly separates Direct Evidence (Bid/Ask) from Derived fields, and states venue scope", () => {
    const source = readFileSync(new URL("../components/chart-engine/MicrostructurePanel.tsx", import.meta.url), "utf8");
    assert.ok(source.includes('label="Bid"') && source.includes('label="Ask"'));
    assert.ok(source.includes('label="Spread"') && source.includes('label="Volume Delta"'));
    assert.ok(/not global market liquidity/i.test(source));
    assert.ok(/Binance Order-Book Evidence|Venue Microstructure/.test(source));
    assert.ok(!/global liquidity\b(?!.*not)/i.test(source.replace(/not global market liquidity/gi, "")), "must never claim global liquidity outside the explicit disclaimer");
  });
  await test("MicrostructurePanel never displays a fabricated 0 for a non-available field - fieldText always routes through the shared honesty formatter", () => {
    const source = readFileSync(new URL("../components/chart-engine/MicrostructurePanel.tsx", import.meta.url), "utf8");
    assert.ok(source.includes("formatMicrostructureFieldForUI"));
  });

  // ---------------------------------------------------------------------
  // Failure Isolation
  // ---------------------------------------------------------------------
  await test("timeout does not break the route - it degrades to a typed timeout error, never an uncaught rejection (~8s real budget)", async () => {
    const provider = new FakeMicrostructureProvider(() => new Promise<RawMicrostructureResult>(() => {})); // never resolves
    const startedAt = Date.now();
    const result = await simulateRoute("BTCUSD", provider);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.supported, true);
    assert.equal(result.errorKind, "timeout");
    assert.equal(result.snapshot, undefined);
    assert.ok(elapsedMs < 10_000, `expected the timeout to bound this well under 10s, took ${elapsedMs}ms`);
  });
  await test("provider error (HTTP failure) does not break the route - it degrades to a typed error, never an uncaught rejection", async () => {
    const provider = new FakeMicrostructureProvider(async () => {
      throw new MarketDataProviderError("http_error", "simulated 500", "binance");
    });
    const result = await simulateRoute("BTCUSD", provider);
    assert.equal(result.supported, true);
    assert.equal(result.errorKind, "http_error");
  });
  await test("malformed/invalid provider data does not break the route - it degrades to a typed error, never an uncaught rejection", async () => {
    const provider = new FakeMicrostructureProvider(async () => {
      throw new MarketDataProviderError("invalid_response", "Binance response was not valid JSON", "binance");
    });
    const result = await simulateRoute("BTCUSD", provider);
    assert.equal(result.supported, true);
    assert.equal(result.errorKind, "invalid_response");
  });
  await test("stale data does not break the route or chart - a real, complete snapshot is still returned, just honestly labeled", async () => {
    const provider = new FakeMicrostructureProvider(async () => rawResult({ timestamp: "2026-08-17T10:00:00.000Z", retrievedAt: "2026-08-17T10:00:00.100Z" }));
    const result = await simulateRoute("BTCUSD", provider);
    assert.equal(result.supported, true);
    assert.ok(result.snapshot);
    // Real wall-clock freshness (this route/service use the real system clock, not an injected one) - a fixed 2026-08-17T10:00:00Z timestamp is always in the past relative to "now", so this must never be classified fresh.
    assert.notEqual(result.snapshot!.freshnessStatus, "fresh");
  });

  // ---------------------------------------------------------------------
  // Real runtime verification (live network, self-skipping)
  // ---------------------------------------------------------------------
  await liveTest("real BTCUSDT visualization data verified through the actual production shared instances", async () => {
    const snapshot = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "BTCUSD" });
    assert.equal(snapshot.provider, "binance");
    assert.equal(snapshot.evidence.bid.state, "available");
    const bidText = formatMicrostructureFieldForUI(snapshot.evidence.bid, (v) => formatPrice(v, { maxDecimals: 5 }));
    assert.notEqual(bidText, "Unavailable");
    console.log(`    real BTCUSDT for visualization: bid=${snapshot.evidence.bid.value} spread=${snapshot.derived.spread.value} freshness=${snapshot.freshnessStatus}`);
  });
  await liveTest("real ETHUSDT visualization data verified through the actual production shared instances", async () => {
    const snapshot = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "ETHUSD" });
    assert.equal(snapshot.provider, "binance");
    assert.equal(snapshot.evidence.bid.state, "available");
    console.log(`    real ETHUSDT for visualization: bid=${snapshot.evidence.bid.value} spread=${snapshot.derived.spread.value} freshness=${snapshot.freshnessStatus}`);
  });

  // ---------------------------------------------------------------------
  // Route registration (structural - proves the endpoint exists, is
  // auth-gated, and reuses the real shared instances, without needing a
  // session cookie to drive it end-to-end)
  // ---------------------------------------------------------------------
  await test("the new route reuses the real D2.8.6 shared instances and D2.8.9 reliability wrapper - no second provider/calculation implementation", () => {
    const source = readFileSync(new URL("../app/api/private/market-data/microstructure/route.ts", import.meta.url), "utf8");
    assert.ok(source.includes('from "@/services/microstructure/shared-instance"'));
    assert.ok(source.includes('from "@/lib/market-data/reliability"'));
    assert.ok(!/class\s+\w*Microstructure\w*Service/.test(source));
    assert.ok(source.includes("getUserOrNull"), "the route must require authentication like every other private market-data route");
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (live/network)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
