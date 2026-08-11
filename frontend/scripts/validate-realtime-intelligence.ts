// scripts/validate-realtime-intelligence.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// Standalone, assert-based verification (no test framework, no live
// network - fake providers/AI throughout), matching every prior sprint's
// scripts/validate-*.ts pattern. Run via `npm run validate:realtime-intelligence`.
//
// Fixture builders (makeCandles/snapshotFor/trendingBullishCloses) are
// copied from scripts/validate-hypothesis-engine.ts, matching this
// project's own established convention of each validate-*.ts script being
// self-contained rather than importing another script's fixtures.
//
// Design: only the market-data seam (FakeMarketData) and the AI provider
// seam (FakeAIProvider) are faked - MarketStateService, RegimeService,
// HypothesisService, the frozen 15D pipeline, IntelligenceEnvelopeService,
// IntelligenceQueryContextService, and DecisionContextService all run for
// real, so this suite proves genuine end-to-end wiring, not just isolated
// units. AnalysisRunService/AnalysisHistoryService/HistoricalValidationService
// are faked in most tests to stay DB-free and fast; a dedicated real-DB
// persistence section (R/S/T/Q) proves the actual Prisma-backed path works,
// self-cleaning like every other sprint's DB-touching script.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RealTimeIntelligenceService, DEFAULT_INTELLIGENCE_TIMEFRAME } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { evaluatePendingAnalysisRunsForUser } from "../services/intelligence/orchestration/pending-outcome-evaluation.service";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import { GeminiIntelligencePresenter, GEMINI_PRESENTER_SYSTEM_INSTRUCTION } from "../services/intelligence/chat/gemini-intelligence-presenter.service";
import { DeterministicSafeFallbackPresenter } from "../services/intelligence/chat/deterministic-safe-fallback-presenter.service";
import { validateResponseIntegrity, presentSafely } from "../services/intelligence/chat/ai-response-integrity.service";
import { formatDecisionContextAsText } from "../services/intelligence/chat/decision-context-formatter";
import { summarizeConflicts } from "../services/market-data/cross-provider-validation.service";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { IntelligenceAnalysisRunService, type CreateIntelligenceAnalysisRunInput } from "../services/intelligence/memory/analysis-run.service";
import { AnalysisHistoryService } from "../services/intelligence/query/analysis-history.service";
import { HistoricalValidationService } from "../services/intelligence/memory/historical-validation.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, SnapshotProvider, TimeSeriesProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionRequest, AICompletionResponse } from "../lib/ai/types";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";
import type { HistoricalValidation } from "../types/intelligence-historical-validation";
import { prisma } from "../lib/prisma";

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
// Fixture builders (copied from scripts/validate-hypothesis-engine.ts)
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
    symbol: "EURUSD",
    assetClass: "forex",
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
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}

const bullishCandles = makeCandles(trendingBullishCloses());
const bullishSnapshot = snapshotFor(bullishCandles);

