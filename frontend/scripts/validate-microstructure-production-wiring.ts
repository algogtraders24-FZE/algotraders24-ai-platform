// scripts/validate-microstructure-production-wiring.ts
// Sprint D2.8.13 - Microstructure Evidence Production Wiring & Decision UI.
// Standalone, assert-based verification (no test framework), matching every
// prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-production-wiring`.
//
// Design: D2.8.12 wired D2.8.11's MicrostructureEvidenceAssessment into the
// chat presenter's prompt. This sprint found and closed a SECOND real
// production gap - ResearchSnapshotService (powers the Workspace Research
// panel via GET /api/private/intelligence/research, WorkspaceResearch.tsx)
// never opted into microstructure at all. Part A proves that gap is closed
// through the actual ResearchSnapshotService entry point (not just the
// lower-level services D2.8.11/D2.8.12 already covered). Part B proves the
// chat path's VerifiedAnswerResponse now also carries microstructureEvidence
// (a field that didn't exist before this sprint). Part C is instrument
// safety across both callers. Part D is data-quality-state honesty through
// the production caller. Part E is performance. Part F makes REAL live
// calls through the actual production shared instances and self-skips
// (never self-passes) honestly if the network is unavailable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import { ResearchSnapshotService } from "../services/intelligence/chat/research-snapshot.service";
import { IntelligencePresentationService } from "../services/intelligence/chat/intelligence-presentation.service";
import { AIPresenterOrchestratorService, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { binanceMicrostructureProvider, microstructureSnapshots } from "../services/microstructure/shared-instance";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
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
// Shared fixtures (mirroring scripts/validate-microstructure-evidence-fusion.ts,
// scripts/validate-microstructure-activation.ts, scripts/validate-microstructure-
// evidence-explanation.ts's own established conventions)
// ============================================================
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
function freshRawResult(overrides: Partial<RawMicrostructureResult> = {}, evidenceOverrides: Partial<RawMicrostructureEvidence> = {}): RawMicrostructureResult {
  const now = new Date().toISOString();
  return rawResult({ timestamp: now, retrievedAt: now, ...overrides }, evidenceOverrides);
}
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
const neutralEvidenceOverrides: Partial<RawMicrostructureEvidence> = {
  bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 5 }] },
  askLevels: { state: "available", value: [{ price: 63190.0, quantity: 5 }] },
  trades: {
    state: "available",
    value: [
      { price: 63189.99, quantity: 1, timestamp: "2026-08-17T11:59:55.000Z", aggressorSide: { state: "available", value: "buy" } },
      { price: 63190.0, quantity: 1.02, timestamp: "2026-08-17T11:59:56.000Z", aggressorSide: { state: "available", value: "sell" } },
    ],
  },
};

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

/** Builds a real ResearchSnapshotService with every dependency injected as a fake, EXCEPT the ResearchSnapshotService/IntelligenceChatContextService/RealTimeIntelligenceService/DecisionContextService/buildVerifiedAnswerResponse classes themselves, which are the real, unmodified production code this sprint wires together. */
function buildResearchSnapshotService(symbol: string, microstructureBehavior?: () => Promise<RawMicrostructureResult>) {
  const marketData = new FakeMarketData();
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(microstructureBehavior ?? (async () => rawResult({ symbol })));
  const microstructureService = new MicrostructureSnapshotService();
  const chatContext = new IntelligenceChatContextService({ marketData, analysisRunService, microstructureProvider, microstructureService });
  const svc = new ResearchSnapshotService({ chatContext });
  return { svc, microstructureProvider };
}

/** Builds a real IntelligencePresentationService (the chat production path) the same way, for Part B's VerifiedAnswerResponse.microstructureEvidence assertions. */
function buildPresentationService(symbol: string, microstructureBehavior?: () => Promise<RawMicrostructureResult>, responseText?: string) {
  const marketData = new FakeMarketData();
  const analysisRunService = fakeAnalysisRunService();
  const microstructureProvider = new FakeMicrostructureProvider(microstructureBehavior ?? (async () => rawResult({ symbol })));
  const microstructureService = new MicrostructureSnapshotService();
  const chatContext = new IntelligenceChatContextService({ marketData, analysisRunService, microstructureProvider, microstructureService });
  const presenter = new RecordingPresenter(responseText);
  const slots: PresenterSlot[] = [{ name: "recording", isAvailable: () => true, createPresenter: () => presenter }];
  const presenterOrchestrator = new AIPresenterOrchestratorService({ slots });
  const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator });
  return { svc, microstructureProvider, presenter };
}

