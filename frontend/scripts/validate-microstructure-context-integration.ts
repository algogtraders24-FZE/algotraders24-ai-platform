// scripts/validate-microstructure-context-integration.ts
// Sprint D2.8.7 - Microstructure Intelligence Context Integration.
// Standalone, assert-based verification (no test framework), matching
// every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-context-integration`.
//
// Self-contained per this project's own convention: fixture builders
// (makeCandles/snapshotFor/trendingBullishCloses/FakeMarketData/
// fakeAnalysisRunService) are copied from scripts/validate-realtime-
// intelligence.ts rather than imported. Only the market-data seam and the
// microstructure-provider seam are faked - MarketStateService,
// RegimeService, HypothesisService, IntelligenceEnvelopeService, and
// DecisionContextService all run for real, so this proves genuine
// end-to-end wiring into the real Intelligence Context pipeline, not an
// isolated unit. The realistic Binance fixture (bid/ask/depth/trades with
// isBuyerMaker) is shaped exactly like D2.8.6's real observed payload.
import assert from "node:assert/strict";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { formatMicrostructureEvidence } from "../lib/microstructure/microstructure-presentation";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult } from "../types/microstructure";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";
import type { CreateIntelligenceAnalysisRunInput, IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import { readFileSync } from "node:fs";

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

// ============================================================
// Fixture builders (copied from scripts/validate-realtime-intelligence.ts)
// ============================================================
function makeCandles(closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}
function snapshotFor(candles: Candle[], overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "BTCUSD",
    assetClass: "crypto",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
    ...overrides,
  };
}
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(30000 + i * 20);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 5 + (i % 3));
  return [...rise, ...plateau];
}
const bullishCandles = makeCandles(trendingBullishCloses());

class FakeMarketData implements MarketDataProvider {
  readonly name: string;
  constructor(
    private readonly behavior: { snapshot?: () => Promise<MarketSnapshot>; candles?: () => Promise<Candle[]> } = {},
    name = "fake-market-data",
  ) {
    this.name = name;
  }
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { symbol: request.symbol, provider: this.name, retrievedAt: new Date().toISOString(), evidence: [] };
  }
  async getSnapshot(): Promise<MarketSnapshot> {
    if (!this.behavior.snapshot) throw new MarketDataProviderError("http_error", "no snapshot behavior configured", this.name);
    return this.behavior.snapshot();
  }
  async getTimeSeries(): Promise<Candle[]> {
    if (!this.behavior.candles) return bullishCandles;
    return this.behavior.candles();
  }
}

function freshMarketData(symbol = "BTCUSD"): FakeMarketData {
  const now = new Date();
  const freshSnapshot = { ...snapshotFor(bullishCandles, { symbol }), timestamp: now.toISOString(), retrievedAt: now.toISOString() };
  return new FakeMarketData({ snapshot: async () => freshSnapshot, candles: async () => bullishCandles });
}

function fakeAnalysisRunService(): IntelligenceAnalysisRunService {
  return {
    async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
      return {
        id: "fake-run-1",
        userId: input.userId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        pipelineVersion: null,
        analysisResult: null,
        regimeAtTime: null,
        hypothesisSnapshot: input.hypothesisSnapshot ?? null,
        evaluationStatus: "pending",
        createdAt: new Date().toISOString(),
      };
    },
    async getAnalysisRun(): Promise<IntelligenceAnalysisRun | null> {
      return null;
    },
    async listPendingEvaluationRuns(): Promise<IntelligenceAnalysisRun[]> {
      return [];
    },
    async markEvaluated(): Promise<IntelligenceAnalysisRun | null> {
      return null;
    },
  } as unknown as IntelligenceAnalysisRunService;
}

// ============================================================
// Realistic Binance microstructure fixture - shaped exactly like D2.8.6's
// real, live-captured BTCUSDT payload (bid/ask/depth/trades with
// isBuyerMaker), never a made-up shape.
// ============================================================
function realisticBinanceRawResult(overrides: Partial<RawMicrostructureResult> = {}): RawMicrostructureResult {
  const evidence = {
    bid: { state: "available" as const, value: 63189.99 },
    ask: { state: "available" as const, value: 63190.0 },
    bidLevels: {
      state: "available" as const,
      value: [
        { price: 63189.99, quantity: 1.92 },
        { price: 63189.3, quantity: 0.5 },
      ],
    },
    askLevels: {
      state: "available" as const,
      value: [
        { price: 63190.0, quantity: 6.39 },
        { price: 63190.4, quantity: 0.3 },
      ],
    },
    trades: {
      state: "available" as const,
      value: [
        { price: 63189.99, quantity: 0.01, timestamp: "2026-08-16T17:33:11.000Z", aggressorSide: { state: "available" as const, value: "buy" as const } },
        { price: 63190.0, quantity: 0.02, timestamp: "2026-08-16T17:33:11.500Z", aggressorSide: { state: "available" as const, value: "sell" as const } },
      ],
    },
    sequenceId: { state: "available" as const, value: "98576634609" },
  };
  return {
    symbol: "BTCUSD",
    provider: "binance",
    assetClass: "crypto",
    timestamp: "2026-08-16T17:33:11.500Z",
    retrievedAt: "2026-08-16T17:33:11.600Z",
    evidence,
    ...overrides,
  };
}

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