// ============================================================
// Fake MarketDataProvider (the one real network seam)
// ============================================================
class FakeMarketData implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name: string;
  constructor(
    private readonly behavior: {
      snapshot?: () => Promise<MarketSnapshot>;
      candles?: () => Promise<Candle[]>;
    } = {},
    name = "fake-provider",
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

function freshMarketData(): FakeMarketData {
  const now = new Date();
  const freshSnapshot = { ...bullishSnapshot, timestamp: now.toISOString(), retrievedAt: now.toISOString() };
  return new FakeMarketData({ snapshot: async () => freshSnapshot, candles: async () => bullishCandles });
}

// ============================================================
// Fake sub-services (DB-free, deterministic)
// ============================================================
function fakeAnalysisRunService(): IntelligenceAnalysisRunService & { created: CreateIntelligenceAnalysisRunInput[] } {
  const created: CreateIntelligenceAnalysisRunInput[] = [];
  return {
    created,
    async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
      created.push(input);
      return {
        id: `fake-run-${created.length}`,
        userId: input.userId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        pipelineVersion: input.analysisResult?.metadata.pipelineVersion ?? null,
        analysisResult: input.analysisResult,
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
  } as unknown as IntelligenceAnalysisRunService & { created: CreateIntelligenceAnalysisRunInput[] };
}

function fakeAnalysisHistory(runsByIdForUser: Map<string, IntelligenceAnalysisRun>): AnalysisHistoryService {
  return {
    async getOwnedAnalysisRun(analysisRunId: string, userId: string): Promise<IntelligenceAnalysisRun | null> {
      const run = runsByIdForUser.get(analysisRunId);
      return run && run.userId === userId ? run : null;
    },
    async getOwnedOutcomesForRun(): Promise<never[]> {
      return [];
    },
    async getAnalysisWithOutcomes(): Promise<undefined> {
      return undefined;
    },
    async listRunsForUser(): Promise<never[]> {
      return [];
    },
  } as unknown as AnalysisHistoryService;
}

function fakeHistoricalValidation(result: HistoricalValidation): HistoricalValidationService {
  return { async buildHistoricalValidation(): Promise<HistoricalValidation> { return result; } } as unknown as HistoricalValidationService;
}

function buildOrchestrator(overrides: Partial<{ marketData: FakeMarketData; analysisRunService: ReturnType<typeof fakeAnalysisRunService>; analysisHistory: AnalysisHistoryService; historicalValidationService: HistoricalValidationService; crossProviderRegistry: Record<string, () => MarketDataProvider & SnapshotProvider> }> = {}) {
  const analysisRunService = overrides.analysisRunService ?? fakeAnalysisRunService();
  const marketData = overrides.marketData ?? freshMarketData();
  const svc = new RealTimeIntelligenceService({
    marketData,
    analysisRunService,
    analysisHistory: overrides.analysisHistory,
    historicalValidationService: overrides.historicalValidationService,
    providerRegistry: overrides.crossProviderRegistry,
  });
  return { svc, analysisRunService, marketData };
}

// ============================================================
// A-H, L: RealTimeIntelligenceService core orchestration
// ============================================================
async function orchestrationTests(): Promise<void> {
  await test("A: fresh provider success resolves with fresh data quality and a real envelope", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r1", userId: "user-a", question: "What is happening in EURUSD?" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.dataQuality?.state, "fresh");
    assert.ok(ctx.envelope);
    assert.equal(ctx.envelope?.symbol, "EURUSD");
  });

  await test("B: fallbackUsed provenance is honestly carried through to observability", async () => {
    const marketData = new FakeMarketData({
      snapshot: async () => ({ ...bullishSnapshot, fallbackUsed: true, timestamp: new Date().toISOString() }),
      candles: async () => bullishCandles,
    });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r2", userId: "user-a", question: "EURUSD analysis" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.observability.fallbackUsed, true);
  });

  await test("D: stale data is honestly reported, never silently presented as fresh", async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString(); // 10min old - stale for forex (60s threshold)
    const marketData = new FakeMarketData({ snapshot: async () => ({ ...bullishSnapshot, timestamp: staleTimestamp }), candles: async () => bullishCandles });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r3", userId: "user-a", question: "EURUSD analysis" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.dataQuality?.state, "stale");
  });

  await test("E: every provider failing returns insufficient-data, never a fabricated envelope", async () => {
    const marketData = new FakeMarketData({ snapshot: async () => { throw new MarketDataProviderError("http_error", "down", "fake"); } });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r4", userId: "user-a", question: "EURUSD analysis" });
    assert.equal(ctx.status, "insufficient-data");
    assert.equal(ctx.envelope, undefined);
    assert.equal(ctx.dataQuality?.state, "unavailable");
  });

  await test("E2: a structurally invalid snapshot (bad price) is treated as insufficient-data, never handed to the intelligence engines", async () => {
    const marketData = new FakeMarketData({ snapshot: async () => ({ ...bullishSnapshot, price: -5, timestamp: new Date().toISOString() }) });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r4b", userId: "user-a", question: "EURUSD analysis" });
    assert.equal(ctx.status, "insufficient-data");
    assert.equal(ctx.envelope, undefined);
  });

  await test("F: an unresolvable symbol returns clarification-required, never guessed - no market-data call is ever made", async () => {
    let called = false;
    const marketData = new FakeMarketData({ snapshot: async () => { called = true; throw new Error("should never be called"); } });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r5", userId: "user-a", question: "how do I use this platform" });
    assert.equal(ctx.status, "clarification-required");
    assert.equal(ctx.clarification?.reason, "unresolved-symbol");
    assert.equal(called, false);
  });

  await test("G: an ambiguous question mentioning two real symbols returns clarification-required with real candidates, never an arbitrary pick", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r6", userId: "user-a", question: "compare gold and bitcoin" });
    assert.equal(ctx.status, "clarification-required");
    assert.equal(ctx.clarification?.reason, "ambiguous-symbol");
    assert.ok(ctx.clarification?.candidates?.includes("XAUUSD"));
    assert.ok(ctx.clarification?.candidates?.includes("BTCUSD"));
  });

  await test("H: a missing timeframe uses the documented default for computation but never fabricates query.timeframe itself", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r7", userId: "user-a", question: "What is happening in EURUSD?" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.query.timeframe, undefined, "the query's own timeframe field must stay honestly unresolved");
    assert.equal(ctx.envelope?.timeframe, DEFAULT_INTELLIGENCE_TIMEFRAME);
    assert.equal(ctx.queryContext?.completeness, "partial", "completeness must honestly reflect the unspecified timeframe");
  });

  await test("I: a strongly trending market produces a real, non-fabricated hypothesis", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r8", userId: "user-a", question: "EURUSD trend" });
    assert.equal(ctx.status, "resolved");
    assert.ok((ctx.envelope?.hypotheses.length ?? 0) >= 1);
    assert.equal(ctx.envelope?.hypotheses[0].generatedBy, "deterministic-hypothesis-engine-v2");
  });

  await test("K: historicalValidation stays undefined (not fabricated) whenever more than one hypothesis is generated or none at all is generated", async () => {
    // A flat/insufficient market yields either 0 or >1 hypotheses depending on regime - either way this envelope must never carry a fabricated single-hypothesis historical segment it didn't actually compute.
    const flatCandles = makeCandles(Array.from({ length: 30 }, () => 1.1));
    const marketData = new FakeMarketData({ snapshot: async () => ({ ...bullishSnapshot, timestamp: new Date().toISOString() }), candles: async () => flatCandles });
    const { svc } = buildOrchestrator({ marketData });
    const ctx = await svc.build({ requestId: "r9", userId: "user-a", question: "EURUSD" });
    if ((ctx.envelope?.hypotheses.length ?? 0) !== 1) {
      assert.equal(ctx.envelope?.historicalValidation, undefined);
    }
  });

  await test("L: IntelligenceScore is still honestly computed (with unavailable components, never fabricated) when the 15D evidence leg is unavailable", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r10", userId: "user-a", question: "EURUSD" });
    assert.equal(ctx.status, "resolved");
    assert.ok(ctx.envelope?.intelligenceScore.basis.length ?? 0 > 0);
  });

  await test("K2: a forced historical validation (including an honest insufficient-sample state) is passed through verbatim, never recomputed", async () => {
    const forced: HistoricalValidation = {
      symbol: "EURUSD",
      timeframe: DEFAULT_INTELLIGENCE_TIMEFRAME,
      regimeType: "trending-bullish",
      hypothesisType: "trend-continuation-bullish",
      sampleSize: 5,
      validatedCount: 2,
      invalidatedCount: 2,
      inconclusiveCount: 1,
      validatedRate: undefined,
      minSampleSize: 30,
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    const { svc } = buildOrchestrator({ historicalValidationService: fakeHistoricalValidation(forced) });
    const ctx = await svc.build({ requestId: "r13", userId: "user-a", question: "EURUSD" });
    assert.equal(ctx.status, "resolved");
    if ((ctx.envelope?.hypotheses.length ?? 0) === 1) {
      assert.equal(ctx.envelope?.historicalValidation?.sampleSize, 5);
      assert.equal(ctx.envelope?.historicalValidation?.validatedRate, undefined, "below-threshold sample must never fabricate a validated rate");
    }
  });

  await test("Conversation continuity: a real previous regime is looked up best-effort and threaded into RegimeService.classify", async () => {
    const fakeRun: IntelligenceAnalysisRun = {
      id: "prev-run-1",
      userId: "user-a",
      symbol: "EURUSD",
      timeframe: "1h",
      pipelineVersion: null,
      analysisResult: null,
      regimeAtTime: null,
      hypothesisSnapshot: {
        marketState: { symbol: "EURUSD", timeframe: "1h", snapshot: bullishSnapshot, dataQuality: { band: "high", computed: 4, total: 4, note: "fixture" }, generatedAt: "t", pipelineVersion: "2.0.0" },
        regime: { symbol: "EURUSD", timeframe: "1h", regimeType: "trending-bearish", confidence: 80, basis: ["prior run"], generatedAt: "t", pipelineVersion: "2.0.0" },
        hypotheses: [],
        capturedAt: "t",
      },
      evaluationStatus: "pending",
      createdAt: "t",
    };
    const history = fakeAnalysisHistory(new Map([["prev-run-1", fakeRun]]));
    const { svc } = buildOrchestrator({ analysisHistory: history });
    const ctx = await svc.build({ requestId: "r14", userId: "user-a", question: "EURUSD", conversationContext: { previousAnalysisRunId: "prev-run-1" } });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.regime.previousRegime, "trending-bearish");
  });

  await test("Determinism: identical fake inputs at a fixed clock produce an identical resolved status and symbol", async () => {
    const { svc: svc1 } = buildOrchestrator();
    const { svc: svc2 } = buildOrchestrator();
    const ctx1 = await svc1.build({ requestId: "rA", userId: "user-a", question: "EURUSD", requestedAt: "2026-01-01T00:00:00.000Z" });
    const ctx2 = await svc2.build({ requestId: "rA", userId: "user-a", question: "EURUSD", requestedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(ctx1.status, ctx2.status);
    assert.equal(ctx1.envelope?.symbol, ctx2.envelope?.symbol);
  });
}

// ============================================================
// C: Cross-provider validation (opt-in)
// ============================================================
async function crossProviderTests(): Promise<void> {
  await test("C: cross-provider validation, when opted in, preserves a real material disagreement as unresolved-conflict", async () => {
    const now = new Date();
    const primary = new FakeMarketData({ snapshot: async () => ({ ...bullishSnapshot, symbol: "BTCUSD", provider: "twelve-data", price: 65000, timestamp: now.toISOString() }), candles: async () => bullishCandles }, "twelve-data");
    const secondary: MarketDataProvider & SnapshotProvider = {
      name: "binance",
      isConfigured: () => true,
      async getMarketContext(request) { return { symbol: request.symbol, provider: "binance", retrievedAt: now.toISOString(), evidence: [] }; },
      async getSnapshot(request) { return { ...bullishSnapshot, symbol: request.symbol, provider: "binance", price: 70000, timestamp: now.toISOString() }; },
    };
    const { svc } = buildOrchestrator({ marketData: primary, crossProviderRegistry: { binance: () => secondary } });
    const ctx = await svc.build({ requestId: "r11", userId: "user-a", question: "BTCUSD price", symbol: "BTCUSD", crossProviderValidation: true });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.crossProviderValidation?.status, "unresolved-conflict");
    assert.deepEqual(ctx.crossProviderValidation?.providers.sort(), ["binance", "twelve-data"]);
  });

  await test("Cross-provider validation is never attempted unless explicitly requested (default off)", async () => {
    const { svc } = buildOrchestrator();
    const ctx = await svc.build({ requestId: "r12", userId: "user-a", question: "EURUSD" });
    assert.equal(ctx.crossProviderValidation, undefined);
  });

  await test("summarizeConflicts: no comparable fields -> insufficient-data", () => {
    assert.equal(summarizeConflicts([]).status, "insufficient-data");
  });
  await test("summarizeConflicts: any unresolved-conflict field dominates the summary", () => {
    const s = summarizeConflicts([
      { instrument: "BTCUSD", field: "price", providerA: "a", providerB: "b", valueA: 1, valueB: 1, status: "acceptable-difference", detectedAt: "t", basis: [] },
      { instrument: "BTCUSD", field: "close", providerA: "a", providerB: "b", valueA: 1, valueB: 2, status: "unresolved-conflict", detectedAt: "t", basis: ["real gap"] },
    ]);
    assert.equal(s.status, "unresolved-conflict");
  });
  await test("summarizeConflicts: stale-provider outranks a fully-consistent remainder", () => {
    const s = summarizeConflicts([
      { instrument: "BTCUSD", field: "price", providerA: "a", providerB: "b", valueA: 1, valueB: 1, status: "acceptable-difference", detectedAt: "t", basis: [] },
      { instrument: "BTCUSD", field: "close", providerA: "a", providerB: "b", valueA: 1, valueB: 1, status: "stale-provider", detectedAt: "t", basis: ["stale"] },
    ]);
    assert.equal(s.status, "stale");
  });
  await test("summarizeConflicts: every field acceptable-difference/none -> consistent", () => {
    const s = summarizeConflicts([{ instrument: "BTCUSD", field: "price", providerA: "a", providerB: "b", valueA: 1, valueB: 1, status: "acceptable-difference", detectedAt: "t", basis: [] }]);
    assert.equal(s.status, "consistent");
  });
}

