// scripts/validate-microstructure-activation.ts
// Sprint D2.8.9 - Production Microstructure Activation & Controlled
// Rollout. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-activation`.
//
// Design: reuses the exact fixture conventions established in
// scripts/validate-microstructure-context-integration.ts (D2.8.7) and
// scripts/validate-microstructure-presentation.ts (D2.8.8) - FakeMarketData,
// FakeMicrostructureProvider, buildMicrostructureSnapshot() fixtures,
// RecordingPresenter - rather than inventing new ones. Tests 29/30 make
// REAL live calls through D2.8.6's actual shared instances
// (binanceMicrostructureProvider/microstructureSnapshots) against Binance's
// public REST API and self-skip (never self-pass) honestly if the network
// is unavailable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { AIPresenterOrchestratorService, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { validateResponseIntegrity } from "../services/intelligence/chat/ai-response-integrity.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { binanceMicrostructureProvider, microstructureSnapshots } from "../services/microstructure/shared-instance";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult, RawMicrostructureEvidence } from "../types/microstructure";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "../types/intelligence-envelope";
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
// Fixtures (same conventions as D2.8.7/D2.8.8's own scripts)
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
function trendingCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(30000 + i * 20);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 5 + (i % 3));
  return [...rise, ...plateau];
}
const bullishCandles = makeCandles(trendingCloses());

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

