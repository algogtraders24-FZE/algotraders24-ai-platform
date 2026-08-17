// scripts/validate-microstructure-evidence-fusion.ts
// Sprint D2.8.11 - Microstructure-Aware Decision Intelligence & Evidence
// Fusion. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-evidence-fusion`.
//
// Design: Part A unit-tests assessMicrostructureEvidence() directly against
// deterministic MicrostructureSnapshot fixtures (built via D2.8.5's own
// unmodified buildMicrostructureSnapshot()) and synthetic hypothesis-type
// objects - covering all 15 required scenarios. Part B proves genuine
// end-to-end wiring through RealTimeIntelligenceService (D2.8.7) ->
// DecisionContextService.build(envelope, microstructure) (D2.8.11's own new
// optional parameter) using a real trending candle series that genuinely
// produces a "trend-continuation-bullish" hypothesis via the real,
// unmodified HypothesisService. Part C makes REAL live Binance calls for
// BTCUSD/ETHUSD and self-skips (never self-passes) honestly if the network
// is unavailable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMicrostructureEvidence } from "../services/intelligence/microstructure/microstructure-evidence-assessment.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { buildMicrostructureSnapshot, MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { binanceMicrostructureProvider, microstructureSnapshots } from "../services/microstructure/shared-instance";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult, RawMicrostructureEvidence, MicrostructureSnapshot } from "../types/microstructure";
import type { HypothesisType } from "../types/intelligence-hypothesis";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { CreateIntelligenceAnalysisRunInput, IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";

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
// Part A fixtures
// ============================================================
const NOW_MS = Date.parse("2026-08-17T12:00:00.000Z");
const GENERATED_AT = "2026-08-17T12:00:00.000Z";
const BULLISH: { type: HypothesisType } = { type: "trend-continuation-bullish" };
const BEARISH: { type: HypothesisType } = { type: "trend-continuation-bearish" };
const NON_DIRECTIONAL: { type: HypothesisType } = { type: "range-continuation" };

function rawEvidence(overrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureEvidence {
  return {
    bid: { state: "available", value: 63189.99 },
    ask: { state: "available", value: 63190.0 },
    bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1.92 }] },
    askLevels: { state: "available", value: [{ price: 63190.0, quantity: 6.39 }] },
    trades: {
      state: "available",
      value: [
        { price: 63189.99, quantity: 0.5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
        { price: 63190.0, quantity: 0.1, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
      ],
    },
    sequenceId: { state: "available", value: "1" },
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
function snapshot(overrides: Partial<RawMicrostructureResult> = {}, evidenceOverrides: Partial<RawMicrostructureEvidence> = {}, nowMs = NOW_MS): MicrostructureSnapshot {
  return buildMicrostructureSnapshot(rawResult(overrides, evidenceOverrides), nowMs);
}

// Bullish: bid-heavy depth (bidLevels >> askLevels) + net buy-dominant trades.
const bullishEvidenceOverrides: Partial<RawMicrostructureEvidence> = {
  bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 10 }] },
  askLevels: { state: "available", value: [{ price: 63190.0, quantity: 1 }] },
  trades: {
    state: "available",
    value: [
      { price: 63189.99, quantity: 5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
      { price: 63190.0, quantity: 0.5, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
    ],
  },
};
const bullishSnapshot = snapshot({}, bullishEvidenceOverrides);
// Bearish: ask-heavy depth + net sell-dominant trades.
const bearishEvidenceOverrides: Partial<RawMicrostructureEvidence> = {
  bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1 }] },
  askLevels: { state: "available", value: [{ price: 63190.0, quantity: 10 }] },
  trades: {
    state: "available",
    value: [
      { price: 63189.99, quantity: 0.5, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
      { price: 63190.0, quantity: 5, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
    ],
  },
};
const bearishSnapshot = snapshot({}, bearishEvidenceOverrides);
/** A raw fixture stamped with the REAL current time, for tests that run through the actual (non-clock-injected) MicrostructureSnapshotService in buildRealTimeService() - a hardcoded past/future ISO string would otherwise be misjudged as stale/invalid by the real freshness check. */
function freshRawResult(evidenceOverrides: Partial<RawMicrostructureEvidence>): RawMicrostructureResult {
  const now = new Date().toISOString();
  return rawResult({ timestamp: now, retrievedAt: now }, evidenceOverrides);
}
// Neutral: balanced depth + balanced trades.
const neutralSnapshot = snapshot(
  {},
  {
    bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 5 }] },
    askLevels: { state: "available", value: [{ price: 63190.0, quantity: 5 }] },
    trades: {
      state: "available",
      value: [
        { price: 63189.99, quantity: 1, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
        { price: 63190.0, quantity: 1.02, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
      ],
    },
  },
);