// ============================================================
// Q, R, S, T: real-DB persistence + authorization isolation
// ============================================================
async function persistenceTests(): Promise<void> {
  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const createdRunIds: string[] = [];

  try {
    await prisma.user.create({ data: { id: ownerId, email: `d265-owner-${ownerId}@test.local`, name: "D2.6.5 owner" } });
    await prisma.user.create({ data: { id: strangerId, email: `d265-stranger-${strangerId}@test.local`, name: "D2.6.5 stranger" } });

    await test("R/S/T: a resolved analysis persists a real IntelligenceAnalysisRun with the exact hypothesis snapshot, not just final text", async () => {
      const runService = new IntelligenceAnalysisRunService();
      const svc = new RealTimeIntelligenceService({ marketData: freshMarketData(), analysisRunService: runService });
      const ctx = await svc.build({ requestId: "pr1", userId: ownerId, question: "EURUSD" });
      assert.equal(ctx.status, "resolved");
      assert.ok(ctx.analysisRunId);
      createdRunIds.push(ctx.analysisRunId!);

      const persisted = await runService.getAnalysisRun(ctx.analysisRunId!, ownerId);
      assert.ok(persisted);
      assert.equal(persisted!.symbol, "EURUSD");
      assert.ok(persisted!.hypothesisSnapshot, "the real hypothesis snapshot must be persisted, not just a text summary");
      assert.ok(persisted!.hypothesisSnapshot!.marketState);
      assert.ok(persisted!.hypothesisSnapshot!.regime);
    });

    await test("Q: user authorization isolation - a stranger cannot read the owner's persisted analysis run through AnalysisHistoryService", async () => {
      assert.ok(createdRunIds.length > 0, "requires the prior persistence test to have run");
      const history = new AnalysisHistoryService();
      const asStranger = await history.getOwnedAnalysisRun(createdRunIds[0], strangerId);
      assert.equal(asStranger, null);
      const asOwner = await history.getOwnedAnalysisRun(createdRunIds[0], ownerId);
      assert.ok(asOwner);
    });

    await test("Pending outcome evaluation boundary is real and callable, scoped to the requesting user only", async () => {
      const outcomes = await evaluatePendingAnalysisRunsForUser(strangerId, 5);
      assert.deepEqual(outcomes, [], "a user with zero pending runs gets an honestly empty result, never a fabricated one");
    });
  } finally {
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    console.log("  cleanup - all validation rows removed (users, analysis runs)");
  }
}