function rawEvidence(overrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureEvidence {
  return {
    bid: { state: "available", value: 63189.99 },
    ask: { state: "available", value: 63190.0 },
    bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1.92 }] },
    askLevels: { state: "available", value: [{ price: 63190.0, quantity: 6.39 }] },
    trades: {
      state: "available",
      value: [
        { price: 63189.99, quantity: 0.01, timestamp: "2026-08-16T17:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
        { price: 63190.0, quantity: 0.02, timestamp: "2026-08-16T17:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
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
    timestamp: "2026-08-16T17:59:56.500Z",
    retrievedAt: "2026-08-16T17:59:56.600Z",
    evidence: rawEvidence(evidenceOverrides),
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

function buildRealTimeService(symbol: string, microstructureBehavior?: () => Promise<RawMicrostructureResult>) {
  const marketData = new FakeMarketData();
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(microstructureBehavior ?? (async () => rawResult({ symbol })));
  const microstructureService = new MicrostructureSnapshotService();
  const svc = new RealTimeIntelligenceService({ marketData, analysisRunService, microstructureProvider, microstructureService });
  return { svc, microstructureProvider };
}

class RecordingPresenter implements AIIntelligencePresenter {
  readonly name = "recording-presenter";
  lastQuestion = "";
  constructor(private readonly responseText: string = "Real, verified analysis text.") {}
  async present(_envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult> {
    this.lastQuestion = userQuestion;
    return { text: this.responseText, presentedBy: this.name, envelopeGeneratedAt: _envelope.generatedAt };
  }
}
function orchestratorWithRecordingPresenter(responseText?: string): { orchestrator: AIPresenterOrchestratorService; presenter: RecordingPresenter } {
  const presenter = new RecordingPresenter(responseText);
  const slots: PresenterSlot[] = [{ name: "recording", isAvailable: () => true, createPresenter: () => presenter }];
  return { orchestrator: new AIPresenterOrchestratorService({ slots }), presenter };
}

const UNSUPPORTED_SYMBOLS = ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"];

/**
 * MarketStateService/HypothesisService (both protected, unmodified this
 * sprint) stamp their own evidence/hypothesis `generatedAt`/`retrievedAt`/
 * `asOf`/id-embedded timestamps via their own internal `new Date()` calls -
 * they accept no injectable clock. Two separate RealTimeIntelligenceService.
 * build() calls, even sharing one injected top-level clock, will therefore
 * always differ in these wall-clock artifacts by a few milliseconds -
 * regardless of microstructure. Normalizing them out here isolates the
 * actual claim these tests make (no scoring/regime/hypothesis MUTATION)
 * from this pre-existing, unrelated non-determinism.
 */
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
function normalizeTimestamps<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) => {
      if (key === "id" || key === "hypothesisId") return "<ID>";
      // Blanks out an ISO timestamp anywhere within a string - not just a
      // whole-string match - since several real, honest basis/description
      // sentences embed a hypothesis id (itself timestamp-suffixed) as
      // prose (e.g. "Derived from hypothesis ... (id BTCUSD-1h-...-<ISO>)").
      if (typeof val === "string" && ISO_TIMESTAMP_PATTERN.test(val)) return val.replace(ISO_TIMESTAMP_PATTERN, "<TIMESTAMP>");
      return val;
    }),
  );
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: Production entry point identified
  // ---------------------------------------------------------------------
  await test("1: the real production chat route sets includeMicrostructure:true on its IntelligencePresentationService.present() call", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(/intelligencePresentationService\.present\(\{[\s\S]*?includeMicrostructure:\s*true/.test(source), "the chat route must request microstructure by default");
  });
  await test("1b: the Research panel route (ResearchSnapshotService) was activated in Sprint D2.8.13 - it is no longer a separate, unactivated caller", () => {
    // Sprint D2.8.9 originally documented ResearchSnapshotService as a
    // deliberately unactivated second caller ("a path with no evidence
    // consumer"). Sprint D2.8.13 found and closed that gap: the Research
    // panel now has a real evidence consumer (VerifiedAnswerResponse.
    // microstructureEvidence -> MicrostructureEvidenceSection), so this
    // premise is intentionally reversed here rather than left stale -
    // see scripts/validate-microstructure-production-wiring.ts's own
    // "structural" test for the current, load-bearing assertion.
    const source = readFileSync(new URL("../services/intelligence/chat/research-snapshot.service.ts", import.meta.url), "utf8");
    assert.ok(/includeMicrostructure:\s*true/.test(source), "D2.8.13 activated microstructure on this caller - this test's premise is deliberately reversed from D2.8.9's original");
  });

  // ---------------------------------------------------------------------
  // 2: includeMicrostructure activation
  // ---------------------------------------------------------------------
  await test("2: includeMicrostructure:true reaches a real microstructure fetch for a Binance-capable symbol", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r2", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.microstructure);
  });

  // ---------------------------------------------------------------------
  // 3/4: BTCUSDT/ETHUSDT capability gating
  // ---------------------------------------------------------------------
  await test("3: BTCUSD's real canonical catalog entry is Binance-capable (quote)", () => {
    const instrument = getCanonicalInstrument("BTCUSD");
    assert.ok((instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote")));
  });
  await test("4: ETHUSD's real canonical catalog entry is Binance-capable (quote)", () => {
    const instrument = getCanonicalInstrument("ETHUSD");
    assert.ok((instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote")));
  });

  // ---------------------------------------------------------------------
  // 5-10: unsupported instruments blocked from Binance
  // ---------------------------------------------------------------------
  for (const symbol of UNSUPPORTED_SYMBOLS) {
    await test(`${symbol} blocked from Binance microstructure - no provider call, no evidence, no substitution`, async () => {
      const { svc, microstructureProvider } = buildRealTimeService(symbol);
      const ctx = await svc.build({ requestId: `r-${symbol}`, userId: "u1", question: `Analyze ${symbol}`, symbol, includeMicrostructure: true });
      assert.equal(ctx.microstructure, undefined);
      assert.equal(microstructureProvider.callCount, 0);
    });
  }

  // ---------------------------------------------------------------------
  // 11: no symbol substitution
  // ---------------------------------------------------------------------
  await test("11: no unsupported instrument's real catalog entry maps to Binance - rejection is structural", () => {
    for (const symbol of UNSUPPORTED_SYMBOLS) {
      const instrument = getCanonicalInstrument(symbol);
      assert.equal((instrument?.providerMappings ?? []).some((m) => m.provider === "binance"), false, `${symbol} must not be Binance-mapped`);
    }
  });

  // ---------------------------------------------------------------------
  // 12/13: provider + venue-specific attribution
  // ---------------------------------------------------------------------
  await test("12: activated microstructure carries real Binance provider attribution", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r12", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.provider, "binance");
  });
  await test("13: activated microstructure remains explicitly venue-specific (never global liquidity)", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r13", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.microstructure);
    assert.equal(ctx.microstructure!.symbol, "BTCUSD");
  });

  // ---------------------------------------------------------------------
  // 14: microstructure timeout isolation (genuinely slow - proves the real
  // D2.8.9 timeout wrapper fires, not simulated). A never-resolving fetch
  // is raced against the real 8s default timeout budget
  // (lib/market-data/reliability.ts's own DEFAULTS.timeoutMs, reused
  // unmodified) - this test intentionally takes ~8s.
  // ---------------------------------------------------------------------
  await test("14: a hung Binance microstructure call times out and never blocks the rest of the intelligence response (~8s, real timeout budget)", async () => {
    const startedAt = Date.now();
    const { svc } = buildRealTimeService("BTCUSD", () => new Promise<RawMicrostructureResult>(() => {})); // never resolves
    const ctx = await svc.build({ requestId: "r14", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(ctx.microstructure, undefined);
    assert.equal(ctx.status, "resolved");
    assert.ok(ctx.envelope, "the rest of the intelligence response must still complete despite the hung microstructure call");
    assert.ok(elapsedMs < 10_000, `expected the timeout to bound this well under 10s, took ${elapsedMs}ms`);
  });

  // ---------------------------------------------------------------------
  // 15: Binance HTTP failure isolation
  // ---------------------------------------------------------------------
  await test("15: a Binance HTTP failure is isolated - normal intelligence still resolves", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => {
      throw new MarketDataProviderError("http_error", "simulated 500", "binance");
    });
    const ctx = await svc.build({ requestId: "r15", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    assert.equal(ctx.status, "resolved");
    assert.ok(ctx.envelope);
  });

  // ---------------------------------------------------------------------
  // 16: malformed response isolation
  // ---------------------------------------------------------------------
  await test("16: a malformed/invalid Binance response is isolated - normal intelligence still resolves", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => {
      throw new MarketDataProviderError("invalid_response", "Binance response was not valid JSON", "binance");
    });
    const ctx = await svc.build({ requestId: "r16", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    assert.equal(ctx.status, "resolved");
  });

  // ---------------------------------------------------------------------
  // 17: stale state preservation
  // ---------------------------------------------------------------------
  await test("17: an activated-but-stale snapshot is preserved as stale, never silently fresh", async () => {
    const NOW_MS = Date.parse("2026-08-16T18:00:00.000Z");
    const staleRaw = rawResult({ timestamp: "2026-08-16T17:00:00.000Z", retrievedAt: "2026-08-16T17:00:00.100Z" });
    const svc = new RealTimeIntelligenceService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: new FakeMicrostructureProvider(async () => staleRaw),
      microstructureService: new MicrostructureSnapshotService({ now: () => NOW_MS }),
    });
    const ctx = await svc.build({ requestId: "r17", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.freshnessStatus, "stale");
  });

  // ---------------------------------------------------------------------
  // 18: unavailable state preservation
  // ---------------------------------------------------------------------
  await test("18: activated microstructure with entirely unavailable evidence preserves the unavailable state, never a fabricated value", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () =>
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
    );
    const ctx = await svc.build({ requestId: "r18", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure?.evidence.bid.state, "unavailable");
    assert.equal(ctx.microstructure?.evidence.bid.value, undefined);
  });

  // ---------------------------------------------------------------------
  // 19: normal intelligence survives microstructure failure
  // ---------------------------------------------------------------------
  await test("19: normal intelligence (envelope, regime, hypotheses) is fully populated even when microstructure fails entirely", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => {
      throw new MarketDataProviderError("timeout", "simulated timeout", "binance");
    });
    const ctx = await svc.build({ requestId: "r19", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope);
    assert.ok(ctx.envelope!.regime);
    assert.ok(Array.isArray(ctx.envelope!.hypotheses));
    assert.ok(ctx.envelope!.intelligenceScore);
  });

  // ---------------------------------------------------------------------
  // 20/21/22/23: no mutation of score/regime/hypotheses/decisionContext
  // ---------------------------------------------------------------------
  await test("20/21/22: activating microstructure never changes Intelligence Score, Regime, or Hypotheses - byte-identical to a request without it", async () => {
    const clockNowMs = Date.now();
    const without = buildRealTimeService("BTCUSD");
    const withMs = buildRealTimeService("BTCUSD");
    const svcWithout = new RealTimeIntelligenceService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: without.microstructureProvider,
      microstructureService: new MicrostructureSnapshotService(),
      clock: { now: () => clockNowMs },
    });
    const svcWith = new RealTimeIntelligenceService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: withMs.microstructureProvider,
      microstructureService: new MicrostructureSnapshotService(),
      clock: { now: () => clockNowMs },
    });
    const ctxWithout = await svcWithout.build({ requestId: "r20a", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    const ctxWith = await svcWith.build({ requestId: "r20b", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.deepEqual(ctxWithout.envelope?.intelligenceScore, ctxWith.envelope?.intelligenceScore);
    assert.deepEqual(normalizeTimestamps(ctxWithout.envelope?.regime), normalizeTimestamps(ctxWith.envelope?.regime));
    assert.deepEqual(normalizeTimestamps(ctxWithout.envelope?.hypotheses), normalizeTimestamps(ctxWith.envelope?.hypotheses));
  });
  await test("23: DecisionContext built from a microstructure-activated envelope is identical to one built without it", async () => {
    const clockNowMs = Date.now();
    const decisionContextService = new DecisionContextService();
    const a = buildRealTimeService("BTCUSD");
    const b = buildRealTimeService("BTCUSD");
    const svcA = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: a.microstructureProvider, microstructureService: new MicrostructureSnapshotService(), clock: { now: () => clockNowMs } });
    const svcB = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: b.microstructureProvider, microstructureService: new MicrostructureSnapshotService(), clock: { now: () => clockNowMs } });
    const ctxA = await svcA.build({ requestId: "r23a", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    const ctxB = await svcB.build({ requestId: "r23b", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctxA.envelope && ctxB.envelope);
    const dcA = decisionContextService.build(ctxA.envelope!);
    const dcB = decisionContextService.build(ctxB.envelope!);
    assert.deepEqual(normalizeTimestamps(dcA), normalizeTimestamps(dcB), "DecisionContext must be structurally identical regardless of microstructure activation - it never receives microstructure at all");
  });

  // ---------------------------------------------------------------------
  // 24/25/26: presenter integration + response integrity
  // ---------------------------------------------------------------------
  await test("24: the AI presenter receives verified, attributed microstructure evidence when activated", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r24", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
    await orchestrator.present(ctx.envelope!, "BTCUSD", ctx.microstructure);
    assert.ok(presenter.lastQuestion.includes("Provider: binance"));
    assert.ok(presenter.lastQuestion.includes("Direct Evidence"));
    assert.ok(presenter.lastQuestion.includes("Derived Evidence"));
  });
  await test("25: response integrity recognizes real, activated microstructure numbers as legitimate evidence", async () => {
    const decisionContextService = new DecisionContextService();
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r25", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const decisionContext = decisionContextService.build(ctx.envelope!);
    const result = validateResponseIntegrity("The current Binance BTCUSD bid is 63189.99 and the ask is 63190.", ctx.envelope!, decisionContext, ctx.microstructure);
    assert.equal(result.valid, true, `expected valid, got: ${JSON.stringify(result.violations)}`);
  });
  await test("26: response integrity still rejects fabricated evidence even when real microstructure is active", async () => {
    const decisionContextService = new DecisionContextService();
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r26", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const decisionContext = decisionContextService.build(ctx.envelope!);
    const result = validateResponseIntegrity("A completely fabricated 120000.00 price claim never in evidence.", ctx.envelope!, decisionContext, ctx.microstructure);
    assert.equal(result.valid, false);
  });

  // ---------------------------------------------------------------------
  // 27: no duplicate microstructure architecture
  // ---------------------------------------------------------------------
  await test("27: activation reuses D2.8.5/D2.8.6's real shared microstructure instances - no second implementation was created", () => {
    const source = readFileSync(new URL("../services/intelligence/orchestration/real-time-intelligence.service.ts", import.meta.url), "utf8");
    assert.ok(source.includes('from "@/services/microstructure/shared-instance"'));
    assert.ok(source.includes('from "@/services/microstructure/microstructure-snapshot.service"'));
    assert.ok(!/class\s+\w*Microstructure\w*Service/.test(source), "no second MicrostructureSnapshotService-like class was defined in this file");
  });

  // ---------------------------------------------------------------------
  // 28: no unnecessary provider calls
  // ---------------------------------------------------------------------
  await test("28: a single Binance-capable request calls the microstructure provider exactly once, never twice", async () => {
    const { svc, microstructureProvider } = buildRealTimeService("BTCUSD");
    await svc.build({ requestId: "r28", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(microstructureProvider.callCount, 1);
  });

  // ---------------------------------------------------------------------
  // 29/30: real runtime verification (live network, self-skipping)
  // ---------------------------------------------------------------------
  const liveTimings: Record<string, number> = {};
  await liveTest("29: real BTCUSDT runtime verification through the actual production shared instances", async () => {
    const startedAt = Date.now();
    const snapshot = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "BTCUSD" });
    liveTimings.btcusd = Date.now() - startedAt;
    assert.equal(snapshot.provider, "binance");
    assert.equal(snapshot.evidence.bid.state, "available");
    assert.equal(snapshot.evidence.ask.state, "available");
    assert.ok((snapshot.evidence.bid.value as number) > 0);
    assert.ok((snapshot.evidence.ask.value as number) >= (snapshot.evidence.bid.value as number));
    assert.ok(snapshot.evidence.trades.state === "available", "real recent trades must be present");
    assert.ok(snapshot.freshnessStatus === "fresh" || snapshot.freshnessStatus === "stale");
    console.log(`    real BTCUSDT: bid=${snapshot.evidence.bid.value} ask=${snapshot.evidence.ask.value} spread=${snapshot.derived.spread.value} freshness=${snapshot.freshnessStatus} elapsed=${liveTimings.btcusd}ms`);
  });
  await liveTest("30: real ETHUSDT runtime verification through the actual production shared instances", async () => {
    const startedAt = Date.now();
    const snapshot = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "ETHUSD" });
    liveTimings.ethusd = Date.now() - startedAt;
    assert.equal(snapshot.provider, "binance");
    assert.equal(snapshot.evidence.bid.state, "available");
    assert.ok((snapshot.evidence.bid.value as number) > 0);
    console.log(`    real ETHUSDT: bid=${snapshot.evidence.bid.value} ask=${snapshot.evidence.ask.value} spread=${snapshot.derived.spread.value} freshness=${snapshot.freshnessStatus} elapsed=${liveTimings.ethusd}ms`);
  });

  // ---------------------------------------------------------------------
  // Extra: performance audit (Phase 5) - measures added latency/provider
  // calls between a base request and a microstructure-activated one,
  // using controllable fake delays rather than real network variance.
  // ---------------------------------------------------------------------
  await test("extra: activating microstructure adds exactly one bounded provider call's worth of latency, never a multiplied/repeated cost", async () => {
    const ARTIFICIAL_DELAY_MS = 40;
    const delayedProvider = new FakeMicrostructureProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, ARTIFICIAL_DELAY_MS));
      return rawResult({ symbol: "BTCUSD" });
    });
    const baseStart = Date.now();
    const baseSvc = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: delayedProvider, microstructureService: new MicrostructureSnapshotService() });
    await baseSvc.build({ requestId: "rperf-a", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: false });
    const baseElapsed = Date.now() - baseStart;

    const msStart = Date.now();
    const msSvc = new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: delayedProvider, microstructureService: new MicrostructureSnapshotService() });
    await msSvc.build({ requestId: "rperf-b", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    const msElapsed = Date.now() - msStart;

    console.log(`    perf: base=${baseElapsed}ms, with-microstructure=${msElapsed}ms, delta=${msElapsed - baseElapsed}ms (artificial provider delay=${ARTIFICIAL_DELAY_MS}ms)`);
    assert.equal(delayedProvider.callCount, 1, "the delayed provider must be called exactly once across both requests combined (never called when includeMicrostructure is false)");
    assert.ok(msElapsed - baseElapsed >= ARTIFICIAL_DELAY_MS - 5, "the added latency should be at least roughly the one real provider call's delay");
    assert.ok(msElapsed - baseElapsed < ARTIFICIAL_DELAY_MS * 3, "the added latency must not be a multiple of the provider delay (no duplicate/retried calls)");
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (live/network)`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
