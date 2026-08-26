// scripts/validate-market-data-integrity.ts
// Sprint D2.8.1 - Market Data Integrity & Fabrication-Risk Cleanup.
// Standalone, assert-based verification (no test framework, no real
// network - matching every prior sprint's scripts/validate-*.ts pattern).
// Run via `npm run validate:market-data-integrity`.
//
// Covers: real Alpha Vantage bid/ask reaching MarketSnapshot through the
// existing SnapshotProvider capability, strict bid/ask validation (finite,
// positive, ask >= bid - invalid pairs rejected rather than normalized),
// spread derived ONLY from a valid bid/ask pair (never from price/candles,
// never a synthetic fallback), that canonical instrument resolution and
// provider reliability/selection order are unchanged, that the dead
// liquidity-fabrication service is gone with no production caller, that
// the real Trading Copilot has no liquidity feature to have disturbed, and
// that liquidityZones/volumeDelta/DecisionContext's honest
// unmeasured/unavailable handling is untouched.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  AlphaVantageProvider,
  type AlphaVantageFetch,
} from "../lib/market-data/providers/alpha-vantage.provider";
import { MarketDataService } from "../services/market-data/market-data.service";
import type { MarketDataProvider, SnapshotProvider } from "../types/market-data-provider";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { Clock } from "../lib/market-data/cache";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import type { Candle } from "../types/market-candle";
import type { EvidenceBundle } from "../types/evidence";
import type { RiskProfile } from "../types/risk-intelligence";

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

const TEST_API_KEY = "test-key-not-real";

async function withApiKey<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = process.env.ALPHA_VANTAGE_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = TEST_API_KEY;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = original;
  }
}

function fakeClock(startMs: number): Clock {
  return { now: () => startMs };
}

function makeFetch(status: number, body: unknown): AlphaVantageFetch {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function successBody(overrides: Partial<Record<string, string>> = {}) {
  return {
    "Realtime Currency Exchange Rate": {
      "1. From_Currency Code": "EUR",
      "2. From_Currency Name": "Euro",
      "3. To_Currency Code": "USD",
      "4. To_Currency Name": "United States Dollar",
      "5. Exchange Rate": "1.08010000",
      "6. Last Refreshed": "2026-01-15 20:00:01",
      "7. Time Zone": "UTC",
      "8. Bid Price": "1.08000000",
      "9. Ask Price": "1.08020000",
      ...overrides,
    },
  };
}

// ============================================================
// A fake SnapshotProvider for exercising MarketDataService.getSnapshot()'s
// central spread-derivation step without touching the real network or the
// real Alpha Vantage provider (which is separately exercised directly).
// ============================================================
class FakeSnapshotProvider implements MarketDataProvider, SnapshotProvider {
  readonly name: string;
  private readonly snapshot: MarketSnapshot;
  constructor(name: string, snapshot: MarketSnapshot) {
    this.name = name;
    this.snapshot = snapshot;
  }
  isConfigured(): boolean {
    return true;
  }
  async getSnapshot(): Promise<MarketSnapshot> {
    return this.snapshot;
  }
  async getMarketContext(): Promise<never> {
    throw new Error("not used in this fixture");
  }
}

function baseSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price: 1.0801,
    quoteCurrency: "USD",
    timestamp: "2026-01-15T20:00:01.000Z",
    timezone: "UTC",
    marketStatus: "unknown",
    provider: "fake",
    retrievedAt: "2026-01-15T20:00:02.000Z",
    ...overrides,
  };
}