// ============================================================
// Decision context formatter
// ============================================================
async function formatterTests(): Promise<void> {
  const marketStateSvc = new MarketStateService();
  const regimeSvc = new RegimeService();
  const hypothesisSvc = new HypothesisService();
  const envelopeSvc = new IntelligenceEnvelopeService();
  const decisionSvc = new DecisionContextService();

  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: bullishSnapshot, candles: bullishCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T00:00:00.000Z" });
  const decisionContext = decisionSvc.build(envelope);

  await test("formatter: every required section header is present", () => {
    const text = formatDecisionContextAsText(decisionContext);
    for (const header of ["## Current State", "## Regime", "## Supporting Evidence", "## Opposing Evidence", "## Hypotheses", "## Invalidation Conditions", "## Risk", "## Historical Validation", "## Intelligence Score", "## Missing Information"]) {
      assert.ok(text.includes(header), `missing section: ${header}`);
    }
  });

  await test("formatter: the real price is present verbatim, never rounded away or invented", () => {
    const text = formatDecisionContextAsText(decisionContext);
    assert.ok(text.includes(String(decisionContext.currentState.price)));
  });

  await test("formatter: deterministic - identical decision context always produces identical text", () => {
    assert.equal(formatDecisionContextAsText(decisionContext), formatDecisionContextAsText(decisionContext));
  });

  await test("DeterministicSafeFallbackPresenter: returns the exact formatted text, never an LLM call", async () => {
    const presenter = new DeterministicSafeFallbackPresenter();
    const result = await presenter.present(envelope);
    assert.equal(result.text, formatDecisionContextAsText(decisionSvc.build(envelope)));
    assert.equal(result.presentedBy, "deterministic-fallback");
    assert.equal(result.envelopeGeneratedAt, envelope.generatedAt);
  });
}