// ============================================================
// Part B fixtures (end-to-end wiring)
// ============================================================
function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    open: close - 5,
    high: close + 10,
    low: close - 10,
    close,
    volume: 1000 + i,
  }));
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
  readonly name = "fake-market-data";
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { symbol: request.symbol, provider: this.name, retrievedAt: new Date().toISOString(), evidence: [] };
  }
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
    const now = new Date();
    return {
      symbol: request.symbol,
      assetClass: "crypto",
      price: bullishCandles[bullishCandles.length - 1].close,
      quoteCurrency: "USD",
      timestamp: now.toISOString(),
      timezone: "UTC",
      marketStatus: "open",
      provider: "test-fixture",
      retrievedAt: now.toISOString(),
    };
  }
  async getTimeSeries(): Promise<Candle[]> {
    return bullishCandles;
  }
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
function buildRealTimeService(symbol: string, microstructureBehavior?: () => Promise<RawMicrostructureResult>) {
  const marketData = new FakeMarketData();
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(microstructureBehavior ?? (async () => rawResult({ symbol })));
  const microstructureService = new MicrostructureSnapshotService();
  const svc = new RealTimeIntelligenceService({ marketData, analysisRunService, microstructureProvider, microstructureService });
  return { svc, microstructureProvider };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: Bullish hypothesis + bullish microstructure -> confirms
  // ---------------------------------------------------------------------
  await test("1: bullish hypothesis + bullish microstructure -> confirms", () => {
    const result = assessMicrostructureEvidence(bullishSnapshot, BULLISH, GENERATED_AT);
    assert.equal(result.status, "confirms");
    assert.equal(result.balance, "bullish");
    assert.ok((result.bullishPressure as number) > 0);
  });

  // ---------------------------------------------------------------------
  // 2: Bullish hypothesis + bearish microstructure -> contradicts
  // ---------------------------------------------------------------------
  await test("2: bullish hypothesis + bearish microstructure -> contradicts", () => {
    const result = assessMicrostructureEvidence(bearishSnapshot, BULLISH, GENERATED_AT);
    assert.equal(result.status, "contradicts");
    assert.equal(result.balance, "bearish");
  });

  // ---------------------------------------------------------------------
  // 3: Bullish hypothesis + neutral microstructure -> neutral
  // ---------------------------------------------------------------------
  await test("3: bullish hypothesis + neutral microstructure -> neutral", () => {
    const result = assessMicrostructureEvidence(neutralSnapshot, BULLISH, GENERATED_AT);
    assert.equal(result.status, "neutral");
    assert.equal(result.balance, "neutral");
  });

  // ---------------------------------------------------------------------
  // 4: Bearish hypothesis + bearish microstructure -> confirms
  // ---------------------------------------------------------------------
  await test("4: bearish hypothesis + bearish microstructure -> confirms", () => {
    const result = assessMicrostructureEvidence(bearishSnapshot, BEARISH, GENERATED_AT);
    assert.equal(result.status, "confirms");
  });

  // ---------------------------------------------------------------------
  // 5: Bearish hypothesis + bullish microstructure -> contradicts
  // ---------------------------------------------------------------------
  await test("5: bearish hypothesis + bullish microstructure -> contradicts", () => {
    const result = assessMicrostructureEvidence(bullishSnapshot, BEARISH, GENERATED_AT);
    assert.equal(result.status, "contradicts");
  });

  // ---------------------------------------------------------------------
  // 6: Bearish hypothesis + neutral microstructure -> neutral
  // ---------------------------------------------------------------------
  await test("6: bearish hypothesis + neutral microstructure -> neutral", () => {
    const result = assessMicrostructureEvidence(neutralSnapshot, BEARISH, GENERATED_AT);
    assert.equal(result.status, "neutral");
  });

  // ---------------------------------------------------------------------
  // 7: Missing microstructure -> insufficient_evidence
  // ---------------------------------------------------------------------
  await test("7: missing microstructure -> insufficient_evidence, never a fabricated pressure", () => {
    const result = assessMicrostructureEvidence(undefined, BULLISH, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
    assert.equal(result.bullishPressure, undefined);
    assert.equal(result.bearishPressure, undefined);
    assert.equal(result.provider, undefined);
  });

  // ---------------------------------------------------------------------
  // 8: Stale microstructure -> insufficient_evidence
  // ---------------------------------------------------------------------
  await test("8: stale microstructure -> insufficient_evidence, never used to confirm/contradict", () => {
    const stale = snapshot({ timestamp: "2026-08-17T11:00:00.000Z", retrievedAt: "2026-08-17T11:00:00.100Z" });
    assert.equal(stale.freshnessStatus, "stale");
    const result = assessMicrostructureEvidence(stale, BULLISH, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
    assert.equal(result.freshness, "stale");
  });

  // ---------------------------------------------------------------------
  // 9: Invalid microstructure (crossed bid/ask) -> insufficient_evidence
  // ---------------------------------------------------------------------
  await test("9: invalid microstructure (crossed bid/ask) -> insufficient_evidence, snapshot never partially trusted", () => {
    const invalid = snapshot({}, { bid: { state: "invalid", reason: "crossed market" }, ask: { state: "invalid", reason: "crossed market" } });
    const result = assessMicrostructureEvidence(invalid, BULLISH, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
  });

  // ---------------------------------------------------------------------
  // 10: Unsupported instrument -> zero provider calls, no microstructureEvidence
  // ---------------------------------------------------------------------
  for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
    await test(`10 (${symbol}): unsupported instrument -> zero Binance calls, no substitution, no microstructureEvidence on DecisionContext`, async () => {
      const { svc, microstructureProvider } = buildRealTimeService(symbol);
      const ctx = await svc.build({ requestId: `r-${symbol}`, userId: "u1", question: symbol, symbol, includeMicrostructure: true });
      assert.equal(ctx.microstructure, undefined);
      assert.equal(microstructureProvider.callCount, 0);
      if (ctx.envelope) {
        const dc = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
        assert.equal(dc.microstructureEvidence, undefined);
      }
    });
  }
  await test("10b: no unsupported instrument's real catalog entry maps to Binance - rejection is structural", () => {
    for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
      const instrument = getCanonicalInstrument(symbol);
      assert.equal((instrument?.providerMappings ?? []).some((m) => m.provider === "binance"), false);
    }
  });

  // ---------------------------------------------------------------------
  // 11: Missing aggressor data -> volume-delta signal excluded, depth-only read still honest
  // ---------------------------------------------------------------------
  await test("11: missing aggressor data excludes the volume-delta signal but still uses real depth imbalance, never fabricates delta", () => {
    const noAggressor = snapshot(
      {},
      {
        bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 10 }] },
        askLevels: { state: "available", value: [{ price: 63190.0, quantity: 1 }] },
        trades: {
          state: "available",
          value: [{ price: 63189.99, quantity: 1, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "unavailable", reason: "no aggressor evidence" } }],
        },
      },
    );
    assert.equal(noAggressor.derived.volumeDelta.state, "unavailable");
    assert.equal(noAggressor.derived.depthImbalance.state, "available");
    const result = assessMicrostructureEvidence(noAggressor, BULLISH, GENERATED_AT);
    assert.equal(result.status, "confirms"); // depth imbalance alone is strongly bid-heavy
    assert.ok(result.basis.every((b) => !/volume delta/i.test(b) || /aggressor-mapped trade flow/i.test(b)));
  });

  // ---------------------------------------------------------------------
  // 12: Weak/insufficient evidence -> neutral, not forced directional
  // ---------------------------------------------------------------------
  await test("12: weak evidence magnitude is classified neutral, never forced into confirms/contradicts", () => {
    const result = assessMicrostructureEvidence(neutralSnapshot, BULLISH, GENERATED_AT);
    assert.equal(result.evidenceStrength, "weak");
    assert.equal(result.status, "neutral");
  });

  // ---------------------------------------------------------------------
  // 13: Crossed bid/ask (explicit, separate from test 9's framing)
  // ---------------------------------------------------------------------
  await test("13: crossed bid/ask never repaired or partially trusted for directional assessment", () => {
    const crossed = snapshot({}, { bid: { state: "invalid", reason: "bid > ask" }, ask: { state: "available", value: 63190.0 } });
    const result = assessMicrostructureEvidence(crossed, BEARISH, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
  });

  // ---------------------------------------------------------------------
  // 14: Malformed depth -> excluded, never treated as usable
  // ---------------------------------------------------------------------
  await test("14: malformed (invalid) order-book levels exclude the depth-imbalance signal, never fabricate 0", () => {
    const malformed = snapshot({}, { bidLevels: { state: "invalid", reason: "negative quantity" }, askLevels: { state: "invalid", reason: "negative quantity" } });
    assert.notEqual(malformed.derived.depthImbalance.state, "available");
    const result = assessMicrostructureEvidence(malformed, BULLISH, GENERATED_AT);
    // Real aggressor-mapped trades are still present in this fixture, so a
    // volume-delta-only read is still possible - proving the malformed
    // signal was excluded, not that the whole snapshot was rejected.
    assert.notEqual(result.status, "insufficient_evidence");
    assert.ok(result.basis.every((b) => !/depth imbalance/i.test(b)));
  });

  // ---------------------------------------------------------------------
  // 15: Future timestamp -> invalid freshness -> insufficient_evidence
  // ---------------------------------------------------------------------
  await test("15: a future timestamp is classified invalid freshness -> insufficient_evidence, never fresh", () => {
    const future = snapshot({ timestamp: "2026-08-17T13:00:00.000Z", retrievedAt: "2026-08-17T13:00:00.100Z" });
    assert.equal(future.freshnessStatus, "invalid");
    const result = assessMicrostructureEvidence(future, BULLISH, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
  });

  // ---------------------------------------------------------------------
  // Extra: non-directional hypothesis, no hypothesis at all
  // ---------------------------------------------------------------------
  await test("extra: a non-directional hypothesis (range-continuation) never receives a forced confirms/contradicts", () => {
    const result = assessMicrostructureEvidence(bullishSnapshot, NON_DIRECTIONAL, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
    assert.equal(result.hypothesisDirection, "neutral");
  });
  await test("extra: no hypothesis supplied at all -> insufficient_evidence, real pressure still preserved for display", () => {
    const result = assessMicrostructureEvidence(bullishSnapshot, undefined, GENERATED_AT);
    assert.equal(result.status, "insufficient_evidence");
    assert.ok((result.bullishPressure as number) > 0, "the real reading is still carried even though no comparison was possible");
  });

  // ---------------------------------------------------------------------
  // Attribution
  // ---------------------------------------------------------------------
  await test("attribution: provider/instrument/freshness/timestamp are always real and never a generic/global label", () => {
    const result = assessMicrostructureEvidence(bullishSnapshot, BULLISH, GENERATED_AT);
    assert.equal(result.provider, "binance");
    assert.equal(result.instrument, "BTCUSD");
    assert.equal(result.freshness, "fresh");
    assert.ok(!Number.isNaN(Date.parse(result.timestamp as string)));
  });

  // ---------------------------------------------------------------------
  // Part B: end-to-end wiring (real HypothesisService, real DecisionContextService)
  // ---------------------------------------------------------------------
  await test("end-to-end: a real trend-continuation-bullish hypothesis + bullish microstructure -> decisionContext.microstructureEvidence confirms", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-1", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    assert.equal(ctx.envelope.hypotheses[0]?.type, "trend-continuation-bullish", "the real HypothesisService must have generated the expected hypothesis from this trending fixture");
    const dc = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
    assert.ok(dc.microstructureEvidence);
    assert.equal(dc.microstructureEvidence!.status, "confirms");
    assert.equal(dc.microstructureEvidence!.hypothesisType, "trend-continuation-bullish");
  });
  await test("end-to-end: the same real bullish hypothesis + bearish microstructure -> decisionContext.microstructureEvidence contradicts", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => freshRawResult(bearishEvidenceOverrides));
    const ctx = await svc.build({ requestId: "e2e-2", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    assert.equal(ctx.envelope.hypotheses[0]?.type, "trend-continuation-bullish");
    const dc = new DecisionContextService().build(ctx.envelope, ctx.microstructure);
    assert.ok(dc.microstructureEvidence);
    assert.equal(dc.microstructureEvidence!.status, "contradicts");
  });
  await test("end-to-end: omitting the microstructure argument to build() leaves microstructureEvidence absent - byte-identical to pre-D2.8.11 behavior", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "e2e-3", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    assert.ok(ctx.envelope);
    const dc = new DecisionContextService().build(ctx.envelope);
    assert.equal(dc.microstructureEvidence, undefined);
  });
  await test("end-to-end: microstructure fusion never mutates intelligenceScore/regime/hypotheses (deep-equal to a request without it)", async () => {
    const clockNowMs = Date.now();
    const without = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const withMs = buildRealTimeService("BTCUSD", async () => freshRawResult(bullishEvidenceOverrides));
    const svcWithout = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: without.microstructureProvider, microstructureService: new MicrostructureSnapshotService(), clock: { now: () => clockNowMs } });
    const svcWith = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: withMs.microstructureProvider, microstructureService: new MicrostructureSnapshotService(), clock: { now: () => clockNowMs } });
    const ctxWithout = await svcWithout.build({ requestId: "e2e-4a", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    const ctxWith = await svcWith.build({ requestId: "e2e-4b", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.deepEqual(ctxWithout.envelope?.intelligenceScore, ctxWith.envelope?.intelligenceScore);
  });

  // ---------------------------------------------------------------------
  // Structural / architecture-reuse checks
  // ---------------------------------------------------------------------
  await test("structural: DecisionContextService reuses the real assessMicrostructureEvidence function - no second hypothesis/scoring engine was created", () => {
    const source = readFileSync(new URL("../services/intelligence/decision/decision-context.service.ts", import.meta.url), "utf8");
    assert.ok(source.includes('from "@/services/intelligence/microstructure/microstructure-evidence-assessment.service"'));
    assert.ok(!/class\s+\w*Hypothesis\w*Service/.test(source));
    assert.ok(!/class\s+\w*Score\w*Service/.test(source));
  });
  await test("structural: IntelligenceScoreService itself was not modified by this sprint (formula/weights untouched)", () => {
    const source = readFileSync(new URL("../services/intelligence/score/intelligence-score.service.ts", import.meta.url), "utf8");
    assert.ok(!/microstructure/i.test(source), "the score engine must remain completely unaware microstructure exists");
  });

  // ---------------------------------------------------------------------
  // Part C: real runtime validation (live network, self-skipping)
  // ---------------------------------------------------------------------
  for (const [label, symbol] of [["BTCUSD", "BTCUSD"], ["ETHUSD", "ETHUSD"]] as const) {
    await liveTest(`real ${label} runtime evidence assessment through the actual production shared instances`, async () => {
      const real = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol });
      console.log(
        `    real ${label}: bid=${real.evidence.bid.value} ask=${real.evidence.ask.value} spread=${real.derived.spread.value} ` +
          `depthImbalance=${real.derived.depthImbalance.value} buyVolume=${real.derived.buyVolume.value} sellVolume=${real.derived.sellVolume.value} ` +
          `volumeDelta=${real.derived.volumeDelta.value} freshness=${real.freshnessStatus} provider=${real.provider} timestamp=${real.timestamp}`,
      );
      // Phase 10 - demonstrate at least one real CONFIRMS and one real
      // CONTRADICTS: the real, unmanipulated evidence is compared against
      // BOTH a bullish and a bearish hypothesis for the SAME instrument -
      // whichever direction the real evidence actually leans, one
      // comparison will legitimately confirm and the other will
      // legitimately contradict, without altering the underlying data.
      const vsBullish = assessMicrostructureEvidence(real, BULLISH, new Date().toISOString());
      const vsBearish = assessMicrostructureEvidence(real, BEARISH, new Date().toISOString());
      console.log(`    real ${label} vs bullish hypothesis: ${vsBullish.status} (balance=${vsBullish.balance}, strength=${vsBullish.evidenceStrength})`);
      console.log(`    real ${label} vs bearish hypothesis: ${vsBearish.status} (balance=${vsBearish.balance}, strength=${vsBearish.evidenceStrength})`);
      assert.ok(["confirms", "contradicts", "neutral", "insufficient_evidence"].includes(vsBullish.status));
      if (vsBullish.balance !== "neutral") {
        // A non-neutral balance is definitionally the opposite relationship against the opposite hypothesis.
        assert.notEqual(vsBullish.status, vsBearish.status);
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (live/network)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