// ============================================================
// DecisionContext fixture - minimal real chain (MarketState -> Regime ->
// Hypothesis -> Envelope -> DecisionContext), same discipline as
// scripts/validate-decision-context.ts, kept intentionally small since
// this suite only needs to confirm the honest-unavailable fields are
// unaffected by this sprint, not re-verify DecisionContext's full behavior.
// ============================================================
function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    open: close - 0.0002,
    high: close + 0.0003,
    low: close - 0.0003,
    close,
    volume: 1000 + i,
  }));
}
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: valid Alpha Vantage bid/ask accepted
  // ---------------------------------------------------------------------
  await test("1: valid Alpha Vantage bid/ask is accepted into MarketSnapshot", async () => {
    await withApiKey(async () => {
      const provider = new AlphaVantageProvider({ fetchImpl: makeFetch(200, successBody()), clock: fakeClock(0) });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, 1.08);
      assert.equal(snapshot.ask, 1.0802);
      assert.equal(snapshot.price, 1.0801);
      assert.equal(snapshot.provider, "alpha-vantage");
      assert.equal(snapshot.assetClass, "forex");
      assert.equal(snapshot.quoteCurrency, "USD");
      assert.equal(snapshot.ohlc, undefined, "spot-only provider must never fabricate OHLC");
      assert.equal(snapshot.volume, undefined, "spot-only provider must never fabricate volume");
    });
  });

  // ---------------------------------------------------------------------
  // 2: invalid bid rejected (non-positive)
  // ---------------------------------------------------------------------
  await test("2: non-positive bid is rejected - both bid and ask stay undefined", async () => {
    await withApiKey(async () => {
      const provider = new AlphaVantageProvider({
        fetchImpl: makeFetch(200, successBody({ "8. Bid Price": "0.00000000" })),
        clock: fakeClock(0),
      });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, undefined);
      assert.equal(snapshot.ask, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // 3: invalid ask rejected (non-positive)
  // ---------------------------------------------------------------------
  await test("3: non-positive ask is rejected - both bid and ask stay undefined", async () => {
    await withApiKey(async () => {
      const provider = new AlphaVantageProvider({
        fetchImpl: makeFetch(200, successBody({ "9. Ask Price": "-1.0000" })),
        clock: fakeClock(0),
      });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, undefined);
      assert.equal(snapshot.ask, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // 4: ask < bid rejected
  // ---------------------------------------------------------------------
  await test("4: ask < bid is rejected as an invalid pair - both stay undefined", async () => {
    await withApiKey(async () => {
      const provider = new AlphaVantageProvider({
        fetchImpl: makeFetch(200, successBody({ "8. Bid Price": "1.0900", "9. Ask Price": "1.0800" })),
        clock: fakeClock(0),
      });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, undefined);
      assert.equal(snapshot.ask, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // 5: missing bid remains unavailable
  // ---------------------------------------------------------------------
  await test("5: provider response with no bid field leaves bid/ask unavailable, never estimated", async () => {
    await withApiKey(async () => {
      const body = successBody();
      delete (body["Realtime Currency Exchange Rate"] as Record<string, unknown>)["8. Bid Price"];
      const provider = new AlphaVantageProvider({ fetchImpl: makeFetch(200, body), clock: fakeClock(0) });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, undefined);
      assert.equal(snapshot.ask, undefined, "ask must not be surfaced alone when its pair is missing");
      assert.equal(snapshot.price, 1.0801, "price itself must still be reported");
    });
  });

  // ---------------------------------------------------------------------
  // 6: missing ask remains unavailable
  // ---------------------------------------------------------------------
  await test("6: provider response with no ask field leaves bid/ask unavailable, never estimated", async () => {
    await withApiKey(async () => {
      const body = successBody();
      delete (body["Realtime Currency Exchange Rate"] as Record<string, unknown>)["9. Ask Price"];
      const provider = new AlphaVantageProvider({ fetchImpl: makeFetch(200, body), clock: fakeClock(0) });
      const snapshot = await provider.getSnapshot({ symbol: "EURUSD" });
      assert.equal(snapshot.bid, undefined);
      assert.equal(snapshot.ask, undefined);
    });
  });

  // ---------------------------------------------------------------------
  // 7: spread calculated only from valid bid/ask (via MarketDataService)
  // ---------------------------------------------------------------------
  await test("7: MarketDataService.getSnapshot() derives spread = ask - bid only from a valid pair", async () => {
    const svc = new MarketDataService({
      providers: [new FakeSnapshotProvider("fake", baseSnapshot({ bid: 1.08, ask: 1.0802 }))],
    });
    const snapshot = await svc.getSnapshot({ symbol: "EURUSD" });
    assert.ok(snapshot.spread !== undefined);
    assert.ok(Math.abs((snapshot.spread as number) - 0.0002) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 8: no synthetic spread fallback
  // ---------------------------------------------------------------------
  await test("8: MarketDataService never derives spread from price/candles when bid/ask are absent", async () => {
    const svc = new MarketDataService({
      providers: [new FakeSnapshotProvider("fake", baseSnapshot())], // no bid/ask at all
    });
    const snapshot = await svc.getSnapshot({ symbol: "EURUSD" });
    assert.equal(snapshot.spread, undefined);
    assert.equal(snapshot.bid, undefined);
    assert.equal(snapshot.ask, undefined);
  });
  await test("8b: MarketDataService never derives spread from a one-sided bid/ask pair", async () => {
    const svc = new MarketDataService({
      providers: [new FakeSnapshotProvider("fake", baseSnapshot({ bid: 1.08 }))], // ask missing
    });
    const snapshot = await svc.getSnapshot({ symbol: "EURUSD" });
    assert.equal(snapshot.spread, undefined);
  });

  // ---------------------------------------------------------------------
  // 9: existing canonical instrument resolution remains unchanged
  // ---------------------------------------------------------------------
  await test("9: canonical MarketDataCapability union is unchanged (still only quote|candles - no orderbook/trades)", () => {
    const source = readFileSync(new URL("../types/canonical-instrument.ts", import.meta.url), "utf8");
    assert.ok(source.includes('export type MarketDataCapability = "quote" | "candles";'));
  });
  await test("9b: instrument catalog's Alpha Vantage EURUSD mapping is unchanged (still quote-only)", () => {
    const source = readFileSync(new URL("../lib/market-data/instrument-catalog.ts", import.meta.url), "utf8");
    assert.ok(source.includes('{ provider: "alpha-vantage", providerSymbol: "EUR", supportedCapabilities: ["quote"], verified: true }'));
  });

  // ---------------------------------------------------------------------
  // 10: provider reliability/freshness path remains intact
  // ---------------------------------------------------------------------
  await test("10: MarketDataService still records provider health/reliability outcomes for a getSnapshot() call", async () => {
    const svc = new MarketDataService({
      providers: [new FakeSnapshotProvider("fake", baseSnapshot({ bid: 1.08, ask: 1.0802 }))],
    });
    await svc.getSnapshot({ symbol: "EURUSD" });
    const report = svc.healthReport();
    assert.equal(report.length, 1);
    assert.equal(report[0].provider, "fake");
    assert.equal(report[0].successCount, 1);
  });
  await test("10b: a failed higher-priority provider still triggers honest fallbackUsed provenance", async () => {
    class FailingProvider implements MarketDataProvider, SnapshotProvider {
      readonly name = "failing";
      isConfigured(): boolean {
        return true;
      }
      async getSnapshot(): Promise<never> {
        const { MarketDataProviderError } = await import("../lib/market-data/errors");
        throw new MarketDataProviderError("http_error", "boom", "failing");
      }
      async getMarketContext(): Promise<never> {
        throw new Error("not used");
      }
    }
    const svc = new MarketDataService({
      providers: [new FailingProvider(), new FakeSnapshotProvider("fake", baseSnapshot({ bid: 1.08, ask: 1.0802 }))],
    });
    const snapshot = await svc.getSnapshot({ symbol: "EURUSD" });
    assert.equal(snapshot.fallbackUsed, true);
    assert.ok(snapshot.spread !== undefined, "spread derivation must survive the fallback path too");
  });

  // ---------------------------------------------------------------------
  // 11/12/13: liquidityZones not fabricated, volumeDelta unavailable,
  // DecisionContext execution/liquidity risk stays honest
  // ---------------------------------------------------------------------
  await test("11/12/13: DecisionContext still reports liquidity zones, volume delta and execution/liquidity risk as honestly unsupported/unmeasured", () => {
    const marketStateSvc = new MarketStateService();
    const regimeSvc = new RegimeService();
    const hypothesisSvc = new HypothesisService();
    const envelopeSvc = new IntelligenceEnvelopeService();
    const decisionSvc = new DecisionContextService();
    const GENERATED_AT = "2026-01-01T00:00:00.000Z";

    const candles = makeCandles(trendingBullishCloses());
    const snapshot: MarketSnapshot = baseSnapshot({ price: candles[candles.length - 1].close, marketStatus: "open" });
    const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });

    const evidence: EvidenceBundle = {
      symbol: "EURUSD",
      items: [{ type: "price", symbol: "EURUSD", claim: "price up", source: "provider-a", asOf: GENERATED_AT, retrievedAt: GENERATED_AT }],
      conflicts: [],
      generatedAt: GENERATED_AT,
    };
    const risk: RiskProfile = {
      symbol: "EURUSD",
      categories: [
        { category: "liquidity", level: "medium", rationale: ["unmeasured"], basis: [] },
        { category: "execution", level: "medium", rationale: ["unmeasured"], basis: [] },
      ],
      overallLevel: "medium",
      generatedAt: GENERATED_AT,
    };

    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, evidence, risk, generatedAt: GENERATED_AT });

    // Sanity: this sprint's changes never introduced volumeDelta - still
    // genuinely unimplemented, unlike liquidityZones (post-completion,
    // 2026-08-26 - now a real SMC Equal High/Low proxy, see
    // types/intelligence-market-state.ts's own doc comment).
    assert.equal((marketState.structure as unknown as Record<string, unknown>).volumeDelta, undefined);

    const dc = decisionSvc.build(envelope);
    const descriptions = dc.missingInformation.map((i) => i.description);
    // liquidityZones is now conditional, not a permanent claim: present
    // only when this fixture's own candles genuinely have no real Equal
    // High/Low cluster, absent when they do (mirrors the recentRange
    // pattern) - assert the disclaimer's presence matches the real,
    // computed field exactly, rather than assuming either direction.
    const hasRealCluster = Boolean(marketState.structure?.liquidityZones?.equalHigh || marketState.structure?.liquidityZones?.equalLow);
    const flagsLiquidityZonesMissing = descriptions.some((d) => /equal high\/equal low liquidity cluster/i.test(d));
    assert.equal(flagsLiquidityZonesMissing, !hasRealCluster, "the liquidity-zone missing-info item must appear if and only if no real cluster was detected");
    assert.ok(descriptions.some((d) => /buy\/sell volume delta/i.test(d)), "volume delta must still be declared unsupported");
    assert.ok(descriptions.some((d) => /execution risk/i.test(d)), "execution risk must still be declared unsupported");
    assert.ok(descriptions.some((d) => /liquidity risk.*order book/i.test(d)), "liquidity risk (order book depth) must still be declared unsupported");

    const liquidityCategory = dc.riskContext.categories.find((c) => c.category === "liquidity");
    const executionCategory = dc.riskContext.categories.find((c) => c.category === "execution");
    assert.ok(liquidityCategory && liquidityCategory.basis.length === 0, "liquidity risk must remain evidence-free (honestly unmeasured)");
    assert.ok(executionCategory && executionCategory.basis.length === 0, "execution risk must remain evidence-free (honestly unmeasured)");
    assert.ok(dc.riskContext.categoriesUnavailable.includes("liquidity"));
    assert.ok(dc.riskContext.categoriesUnavailable.includes("execution"));
  });

  // ---------------------------------------------------------------------
  // 14: dead fabricated liquidity service has no production caller
  // ---------------------------------------------------------------------
  await test("14: the fabricated liquidity-analysis service and its sole caller were removed, and nothing still references them", () => {
    assert.equal(existsSync(new URL("../services/ai/trading/liquidity-analysis.service.ts", import.meta.url)), false);
    assert.equal(existsSync(new URL("../services/ai/trading/market-analysis.service.ts", import.meta.url)), false);

    const filesToCheck = [
      "lib/market-data/env.ts",
      "lib/market-data/errors.ts",
      "lib/market-data/cache.ts",
      "lib/market-data/providers/alpha-vantage.provider.ts",
      "lib/market-data/providers/twelve-data.provider.ts",
      "services/market-data/market-data.service.ts",
      "services/intelligence/decision/decision-context.service.ts",
      "services/intelligence/market-state/market-state.service.ts",
      "services/ai/trading-copilot.service.ts",
    ];
    for (const file of filesToCheck) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.ok(!source.includes("services/ai/trading/"), `${file} must not reference the removed services/ai/trading/ chain`);
      assert.ok(!source.includes("getLiquidity"), `${file} must not call the removed getLiquidity()`);
    }
  });

  // ---------------------------------------------------------------------
  // 15: active Trading Copilot liquidity implementation remains untouched
  // ---------------------------------------------------------------------
  await test("15: the real Trading Copilot service has no liquidity feature of its own to have been disturbed", () => {
    const source = readFileSync(new URL("../services/ai/trading-copilot.service.ts", import.meta.url), "utf8");
    assert.ok(!/liquidity/i.test(source), "Trading Copilot must still have zero liquidity references - confirms this sprint touched nothing live here");
  });

  // ---------------------------------------------------------------------
  // 16: provider selection order - MT5 promoted to first (this session)
  // ---------------------------------------------------------------------
  // Updated (post-D2.8.1, this session) - MT5 was intentionally moved to
  // position 1 at the user's explicit request, to relieve Twelve Data/
  // Alpha Vantage's shared-quota rate-limit blocks on the 7 symbols MT5
  // covers. The other 4 providers keep their exact original relative order.
  await test("16: MarketDataService's default provider priority order has MT5 first, then the pre-existing 4 (Twelve Data, Alpha Vantage, Binance, Angel One) in their original relative order", () => {
    const source = readFileSync(new URL("../services/market-data/market-data.service.ts", import.meta.url), "utf8");
    assert.ok(
      source.includes("options.providers ?? [new Mt5Provider(), new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider()]"),
      "MT5 must be first, followed by the pre-existing 4 providers in their exact original relative order",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