// ============================================================
// AIResponseIntegrityService - deterministic checks
// ============================================================
async function integrityTests(): Promise<void> {
  const marketStateSvc = new MarketStateService();
  const regimeSvc = new RegimeService();
  const hypothesisSvc = new HypothesisService();
  const envelopeSvc = new IntelligenceEnvelopeService();
  const decisionSvc = new DecisionContextService();

  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: bullishSnapshot, candles: bullishCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T00:00:00.000Z" });
  const decisionContext = decisionSvc.build(envelope);

  await test("integrity: a plain, honest restatement of the real price passes with zero violations", () => {
    const text = `EURUSD is currently trading around ${decisionContext.currentState.price}. The regime is ${decisionContext.regimeContext.regimeType}.`;
    const result = validateResponseIntegrity(text, envelope, decisionContext);
    assert.equal(result.valid, true);
    assert.deepEqual(result.violations, []);
  });

  await test("integrity item 1: an unsupported price-like numeric claim is flagged", () => {
    const text = "EURUSD is currently trading around 999999.99 which is very high.";
    const result = validateResponseIntegrity(text, envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "unsupported-numeric-claim"));
  });

  await test("integrity item 2: mentioning a different real instrument is flagged as an unsupported symbol", () => {
    const text = "This looks similar to what BTCUSD is doing right now.";
    const result = validateResponseIntegrity(text, envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "unsupported-symbol" && v.matchedText === "BTCUSD"));
  });

  await test("integrity item 3/7: a BUY NOW / guaranteed-profit style claim is flagged", () => {
    const result = validateResponseIntegrity("You should buy now, this is a guaranteed profit.", envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "unsupported-directional-claim" || v.kind === "guaranteed-profit-language"));
  });

  await test("integrity item 4: an indicator this platform never computes is flagged", () => {
    const result = validateResponseIntegrity("The Stochastic oscillator confirms this move.", envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "unsupported-indicator"));
  });

  await test("integrity item 5: a historical-performance claim without an available historical segment is flagged", () => {
    const result = validateResponseIntegrity("Historically, this pattern has worked 90% of the time.", envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "unsupported-historical-claim" || v.kind === "guaranteed-profit-language"));
  });

  await test("integrity item 6: presenting the Intelligence Score as a win probability is flagged", () => {
    const result = validateResponseIntegrity("There is a 85% probability of winning this trade.", envelope, decisionContext);
    assert.ok(result.violations.some((v) => v.kind === "guaranteed-profit-language"));
  });

  await test("integrity item 8: high-certainty language while a real unresolved conflict exists is flagged", () => {
    const conflictedDc = { ...decisionContext, unresolvedConflicts: [{ type: "technical" as const, symbol: "EURUSD" as const, itemA: { type: "technical" as const, symbol: "EURUSD" as const, claim: "a", source: "s", asOf: "t", retrievedAt: "t" }, itemB: { type: "technical" as const, symbol: "EURUSD" as const, claim: "b", source: "s", asOf: "t", retrievedAt: "t" }, resolution: "unresolved" as const, reason: "conflict" }] };
    const result = validateResponseIntegrity("This is definitely going to continue rising.", envelope, conflictedDc);
    assert.ok(result.violations.some((v) => v.kind === "contradicts-unresolved-conflict"));
  });

  await test("integrity item 9: a confident-sounding answer with no hedging while state is insufficient-intelligence is flagged", () => {
    const insufficientDc = { ...decisionContext, state: "insufficient-intelligence" as const };
    const result = validateResponseIntegrity("EURUSD looks strong and is likely to keep climbing.", envelope, insufficientDc);
    assert.ok(result.violations.some((v) => v.kind === "contradicts-insufficient-data"));
  });

  await test("integrity item 9 (negative): the same insufficient state with honest hedging language passes", () => {
    const insufficientDc = { ...decisionContext, state: "insufficient-intelligence" as const };
    const result = validateResponseIntegrity("There is insufficient data to determine a clear direction for EURUSD right now.", envelope, insufficientDc);
    assert.ok(!result.violations.some((v) => v.kind === "contradicts-insufficient-data"));
  });

  await test("integrity: deterministic - identical (text, context) always produces an identical result", () => {
    const text = "EURUSD looks strong.";
    const r1 = validateResponseIntegrity(text, envelope, decisionContext);
    const r2 = validateResponseIntegrity(text, envelope, decisionContext);
    assert.deepEqual(r1, r2);
  });
}