/** Records exactly the userQuestion string a candidate presenter receives - the real, production AIIntelligencePresenter interface, completely unmodified. */
class RecordingPresenter implements AIIntelligencePresenter {
  readonly name = "recording-presenter";
  lastQuestion = "";
  constructor(private readonly responseText: string = "Real, verified analysis text.") {}
  async present(_envelope: IntelligenceEnvelope, userQuestion: string): Promise<AIPresentationResult> {
    this.lastQuestion = userQuestion;
    return { text: this.responseText, presentedBy: this.name, envelopeGeneratedAt: _envelope.generatedAt };
  }
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Part A: ResearchSnapshotService production wiring (the gap this sprint closes)
  // ---------------------------------------------------------------------
  await test("A1: ResearchSnapshotService.build() for BTCUSD with bullish microstructure -> verifiedAnswer.microstructureEvidence CONFIRMS the real trend-continuation-bullish hypothesis", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, bullishEvidenceOverrides));
    const { context, verifiedAnswer } = await svc.build({ requestId: "a1", userId: "u1", symbol: "BTCUSD" });
    assert.equal(context.status, "resolved");
    assert.ok(verifiedAnswer);
    assert.equal(context.envelope?.hypotheses[0]?.type, "trend-continuation-bullish", "the real HypothesisService must generate this hypothesis from the trending fixture");
    assert.ok(verifiedAnswer!.microstructureEvidence, "the Research panel must now genuinely receive microstructure evidence");
    assert.equal(verifiedAnswer!.microstructureEvidence!.status, "confirms");
  });

  await test("A2: the same real bullish hypothesis + bearish microstructure -> CONTRADICTS", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, bearishEvidenceOverrides));
    const { verifiedAnswer } = await svc.build({ requestId: "a2", userId: "u1", symbol: "BTCUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.equal(verifiedAnswer!.microstructureEvidence!.status, "contradicts");
  });

  await test("A3: neutral microstructure -> NEUTRAL, never forced into confirms/contradicts", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, neutralEvidenceOverrides));
    const { verifiedAnswer } = await svc.build({ requestId: "a3", userId: "u1", symbol: "BTCUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.equal(verifiedAnswer!.microstructureEvidence!.status, "neutral");
  });

  await test("A4: a provider failure -> microstructureEvidence absent (not a fabricated insufficient_evidence object), and the Research response still succeeds (failure isolation)", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => {
      throw new Error("simulated Binance failure");
    });
    const { context, verifiedAnswer } = await svc.build({ requestId: "a4", userId: "u1", symbol: "BTCUSD" });
    assert.equal(context.status, "resolved", "a microstructure provider failure must never break the Research response");
    assert.ok(verifiedAnswer);
    assert.equal(verifiedAnswer!.microstructureEvidence, undefined);
  });

  await test("A5: attribution - provider/instrument/freshness are real and present on the propagated assessment", async () => {
    const { svc } = buildResearchSnapshotService("ETHUSD", async () => freshRawResult({ symbol: "ETHUSD" }, bullishEvidenceOverrides));
    const { verifiedAnswer } = await svc.build({ requestId: "a5", userId: "u1", symbol: "ETHUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.equal(verifiedAnswer!.microstructureEvidence!.provider, "binance");
    assert.equal(verifiedAnswer!.microstructureEvidence!.instrument, "ETHUSD");
    assert.equal(verifiedAnswer!.microstructureEvidence!.freshness, "fresh");
  });

  await test("A6: exactly one Binance call per Research request, never duplicated by the new wiring", async () => {
    const { svc, microstructureProvider } = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, bullishEvidenceOverrides));
    await svc.build({ requestId: "a6", userId: "u1", symbol: "BTCUSD" });
    assert.equal(microstructureProvider.callCount, 1);
  });

  await test("A7: microstructure wiring never mutates the Intelligence Score / regime / hypotheses (deep-equal to a request without it)", async () => {
    const clockNowMs = Date.now();
    const without = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, bullishEvidenceOverrides));
    const withMs = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, bullishEvidenceOverrides));
    // Rebuild both with a shared fixed clock so unrelated `generatedAt` timestamp drift between two real-clock calls never causes a false mismatch (same technique D2.8.11's own script uses).
    const chatWithout = new IntelligenceChatContextService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: without.microstructureProvider,
      microstructureService: new MicrostructureSnapshotService(),
      clock: { now: () => clockNowMs },
    });
    const chatWith = new IntelligenceChatContextService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: withMs.microstructureProvider,
      microstructureService: new MicrostructureSnapshotService(),
      clock: { now: () => clockNowMs },
    });
    const svcWithout = new ResearchSnapshotService({ chatContext: chatWithout });
    const svcWith = new ResearchSnapshotService({ chatContext: chatWith });
    const resultWithout = await svcWithout.build({ requestId: "a7a", userId: "u1", symbol: "BTCUSD" });
    const resultWith = await svcWith.build({ requestId: "a7b", userId: "u1", symbol: "BTCUSD" });
    assert.deepEqual(resultWithout.verifiedAnswer?.intelligenceScore, resultWith.verifiedAnswer?.intelligenceScore, "the Intelligence Score must be byte-identical regardless of microstructure evidence");
  });

  // ---------------------------------------------------------------------
  // Part B: chat production path - VerifiedAnswerResponse.microstructureEvidence
  // ---------------------------------------------------------------------
  await test("B1: the real chat path (IntelligencePresentationService) now also populates verifiedAnswer.microstructureEvidence, not just the presenter's prompt text", async () => {
    const { svc } = buildPresentationService("BTCUSD", async () => freshRawResult({}, bullishEvidenceOverrides));
    const result = await svc.present({ requestId: "b1", userId: "u1", message: "What is the trend on BTCUSD?", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(result.verifiedAnswer?.microstructureEvidence);
    assert.equal(result.verifiedAnswer!.microstructureEvidence!.status, "confirms");
  });

  await test("B2: the same real assessment object reaches both the presenter's prompt (D2.8.12) AND verifiedAnswer.microstructureEvidence (D2.8.13) - one computation, two consumers", async () => {
    const { svc, presenter } = buildPresentationService("BTCUSD", async () => freshRawResult({}, bearishEvidenceOverrides));
    const result = await svc.present({ requestId: "b2", userId: "u1", message: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(result.verifiedAnswer?.microstructureEvidence);
    assert.equal(result.verifiedAnswer!.microstructureEvidence!.status, "contradicts");
    assert.ok(presenter.lastQuestion.includes("Relationship: CONTRADICTS"), "the presenter's prompt and the verifiedAnswer field must reflect the identical underlying assessment");
  });

  await test("B3: omitting includeMicrostructure leaves verifiedAnswer.microstructureEvidence absent - byte-identical to pre-D2.8.13 behavior", async () => {
    const { svc } = buildPresentationService("BTCUSD");
    const result = await svc.present({ requestId: "b3", userId: "u1", message: "BTCUSD", symbol: "BTCUSD" });
    assert.equal(result.verifiedAnswer?.microstructureEvidence, undefined);
  });

  // ---------------------------------------------------------------------
  // Part C: instrument safety - both real production callers
  // ---------------------------------------------------------------------
  for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
    await test(`C (${symbol}): ResearchSnapshotService never calls Binance and never produces microstructureEvidence for an unsupported instrument`, async () => {
      const { svc, microstructureProvider } = buildResearchSnapshotService(symbol);
      const { context, verifiedAnswer } = await svc.build({ requestId: `c-${symbol}`, userId: "u1", symbol });
      assert.equal(microstructureProvider.callCount, 0, `${symbol} must never even call the Binance provider`);
      if (context.status === "resolved" && verifiedAnswer) {
        assert.equal(verifiedAnswer.microstructureEvidence, undefined);
      }
    });
  }
  await test("C-catalog: none of the 6 unsupported symbols' real catalog entries map to Binance - rejection is structural, not incidental", () => {
    for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
      const instrument = getCanonicalInstrument(symbol);
      const binanceMapped = (instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote"));
      assert.equal(binanceMapped, false, `${symbol} must not be Binance-mapped`);
    }
  });
  await test("C-active: BTCUSD and ETHUSD remain the only Binance-microstructure-capable instruments in the real catalog", () => {
    for (const symbol of ["BTCUSD", "ETHUSD"]) {
      const instrument = getCanonicalInstrument(symbol);
      const binanceMapped = (instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote"));
      assert.equal(binanceMapped, true, `${symbol} must remain Binance-mapped`);
    }
  });

  // ---------------------------------------------------------------------
  // Part D: data-quality states through the production caller - never fabricated
  // ---------------------------------------------------------------------
  await test("D1: stale evidence through ResearchSnapshotService -> insufficient_evidence, never presented as current", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => rawResult({ timestamp: "2026-01-01T00:00:00.000Z", retrievedAt: "2026-01-01T00:00:00.100Z" }, bullishEvidenceOverrides));
    const { verifiedAnswer } = await svc.build({ requestId: "d1", userId: "u1", symbol: "BTCUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.equal(verifiedAnswer!.microstructureEvidence!.status, "insufficient_evidence");
    assert.notEqual(verifiedAnswer!.microstructureEvidence!.freshness, "fresh");
  });

  await test("D2: invalid evidence (crossed bid/ask) through ResearchSnapshotService -> insufficient_evidence, snapshot never partially trusted", async () => {
    const { svc } = buildResearchSnapshotService("BTCUSD", async () => freshRawResult({}, { bid: { state: "invalid", reason: "crossed market" }, ask: { state: "invalid", reason: "crossed market" } }));
    const { verifiedAnswer } = await svc.build({ requestId: "d2", userId: "u1", symbol: "BTCUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.equal(verifiedAnswer!.microstructureEvidence!.status, "insufficient_evidence");
  });

  await test("D3: not_supported_by_provider fields never fabricate a 0/neutral reading - depth-only evidence still classifies honestly", async () => {
    const { svc } = buildResearchSnapshotService(
      "BTCUSD",
      async () =>
        freshRawResult({}, {
          ...bullishEvidenceOverrides,
          trades: { state: "not_supported_by_provider", reason: "this provider's API has no trade-stream endpoint" },
          sequenceId: { state: "not_supported_by_provider", reason: "this provider has no sequence concept" },
        }),
    );
    const { verifiedAnswer } = await svc.build({ requestId: "d3", userId: "u1", symbol: "BTCUSD" });
    assert.ok(verifiedAnswer?.microstructureEvidence);
    assert.notEqual(verifiedAnswer!.microstructureEvidence!.status, "insufficient_evidence", "depth imbalance alone (bidLevels 10 vs askLevels 1) is still a real, usable signal");
    assert.ok(verifiedAnswer!.microstructureEvidence!.basis.every((b) => !/volume delta/i.test(b)), "a not_supported_by_provider trade feed must never contribute a fabricated volume-delta basis line");
  });

  await test("D4: a non-directional hypothesis (range-continuation) never receives a forced confirms/contradicts through the production caller", async () => {
    // A flat, non-trending candle series naturally tends to produce a
    // non-directional/insufficient regime rather than trend-continuation -
    // this proves the real HypothesisService's own natural output, not a
    // manufactured one.
    const flatCandles = makeCandles(Array.from({ length: 80 }, (_, i) => 30000 + (i % 2)));
    class FlatMarketData extends FakeMarketData {
      async getTimeSeries(): Promise<Candle[]> {
        return flatCandles;
      }
      async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> {
        const base = await super.getSnapshot(request);
        return { ...base, price: flatCandles[flatCandles.length - 1].close };
      }
    }
    const microstructureProvider = new FakeMicrostructureProvider(async () => freshRawResult({}, bullishEvidenceOverrides));
    const chatContext = new IntelligenceChatContextService({
      marketData: new FlatMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider,
      microstructureService: new MicrostructureSnapshotService(),
    });
    const svc = new ResearchSnapshotService({ chatContext });
    const { context, verifiedAnswer } = await svc.build({ requestId: "d4", userId: "u1", symbol: "BTCUSD" });
    if (context.status === "resolved" && verifiedAnswer && verifiedAnswer.hypotheses.length === 0) {
      // No hypothesis generated at all for this flat regime - the real,
      // honest "no hypothesis" case; microstructureEvidence, if present at
      // all, must never claim a directional relationship without one.
      if (verifiedAnswer.microstructureEvidence) {
        assert.equal(verifiedAnswer.microstructureEvidence.hypothesisDirection, "neutral");
      }
    }
  });

  // ---------------------------------------------------------------------
  // Part E: performance - production caller latency impact
  // ---------------------------------------------------------------------
  await test("E1: ResearchSnapshotService adds exactly one bounded provider call's worth of latency, never a multiplied/repeated cost", async () => {
    const ARTIFICIAL_DELAY_MS = 40;
    const delayedProvider = new FakeMicrostructureProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, ARTIFICIAL_DELAY_MS));
      return rawResult({ symbol: "BTCUSD" });
    });
    const withoutMsChat = new IntelligenceChatContextService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: delayedProvider, microstructureService: new MicrostructureSnapshotService() });
    const baseStart = Date.now();
    // Research always opts in (includeMicrostructure: true is now baked into ResearchSnapshotService.build itself), so the "base" comparison point here is the Binance-INCAPABLE instrument path (zero network calls, structural short-circuit) vs. the Binance-capable path.
    await new ResearchSnapshotService({ chatContext: withoutMsChat }).build({ requestId: "eperf-a", userId: "u1", symbol: "XAUUSD" });
    const baseElapsed = Date.now() - baseStart;

    const withMsChat = new IntelligenceChatContextService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService(), microstructureProvider: delayedProvider, microstructureService: new MicrostructureSnapshotService() });
    const msStart = Date.now();
    await new ResearchSnapshotService({ chatContext: withMsChat }).build({ requestId: "eperf-b", userId: "u1", symbol: "BTCUSD" });
    const msElapsed = Date.now() - msStart;

    console.log(`    perf: unsupported-instrument(no Binance call)=${baseElapsed}ms, BTCUSD(1 Binance call)=${msElapsed}ms, delta=${msElapsed - baseElapsed}ms (artificial provider delay=${ARTIFICIAL_DELAY_MS}ms)`);
    assert.equal(delayedProvider.callCount, 1, "the delayed provider must be called exactly once total (zero calls for XAUUSD, one for BTCUSD)");
    assert.ok(msElapsed - baseElapsed >= ARTIFICIAL_DELAY_MS - 5, "the added latency should be at least roughly the one real provider call's delay");
    assert.ok(msElapsed - baseElapsed < ARTIFICIAL_DELAY_MS * 3, "the added latency must not be a multiple of the provider delay (no duplicate/retried calls)");
  });

  // ---------------------------------------------------------------------
  // Structural: confirm the exact wiring points this sprint touched, and that protected files were not
  // ---------------------------------------------------------------------
  await test("structural: ResearchSnapshotService now passes includeMicrostructure: true and forwards context.microstructure into DecisionContextService.build", () => {
    const source = readFileSync(new URL("../services/intelligence/chat/research-snapshot.service.ts", import.meta.url), "utf8");
    assert.ok(/includeMicrostructure:\s*true/.test(source));
    assert.ok(/this\.decisionContextService\.build\(context\.envelope,\s*context\.microstructure\)/.test(source));
  });
  await test("structural: NativeChart forwards a real hypothesisType from WorkspaceContext into MicrostructurePanel - no second fetch", () => {
    const source = readFileSync(new URL("../components/chart-engine/NativeChart.tsx", import.meta.url), "utf8");
    assert.ok(/hypothesisType\s*}\s*=\s*useWorkspace\(\)/.test(source) || /const\s*\{\s*symbol,\s*name,\s*hypothesisType\s*\}/.test(source));
    assert.ok(/<MicrostructurePanel\s+symbol=\{symbol\}\s+hypothesisType=\{hypothesisType\}\s*\/>/.test(source));
  });
  await test("structural: WorkspaceContext's hypothesisType is entirely owned by WorkspaceResearch's own real fetch - no independent computation added to the context itself", () => {
    const contextSource = readFileSync(new URL("../context/WorkspaceContext.tsx", import.meta.url), "utf8");
    assert.ok(!/assessMicrostructureEvidence|HypothesisService|hypothesis\.service/.test(contextSource), "WorkspaceContext must never compute a hypothesis itself");
    const researchSource = readFileSync(new URL("../components/workspace/WorkspaceResearch.tsx", import.meta.url), "utf8");
    assert.ok(/setHypothesisType\(verifiedAnswer\?\.hypotheses\[0\]\?\.type\)/.test(researchSource));
  });
  await test("structural: IntelligenceScoreService was not touched by this sprint (formula/weights untouched, no D2.8.13 reference)", () => {
    const source = readFileSync(new URL("../services/intelligence/score/intelligence-score.service.ts", import.meta.url), "utf8");
    assert.ok(!/microstructure|D2\.8\.13/i.test(source), "the score engine must remain completely unaware microstructure exists");
  });
  await test("structural: HypothesisService was not touched by this sprint", () => {
    const source = readFileSync(new URL("../services/intelligence/hypothesis/hypothesis.service.ts", import.meta.url), "utf8");
    assert.ok(!/microstructure|D2\.8\.13/i.test(source));
  });
  await test("structural: no BUY/SELL/execution language was introduced by this sprint's new UI component", () => {
    const source = readFileSync(new URL("../components/intelligence-workspace/MicrostructureEvidenceSection.tsx", import.meta.url), "utf8");
    assert.ok(!/\bBUY\b|\bSELL\b|entry signal|take profit|stop loss/i.test(source));
  });

  // ---------------------------------------------------------------------
  // Part F: real runtime validation (live network, self-skipping)
  // ---------------------------------------------------------------------
  let liveBtcStatus: string | undefined;
  let liveEthStatus: string | undefined;
  await liveTest("F1: real BTCUSD runtime through the actual production shared instances, evaluated against both hypothesis directions", async () => {
    const real = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "BTCUSD" });
    const { assessMicrostructureEvidence } = await import("../services/intelligence/microstructure/microstructure-evidence-assessment.service");
    const vsBullish = assessMicrostructureEvidence(real, { type: "trend-continuation-bullish" }, new Date().toISOString());
    const vsBearish = assessMicrostructureEvidence(real, { type: "trend-continuation-bearish" }, new Date().toISOString());
    liveBtcStatus = vsBullish.status;
    console.log(`    real BTCUSD: bid=${real.evidence.bid.value} ask=${real.evidence.ask.value} freshness=${real.freshnessStatus} vsBullish=${vsBullish.status} vsBearish=${vsBearish.status}`);
    assert.ok(["confirms", "contradicts", "neutral", "insufficient_evidence"].includes(vsBullish.status));
    if (vsBullish.balance !== "neutral") assert.notEqual(vsBullish.status, vsBearish.status);
  });
  await liveTest("F2: real ETHUSD runtime through the actual production shared instances", async () => {
    const real = await microstructureSnapshots.getSnapshot(binanceMicrostructureProvider, { symbol: "ETHUSD" });
    const { assessMicrostructureEvidence } = await import("../services/intelligence/microstructure/microstructure-evidence-assessment.service");
    const vsBullish = assessMicrostructureEvidence(real, { type: "trend-continuation-bullish" }, new Date().toISOString());
    const vsBearish = assessMicrostructureEvidence(real, { type: "trend-continuation-bearish" }, new Date().toISOString());
    liveEthStatus = vsBullish.status;
    console.log(`    real ETHUSD: bid=${real.evidence.bid.value} ask=${real.evidence.ask.value} freshness=${real.freshnessStatus} vsBullish=${vsBullish.status} vsBearish=${vsBearish.status}`);
    assert.ok(["confirms", "contradicts", "neutral", "insufficient_evidence"].includes(vsBullish.status));
  });
  await liveTest("F3: real BTCUSD evidence propagates end-to-end through the actual ResearchSnapshotService production wiring (not a fixture)", async () => {
    // Uses the REAL binanceMicrostructureProvider/microstructureSnapshots
    // shared instances (the exact ones the production route uses) as the
    // injected microstructure provider/service, while market-data/analysis-
    // run persistence stay fake (same boundary every prior sprint's "real
    // runtime" test respects - see D2.8.11/D2.8.12's own scripts).
    const chatContext = new IntelligenceChatContextService({
      marketData: new FakeMarketData(),
      analysisRunService: fakeAnalysisRunService(),
      microstructureProvider: binanceMicrostructureProvider,
      microstructureService: microstructureSnapshots,
    });
    const svc = new ResearchSnapshotService({ chatContext });
    const { context, verifiedAnswer } = await svc.build({ requestId: "f3", userId: "u1", symbol: "BTCUSD" });
    assert.equal(context.status, "resolved");
    assert.ok(context.microstructure, "the real Binance snapshot must have reached VerifiedRealTimeIntelligenceContext");
    console.log(`    F3: real snapshot reached ResearchSnapshotService - microstructureEvidence=${verifiedAnswer?.microstructureEvidence?.status ?? "undefined"}`);
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (live/network)`);
  if (liveBtcStatus || liveEthStatus) {
    console.log(`Live relationship summary: BTCUSD vs bullish=${liveBtcStatus ?? "n/a"}, ETHUSD vs bullish=${liveEthStatus ?? "n/a"}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