function buildOrchestrator(opts: {
  symbol?: string;
  microstructureBehavior?: () => Promise<RawMicrostructureResult>;
  clockNowMs?: number;
} = {}) {
  const marketData = freshMarketData(opts.symbol ?? "BTCUSD");
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(opts.microstructureBehavior ?? (async () => realisticBinanceRawResult()));
  const microstructureService = opts.clockNowMs !== undefined ? new MicrostructureSnapshotService({ now: () => opts.clockNowMs! }) : new MicrostructureSnapshotService();
  // A caller-supplied clock keeps `generatedAt` deterministic across two
  // otherwise-identical orchestrator builds (test 16 relies on this) -
  // never Date.now() when the test needs byte-identical output.
  const clock = opts.clockNowMs !== undefined ? { now: () => opts.clockNowMs! } : undefined;
  const svc = new RealTimeIntelligenceService({
    marketData,
    analysisRunService,
    microstructureProvider,
    microstructureService,
    clock,
  });
  return { svc, microstructureProvider };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: microstructure reaches IntelligenceContext
  // ---------------------------------------------------------------------
  await test("1: real microstructure evidence reaches VerifiedRealTimeIntelligenceContext when opted in", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r1", userId: "u1", question: "Analyze BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.status, "resolved");
    assert.ok(ctx.microstructure, "microstructure must be present when opted in for a Binance-capable instrument");
  });

  // ---------------------------------------------------------------------
  // 2: provider attribution preserved
  // ---------------------------------------------------------------------
  await test("2: provider attribution is preserved end-to-end (binance)", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r2", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.provider, "binance");
  });

  // ---------------------------------------------------------------------
  // 3: instrument attribution preserved
  // ---------------------------------------------------------------------
  await test("3: instrument attribution is preserved end-to-end (BTCUSD)", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r3", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.symbol, "BTCUSD");
  });

  // ---------------------------------------------------------------------
  // 4: Binance data remains venue-specific
  // ---------------------------------------------------------------------
  await test("4: formatted evidence text is explicitly scoped to the venue, never presented as global liquidity", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r4", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    const lines = formatMicrostructureEvidence(ctx.microstructure!);
    const text = lines.join("\n");
    assert.ok(text.includes("binance"));
    assert.ok(/not global market liquidity/i.test(text));
  });

  // ---------------------------------------------------------------------
  // 5/6: bid/ask and spread preserved
  // ---------------------------------------------------------------------
  await test("5/6: real bid/ask/spread values are preserved unchanged from the raw evidence", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r5", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.evidence.bid.value, 63189.99);
    assert.equal(ctx.microstructure?.evidence.ask.value, 63190.0);
    assert.ok(Math.abs((ctx.microstructure?.derived.spread.value as number) - 0.01) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 7/8: order-book evidence + depth imbalance preserved
  // ---------------------------------------------------------------------
  await test("7/8: order-book levels and depth imbalance are preserved unchanged", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r6", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.evidence.bidLevels.state, "available");
    assert.equal(ctx.microstructure?.derived.depthImbalance.state, "available");
  });

  // ---------------------------------------------------------------------
  // 9: buy/sell volume preserved
  // ---------------------------------------------------------------------
  await test("9: buyVolume/sellVolume are preserved, correctly summed from the real aggressor-mapped trades", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r7", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.derived.buyVolume.value, 0.01);
    assert.equal(ctx.microstructure?.derived.sellVolume.value, 0.02);
  });

  // ---------------------------------------------------------------------
  // 10: volume delta preserved only with aggressor evidence
  // ---------------------------------------------------------------------
  await test("10: volumeDelta is unavailable (never 0) when trades carry no aggressor-side evidence", async () => {
    const { svc } = buildOrchestrator({
      microstructureBehavior: async () =>
        realisticBinanceRawResult({
          evidence: {
            ...realisticBinanceRawResult().evidence,
            trades: {
              state: "available",
              value: [{ price: 63190, quantity: 0.05, timestamp: "2026-08-16T17:33:11.000Z", aggressorSide: { state: "unavailable", reason: "no aggressor evidence" } }],
            },
          },
        }),
    });
    const ctx = await svc.build({ requestId: "r8", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.derived.volumeDelta.state, "unavailable");
    assert.equal(ctx.microstructure?.derived.volumeDelta.value, undefined);
  });

  // ---------------------------------------------------------------------
  // 11: unavailable fields remain unavailable
  // ---------------------------------------------------------------------
  await test("11: unavailable order-book/trade evidence never becomes a fabricated value anywhere in the context", async () => {
    const { svc } = buildOrchestrator({
      microstructureBehavior: async () =>
        realisticBinanceRawResult({
          evidence: {
            bid: { state: "unavailable", reason: "no evidence" },
            ask: { state: "unavailable", reason: "no evidence" },
            bidLevels: { state: "unavailable", reason: "no evidence" },
            askLevels: { state: "unavailable", reason: "no evidence" },
            trades: { state: "unavailable", reason: "no evidence" },
            sequenceId: { state: "unavailable", reason: "no evidence" },
          },
        }),
    });
    const ctx = await svc.build({ requestId: "r9", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    for (const [field, value] of Object.entries(ctx.microstructure!.derived)) {
      assert.notEqual(value.state, "available", `${field} must not be available`);
      assert.equal(value.value, undefined, `${field} must not carry a fabricated value`);
    }
  });

  // ---------------------------------------------------------------------
  // 12: stale state preserved
  // ---------------------------------------------------------------------
  await test("12: a stale microstructure snapshot's freshness is honestly preserved, never silently upgraded to fresh", async () => {
    const nowMs = Date.parse("2026-08-16T18:00:00.000Z"); // ~27 min after the fixture's timestamp - well past crypto's 30s threshold
    const { svc } = buildOrchestrator({ clockNowMs: nowMs });
    const ctx = await svc.build({ requestId: "r10", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.freshnessStatus, "stale");
  });

  // ---------------------------------------------------------------------
  // 13: invalid state preserved
  // ---------------------------------------------------------------------
  await test("13: a crossed-market bid/ask is preserved as invalid, never repaired", async () => {
    const { svc } = buildOrchestrator({
      microstructureBehavior: async () =>
        realisticBinanceRawResult({
          evidence: {
            ...realisticBinanceRawResult().evidence,
            bid: { state: "invalid", reason: "crossed market: ask < bid" },
            ask: { state: "invalid", reason: "crossed market: ask < bid" },
          },
        }),
    });
    const ctx = await svc.build({ requestId: "r11", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.evidence.bid.state, "invalid");
    assert.equal(ctx.microstructure?.derived.spread.state, "unavailable");
  });

  // ---------------------------------------------------------------------
  // 14: unsupported instrument does not receive Binance data
  // ---------------------------------------------------------------------
  await test("14: an unsupported instrument (XAUUSD) never receives Binance microstructure - and the provider is never even called", async () => {
    const { svc, microstructureProvider } = buildOrchestrator({ symbol: "XAUUSD" });
    const ctx = await svc.build({ requestId: "r12", userId: "u1", question: "XAUUSD", symbol: "XAUUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    assert.equal(microstructureProvider.callCount, 0, "no symbol guessing/cross-provider substitution - the fetch must never even be attempted for a non-Binance-mapped instrument");
  });
  await test("14b: an unsupported instrument (EURUSD) never receives Binance data either", async () => {
    const { svc, microstructureProvider } = buildOrchestrator({ symbol: "EURUSD" });
    const ctx = await svc.build({ requestId: "r12b", userId: "u1", question: "EURUSD", symbol: "EURUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    assert.equal(microstructureProvider.callCount, 0);
  });

  // ---------------------------------------------------------------------
  // 15: provider failure does not break Intelligence pipeline
  // ---------------------------------------------------------------------
  await test("15: a microstructure provider failure never breaks the core Intelligence response - envelope still resolves", async () => {
    const { svc } = buildOrchestrator({
      microstructureBehavior: async () => {
        throw new MarketDataProviderError("http_error", "simulated failure", "binance");
      },
    });
    const ctx = await svc.build({ requestId: "r13", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.status, "resolved");
    assert.ok(ctx.envelope, "envelope must still be built even though microstructure failed");
    assert.equal(ctx.microstructure, undefined);
  });

  // ---------------------------------------------------------------------
  // 16: no scoring changes
  // ---------------------------------------------------------------------
  await test("16: including microstructure never changes the Intelligence Score - identical otherwise-equal requests produce byte-identical scores", async () => {
    const clockNowMs = Date.now();
    const without = buildOrchestrator({ clockNowMs });
    const ctxWithout = await without.svc.build({ requestId: "r14a", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    const withMs = buildOrchestrator({ clockNowMs });
    const ctxWith = await withMs.svc.build({ requestId: "r14b", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.deepEqual(ctxWithout.envelope?.intelligenceScore, ctxWith.envelope?.intelligenceScore);
  });

  // ---------------------------------------------------------------------
  // 17: provider priority order - MT5 promoted to first (this session,
  // unrelated to this sprint's own scope, at the user's explicit request)
  // ---------------------------------------------------------------------
  await test("17: MarketDataService's default provider priority order has MT5 first, then the pre-existing 4 in their original relative order", () => {
    const source = readFileSync(new URL("../services/market-data/market-data.service.ts", import.meta.url), "utf8");
    assert.ok(source.includes("options.providers ?? [new Mt5Provider(), new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider()]"));
  });

  // ---------------------------------------------------------------------
  // 18: no fabrication fallback
  // ---------------------------------------------------------------------
  await test("18: unavailable microstructure derived from empty evidence never contains a synthetic fallback value", async () => {
    const { svc } = buildOrchestrator({
      microstructureBehavior: async () =>
        realisticBinanceRawResult({
          evidence: {
            bid: { state: "unavailable", reason: "x" },
            ask: { state: "unavailable", reason: "x" },
            bidLevels: { state: "unavailable", reason: "x" },
            askLevels: { state: "unavailable", reason: "x" },
            trades: { state: "unavailable", reason: "x" },
            sequenceId: { state: "unavailable", reason: "x" },
          },
        }),
    });
    const ctx = await svc.build({ requestId: "r15", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    const json = JSON.stringify(ctx.microstructure?.derived);
    assert.ok(!/"value":0/.test(json), "no derived field should carry a literal 0 fallback when evidence is entirely unavailable");
  });

  // ---------------------------------------------------------------------
  // 19: DecisionContext unavailable semantics preserved
  // ---------------------------------------------------------------------
  await test("19: DecisionContext's liquidity-zone/execution-risk disclaimers remain permanent; the order-book disclaimer is now honestly capability-gated (D2.8.15)", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r16", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope);
    const decisionSvc = new DecisionContextService();
    const dc = decisionSvc.build(ctx.envelope!);
    const descriptions = dc.missingInformation.map((i) => i.description);
    assert.ok(descriptions.some((d) => /liquidity zone/i.test(d)));
    assert.ok(descriptions.some((d) => /execution risk/i.test(d)));
    // Sprint D2.8.15 - "liquidity risk (order book depth)" was a stale,
    // unconditional claim left over from before D2.8.5/D2.8.11 gave BTCUSD/
    // ETHUSD real Binance depth/aggressor-flow evidence. It is now
    // conditional on the instrument's real microstructure-provider
    // capability (see decision-context.service.ts's buildMissingInformation())
    // - BTCUSD is capable, so this disclaimer is correctly ABSENT here.
    // scripts/validate-intelligence-data-sufficiency.ts covers the
    // non-capable (EURUSD) case where it remains present.
    assert.ok(!descriptions.some((d) => /liquidity risk.*order book/i.test(d)), "BTCUSD has real Binance microstructure capability - this disclaimer must not fabricate an unmeasured claim");
  });

  // ---------------------------------------------------------------------
  // 20: AI presenter preserves evidence attribution
  // ---------------------------------------------------------------------
  await test("20: the presenter-facing formatter always states provider/instrument/freshness and never invents a value for an unavailable field", () => {
    const raw = realisticBinanceRawResult({
      evidence: {
        ...realisticBinanceRawResult().evidence,
        trades: { state: "unavailable", reason: "no evidence" },
      },
    });
    const nowMs = Date.parse(raw.timestamp) + 1000;
    const snapshot = new MicrostructureSnapshotService({ now: () => nowMs });
    // Build the snapshot the same way the real pipeline would, via a one-off fake provider.
    const provider = new FakeMicrostructureProvider(async () => raw);
    return snapshot.getSnapshot(provider, { symbol: "BTCUSD" }).then((full) => {
      const lines = formatMicrostructureEvidence(full);
      const text = lines.join("\n");
      assert.ok(text.includes("Provider: binance"));
      assert.ok(text.includes("Instrument: BTCUSD"));
      assert.ok(/Freshness: (fresh|stale|unknown|invalid)/.test(text));
      assert.ok(text.includes("Buy volume: unavailable"));
      assert.ok(text.includes("Sell volume: unavailable"));
      assert.ok(!/Buy volume: neutral|Sell volume: neutral|Volume delta: 0\b/.test(text), "must never invent a neutral/zero value for unavailable evidence");
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