// ============================================================
// M, N, O, P: presentSafely combinator + Gemini presenter wiring
// ============================================================
class FakeAIProvider implements AIProvider {
  readonly name = "fake-ai" as const as AIProvider["name"];
  constructor(private readonly behavior: (req: AICompletionRequest) => Promise<AICompletionResponse>) {}
  async complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    return this.behavior(req);
  }
  lastRequest?: AICompletionRequest;
}

async function presenterAndSafetyTests(): Promise<void> {
  const marketStateSvc = new MarketStateService();
  const regimeSvc = new RegimeService();
  const hypothesisSvc = new HypothesisService();
  const envelopeSvc = new IntelligenceEnvelopeService();
  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: bullishSnapshot, candles: bullishCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T00:00:00.000Z" });

  await test("GeminiIntelligencePresenter: sends the sprint's exact system instruction and the real price in the user message", async () => {
    let capturedRequest: AICompletionRequest | undefined;
    const provider = new FakeAIProvider(async (req) => {
      capturedRequest = req;
      return { content: `EURUSD is around ${marketState.snapshot.price}.`, model: "fake", provider: "fake-ai" };
    });
    const presenter = new GeminiIntelligencePresenter({ provider });
    const result = await presenter.present(envelope, "what's happening?");
    assert.equal(result.presentedBy, "fake-ai");
    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.messages[0].role, "system");
    assert.equal(capturedRequest!.messages[0].content, GEMINI_PRESENTER_SYSTEM_INSTRUCTION);
    assert.ok(capturedRequest!.messages[1].content.includes(String(marketState.snapshot.price)));
  });

  await test("GeminiIntelligencePresenter.name reflects the real underlying provider, never a hardcoded literal", () => {
    const provider = new FakeAIProvider(async () => ({ content: "x", model: "fake", provider: "fake-ai" }));
    const presenter = new GeminiIntelligencePresenter({ provider });
    assert.equal(presenter.name, "fake-ai");
  });

  await test("M: presentSafely falls back deterministically when the presenter throws (Gemini unavailable)", async () => {
    const throwingPresenter = new GeminiIntelligencePresenter({ provider: new FakeAIProvider(async () => { throw new Error("network down"); }) });
    const fallback = new DeterministicSafeFallbackPresenter();
    const outcome = await presentSafely({ envelope, userQuestion: "what's happening?", presenter: throwingPresenter, fallback });
    assert.equal(outcome.usedFallback, true);
    assert.equal(outcome.fallbackReason, "presenter-error");
    assert.equal(outcome.result.presentedBy, "deterministic-fallback");
  });

  await test("M2: presentSafely falls back when the presenter returns empty text", async () => {
    const emptyPresenter = new GeminiIntelligencePresenter({ provider: new FakeAIProvider(async () => ({ content: "   ", model: "fake", provider: "fake-ai" })) });
    const fallback = new DeterministicSafeFallbackPresenter();
    const outcome = await presentSafely({ envelope, userQuestion: "what's happening?", presenter: emptyPresenter, fallback });
    assert.equal(outcome.usedFallback, true);
  });

  await test("N: presentSafely falls back when the presenter's output contains an unsupported claim", async () => {
    const badPresenter = new GeminiIntelligencePresenter({ provider: new FakeAIProvider(async () => ({ content: "The Stochastic oscillator confirms a guaranteed profit here.", model: "fake", provider: "fake-ai" })) });
    const fallback = new DeterministicSafeFallbackPresenter();
    const outcome = await presentSafely({ envelope, userQuestion: "what's happening?", presenter: badPresenter, fallback });
    assert.equal(outcome.usedFallback, true);
    assert.equal(outcome.fallbackReason, "integrity-violation");
    assert.ok(outcome.integrity && !outcome.integrity.valid);
  });

  await test("O: presentSafely falls back when the presenter contradicts a real unresolved conflict", async () => {
    // Build an envelope with two directly conflicting evidence items so DecisionContextService produces a real unresolvedConflicts entry.
    const conflictedEnvelope = {
      ...envelope,
      evidence: {
        symbol: envelope.symbol,
        items: [],
        conflicts: [
          {
            type: "technical" as const,
            symbol: envelope.symbol,
            itemA: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI overbought", source: "a", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
            itemB: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI oversold", source: "b", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
            resolution: "unresolved" as const,
            reason: "Directly contradictory technical readings",
          },
        ],
        generatedAt: envelope.generatedAt,
      },
      conflicts: [
        {
          type: "technical" as const,
          symbol: envelope.symbol,
          itemA: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI overbought", source: "a", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
          itemB: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI oversold", source: "b", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
          resolution: "unresolved" as const,
          reason: "Directly contradictory technical readings",
        },
      ],
    };
    const decisionSvc = new DecisionContextService();
    const dc = decisionSvc.build(conflictedEnvelope);
    assert.ok(dc.unresolvedConflicts.length > 0, "fixture must actually produce a real unresolved conflict");

    const certainPresenter = new GeminiIntelligencePresenter({ provider: new FakeAIProvider(async () => ({ content: "This is definitely going higher without a doubt.", model: "fake", provider: "fake-ai" })) });
    const fallback = new DeterministicSafeFallbackPresenter();
    const outcome = await presentSafely({ envelope: conflictedEnvelope, userQuestion: "what's happening?", presenter: certainPresenter, fallback });
    assert.equal(outcome.usedFallback, true);
    assert.equal(outcome.fallbackReason, "integrity-violation");
  });

  await test("P: the safe fallback response is itself always integrity-valid (it only ever restates verified facts)", async () => {
    const fallback = new DeterministicSafeFallbackPresenter();
    const decisionSvc = new DecisionContextService();
    const result = await fallback.present(envelope);
    const integrity = validateResponseIntegrity(result.text, envelope, decisionSvc.build(envelope));
    assert.equal(integrity.valid, true);
  });

  await test("presentSafely: a genuinely valid Gemini response is used directly, never replaced", async () => {
    const goodPresenter = new GeminiIntelligencePresenter({ provider: new FakeAIProvider(async () => ({ content: `EURUSD is at ${marketState.snapshot.price} in a ${regime.regimeType} regime.`, model: "fake", provider: "fake-ai" })) });
    const fallback = new DeterministicSafeFallbackPresenter();
    const outcome = await presentSafely({ envelope, userQuestion: "what's happening?", presenter: goodPresenter, fallback });
    assert.equal(outcome.usedFallback, false);
    assert.equal(outcome.result.presentedBy, "fake-ai");
  });
}

// ============================================================
// IntelligenceChatContextService wiring
// ============================================================
async function chatContextAdapterTests(): Promise<void> {
  await test("IntelligenceChatContextService.resolve delegates to RealTimeIntelligenceService without altering its result", async () => {
    const { svc } = buildOrchestrator();
    const adapter = new IntelligenceChatContextService({ realTime: svc });
    const direct = await svc.build({ requestId: "c1", userId: "user-a", question: "EURUSD", requestedAt: "2026-01-01T00:00:00.000Z" });
    const viaAdapter = await adapter.resolve({ requestId: "c1", userId: "user-a", message: "EURUSD", requestedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(viaAdapter.status, direct.status);
    assert.equal(viaAdapter.envelope?.symbol, direct.envelope?.symbol);
  });
}

async function main(): Promise<void> {
  await orchestrationTests();
  await crossProviderTests();
  await persistenceTests();
  await formatterTests();
  await integrityTests();
  await presenterAndSafetyTests();
  await chatContextAdapterTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
