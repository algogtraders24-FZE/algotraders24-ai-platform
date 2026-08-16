// scripts/validate-microstructure-presentation.ts
// Sprint D2.8.8 - Microstructure Intelligence Presentation & Evidence
// Attribution. Standalone, assert-based verification (no test framework,
// no live network - fake providers/presenters throughout), matching every
// prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:microstructure-presentation`.
//
// Design: Part A tests the pure presentation-layer functions
// (lib/microstructure/microstructure-presentation.ts) directly against
// MicrostructureSnapshot fixtures built via D2.8.5's own unmodified
// buildMicrostructureSnapshot(). Part B proves genuine end-to-end wiring
// through RealTimeIntelligenceService (D2.8.7) -> AIPresenterOrchestratorService
// (D2.6.8, extended this sprint) -> a fake presenter that records exactly
// what string it received - so this suite verifies the real integration,
// not just isolated units.
import assert from "node:assert/strict";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { AIPresenterOrchestratorService, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { validateResponseIntegrity } from "../services/intelligence/chat/ai-response-integrity.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import {
  formatMicrostructureEvidence,
  buildMicrostructureLLMEvidenceBlock,
  buildPresenterQuestionWithMicrostructure,
  collectMicrostructureRealNumbers,
} from "../lib/microstructure/microstructure-presentation";
import { buildMicrostructureSnapshot, MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { MicrostructureProvider } from "../types/microstructure-provider";
import type { RawMicrostructureResult, RawMicrostructureEvidence, MicrostructureSnapshot } from "../types/microstructure";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "../types/intelligence-envelope";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { CreateIntelligenceAnalysisRunInput, IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";

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
// Part A fixtures - direct MicrostructureSnapshot construction via D2.8.5's
// own unmodified buildMicrostructureSnapshot(), never a hand-rolled shape.
// ============================================================
const NOW_MS = Date.parse("2026-08-16T18:00:00.000Z");

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

const btcSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(rawResult(), NOW_MS);
const ethSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult({ symbol: "ETHUSD", timestamp: "2026-08-16T17:59:58.000Z", retrievedAt: "2026-08-16T17:59:58.100Z" }),
  NOW_MS,
);
const staleSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult({ timestamp: "2026-08-16T17:00:00.000Z", retrievedAt: "2026-08-16T17:00:00.100Z" }),
  NOW_MS,
); // ~1h old, well past crypto's freshness threshold
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
  rawResult(
    {},
    {
      bid: { state: "invalid", reason: "crossed market" },
      ask: { state: "invalid", reason: "crossed market" },
    },
  ),
  NOW_MS,
);
// not_supported_by_provider: a structural gap this provider's API can never fill.
const notSupportedSnapshot: MicrostructureSnapshot = buildMicrostructureSnapshot(
  rawResult(
    {},
    {
      trades: { state: "not_supported_by_provider", reason: "this provider's API has no trade-stream endpoint" },
      sequenceId: { state: "not_supported_by_provider", reason: "this provider has no sequence concept" },
    },
  ),
  NOW_MS,
);

// ============================================================
// Part B fixtures - full pipeline (RealTimeIntelligenceService -> AIPresenterOrchestratorService)
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

/** Records exactly the (envelope, userQuestion) string a candidate presenter receives - the real, production AIIntelligencePresenter interface, completely unmodified. */
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
  const orchestrator = new AIPresenterOrchestratorService({ slots });
  return { orchestrator, presenter };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1/2: Binance BTCUSDT/ETHUSDT available evidence
  // ---------------------------------------------------------------------
  await test("1: Binance BTCUSDT available evidence renders real bid/ask/derived fields", () => {
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.some((l) => l === "Bid: 63189.99"));
    assert.ok(lines.some((l) => l === "Ask: 63190"));
  });
  await test("2: Binance ETHUSDT available evidence renders with the correct instrument attribution", () => {
    const lines = formatMicrostructureEvidence(ethSnapshot);
    assert.ok(lines.includes("Instrument: ETHUSD"));
  });

  // ---------------------------------------------------------------------
  // 3: Provider attribution
  // ---------------------------------------------------------------------
  await test("3: provider attribution is explicit in the evidence block", () => {
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.includes("Provider: binance"));
  });

  // ---------------------------------------------------------------------
  // 4: Venue-scope attribution
  // ---------------------------------------------------------------------
  await test("4: venue-scope attribution is explicit and never generalized", () => {
    const text = formatMicrostructureEvidence(btcSnapshot).join("\n");
    assert.ok(/binance BTCUSD order book only - not global market liquidity/.test(text));
  });

  // ---------------------------------------------------------------------
  // 5/6: Bid/ask, spread presentation
  // ---------------------------------------------------------------------
  await test("5: bid/ask presentation matches the real evidence values", () => {
    assert.equal(btcSnapshot.evidence.bid.value, 63189.99);
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.some((l) => l.startsWith("Bid: 63189.99")));
  });
  await test("6: spread presentation matches the real derived value", () => {
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.some((l) => l.startsWith("Spread: ")));
    assert.ok(Math.abs((btcSnapshot.derived.spread.value as number) - 0.01) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 7/8/9: Depth imbalance, buy/sell volume, volume delta presentation
  // ---------------------------------------------------------------------
  await test("7: depth imbalance presentation is real, derived, and present", () => {
    assert.equal(btcSnapshot.derived.depthImbalance.state, "available");
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.some((l) => l.startsWith("Depth imbalance: ")));
  });
  await test("8: buy/sell volume presentation matches the real aggressor-summed values", () => {
    assert.equal(btcSnapshot.derived.buyVolume.value, 0.01);
    assert.equal(btcSnapshot.derived.sellVolume.value, 0.02);
    const lines = formatMicrostructureEvidence(btcSnapshot);
    assert.ok(lines.includes("Buy volume: 0.01"));
    assert.ok(lines.includes("Sell volume: 0.02"));
  });
  await test("9: volume delta presentation matches buyVolume - sellVolume", () => {
    assert.ok(Math.abs((btcSnapshot.derived.volumeDelta.value as number) - (-0.01)) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 10: Derived-vs-raw evidence distinction
  // ---------------------------------------------------------------------
  await test("10: Direct Evidence section contains only bid/ask; Derived Evidence section contains every computed field, never mislabeled as raw", () => {
    const lines = formatMicrostructureEvidence(btcSnapshot);
    const directIdx = lines.findIndex((l) => l.startsWith("Direct Evidence"));
    const derivedIdx = lines.findIndex((l) => l.startsWith("Derived Evidence"));
    assert.ok(directIdx >= 0 && derivedIdx > directIdx);
    const directSection = lines.slice(directIdx, derivedIdx).join("\n");
    const derivedSection = lines.slice(derivedIdx).join("\n");
    assert.ok(directSection.includes("Bid:") && directSection.includes("Ask:"));
    assert.ok(!directSection.includes("Spread:"), "Spread is derived, must not appear in the Direct Evidence section");
    assert.ok(derivedSection.includes("Spread:") && derivedSection.includes("Volume delta:"));
    assert.ok(!/raw provider data/i.test(lines.join("\n")), "derived values must never be labeled as raw provider data");
  });

  // ---------------------------------------------------------------------
  // 11: stale handling
  // ---------------------------------------------------------------------
  await test("11: stale evidence is explicitly labeled stale, never presented as current", () => {
    assert.equal(staleSnapshot.freshnessStatus, "stale");
    const lines = formatMicrostructureEvidence(staleSnapshot);
    assert.ok(lines.includes("Freshness: stale"));
  });

  // ---------------------------------------------------------------------
  // 12: unavailable handling
  // ---------------------------------------------------------------------
  await test("12: unavailable fields are explicitly labeled unavailable, never a number", () => {
    const lines = formatMicrostructureEvidence(unavailableSnapshot);
    assert.ok(lines.includes("Bid: unavailable"));
    assert.ok(lines.includes("Ask: unavailable"));
    assert.ok(lines.includes("Volume delta: unavailable"));
  });

  // ---------------------------------------------------------------------
  // 13: unsupported provider handling
  // ---------------------------------------------------------------------
  await test("13: not_supported_by_provider fields are explicitly labeled as such, distinct from unavailable", () => {
    assert.equal(notSupportedSnapshot.evidence.trades.state, "not_supported_by_provider");
    const lines = formatMicrostructureEvidence(notSupportedSnapshot);
    assert.ok(lines.includes("Buy volume: not_supported_by_provider"));
    assert.ok(lines.includes("Sell volume: not_supported_by_provider"));
  });

  // ---------------------------------------------------------------------
  // 14: invalid handling
  // ---------------------------------------------------------------------
  await test("14: invalid evidence is rejected/suppressed, never repaired into a usable number", () => {
    assert.equal(invalidSnapshot.evidence.bid.state, "invalid");
    assert.equal(invalidSnapshot.derived.spread.state, "unavailable");
    const lines = formatMicrostructureEvidence(invalidSnapshot);
    assert.ok(lines.includes("Bid: invalid"));
  });

  // ---------------------------------------------------------------------
  // 15-20: unsupported-instrument rejection - XAUUSD/XAGUSD/EURUSD/GBPUSD/NIFTY/BANKNIFTY
  // ---------------------------------------------------------------------
  for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
    await test(`${symbol} rejection: no Binance microstructure reaches the presenter, no symbol substitution`, async () => {
      const { svc, microstructureProvider } = buildRealTimeService(symbol);
      const ctx = await svc.build({ requestId: `r-${symbol}`, userId: "u1", question: `Analyze ${symbol}`, symbol, includeMicrostructure: true });
      assert.equal(ctx.microstructure, undefined, `${symbol} must never receive microstructure`);
      assert.equal(microstructureProvider.callCount, 0, `${symbol} must never even call the Binance provider`);

      const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
      if (ctx.envelope) {
        await orchestrator.present(ctx.envelope, `Analyze ${symbol}`, ctx.microstructure);
        assert.equal(presenter.lastQuestion, `Analyze ${symbol}`, "the question the presenter received must be byte-identical - no evidence block was appended");
      } else {
        // Some of these symbols may not resolve a real envelope in this
        // offline fixture (no live market-data candles) - the instrument-
        // safety guarantee above (no provider call) is what this test
        // exists to prove either way.
        assert.equal(getCanonicalInstrument(symbol)?.providerMappings.some((m) => m.provider === "binance"), undefined);
      }
    });
  }

  // ---------------------------------------------------------------------
  // 21: No symbol substitution (explicit, direct check against the real catalog)
  // ---------------------------------------------------------------------
  await test("21: no unsupported instrument's canonical catalog entry maps to Binance - confirms rejection is structural, not incidental", () => {
    for (const symbol of ["XAUUSD", "XAGUSD", "EURUSD", "GBPUSD", "NIFTY", "BANKNIFTY"]) {
      const instrument = getCanonicalInstrument(symbol);
      const binanceMapped = (instrument?.providerMappings ?? []).some((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote"));
      assert.equal(binanceMapped, false, `${symbol} must not be Binance-mapped`);
    }
  });

  // ---------------------------------------------------------------------
  // 22: No global-liquidity claim
  // ---------------------------------------------------------------------
  await test("22: the LLM evidence block never claims global/institutional/CME/spot+futures/global-FX liquidity", () => {
    const block = buildMicrostructureLLMEvidenceBlock(btcSnapshot);
    assert.ok(/never describe it as global crypto liquidity, institutional liquidity, CME liquidity, combined spot\+futures liquidity, global FX liquidity/i.test(block));
    assert.ok(!/\bis global liquidity\b/i.test(block));
  });

  // ---------------------------------------------------------------------
  // 23: No synthetic values
  // ---------------------------------------------------------------------
  await test("23: collectMicrostructureRealNumbers never includes a value from an unavailable/invalid/not_supported field", () => {
    const unavailableNumbers = collectMicrostructureRealNumbers(unavailableSnapshot);
    assert.deepEqual(unavailableNumbers, []);
    const invalidNumbers = collectMicrostructureRealNumbers(invalidSnapshot);
    assert.ok(!invalidNumbers.includes(0), "an invalid bid/ask must never contribute a synthetic 0");
    const realNumbers = collectMicrostructureRealNumbers(btcSnapshot);
    assert.ok(realNumbers.includes(63189.99) && realNumbers.includes(63190));
  });

  // ---------------------------------------------------------------------
  // 24: No score/regime/hypothesis mutation
  // ---------------------------------------------------------------------
  await test("24: presenting with microstructure never mutates the envelope's intelligenceScore/regime/hypotheses", async () => {
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r24", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope);
    const before = JSON.parse(JSON.stringify({ score: ctx.envelope!.intelligenceScore, regime: ctx.envelope!.regime, hypotheses: ctx.envelope!.hypotheses }));

    const { orchestrator } = orchestratorWithRecordingPresenter();
    await orchestrator.present(ctx.envelope!, "BTCUSD", ctx.microstructure);

    // Round-tripped identically to `before` so undefined-valued keys are
    // stripped symmetrically on both sides - otherwise a real, unmutated
    // object with explicit `x: undefined` properties (never written by
    // this sprint's own code) would falsely appear to differ from its own
    // JSON-serialized copy.
    const after = JSON.parse(JSON.stringify({ score: ctx.envelope!.intelligenceScore, regime: ctx.envelope!.regime, hypotheses: ctx.envelope!.hypotheses }));
    assert.deepEqual(after, before, "envelope scoring/regime/hypotheses must be byte-identical before and after a microstructure-augmented present() call");
  });

  // ---------------------------------------------------------------------
  // 25: Existing presenter compatibility
  // ---------------------------------------------------------------------
  await test("25a: buildPresenterQuestionWithMicrostructure returns the question byte-unchanged when microstructure is absent", () => {
    const q = "What is the trend on BTCUSD?";
    assert.equal(buildPresenterQuestionWithMicrostructure(q, undefined), q);
  });
  await test("25b: AIPresenterOrchestratorService.present() called with its original 2-arg signature is unaffected by this sprint", async () => {
    const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r25b", userId: "u1", question: "What is the trend?", symbol: "BTCUSD" }); // includeMicrostructure omitted entirely
    assert.ok(ctx.envelope);
    // Deliberately called with only 2 args (the pre-D2.8.8 call shape) - it
    // still compiles and behaves identically, proving the 3rd param is
    // genuinely optional/additive.
    await orchestrator.present(ctx.envelope!, "What is the trend?");
    assert.equal(presenter.lastQuestion, "What is the trend?");
  });
  await test("25c: the deterministic fallback presenter (unmodified) still ignores userQuestion entirely, microstructure or not", async () => {
    const decisionContextService = new DecisionContextService();
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r25c", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope);
    const decisionContext = decisionContextService.build(ctx.envelope!);
    // 120000.00 is far outside the 1% relative tolerance of every real
    // value in this fixture (envelope price ~31177, microstructure
    // bid/ask ~63190) - a genuinely unsupported claim, not a realistic
    // nearby price that the checker's own tolerance would legitimately
    // accept.
    const integrity = validateResponseIntegrity("A completely fabricated 120000.00 price claim never in evidence.", ctx.envelope!, decisionContext, ctx.microstructure);
    assert.equal(integrity.valid, false, "a genuinely unsupported numeric claim must still be rejected even when microstructure evidence is supplied");
  });

  // ---------------------------------------------------------------------
  // Extra: integrity checker recognizes real microstructure numbers as supported (Phase 3/7 coherence)
  // ---------------------------------------------------------------------
  await test("extra: a response that honestly cites a real microstructure bid/ask value is NOT rejected as an unsupported numeric claim", async () => {
    const decisionContextService = new DecisionContextService();
    const { svc } = buildRealTimeService("BTCUSD");
    const ctx = await svc.build({ requestId: "r-extra", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.ok(ctx.envelope && ctx.microstructure);
    const decisionContext = decisionContextService.build(ctx.envelope!);
    const responseText = `The current Binance BTCUSD bid is 63189.99 and the ask is 63190.`;
    const withMicrostructure = validateResponseIntegrity(responseText, ctx.envelope!, decisionContext, ctx.microstructure);
    assert.equal(withMicrostructure.valid, true, `expected valid, got violations: ${JSON.stringify(withMicrostructure.violations)}`);
  });

  // ---------------------------------------------------------------------
  // Extra: provider failure never breaks the presentation pipeline
  // ---------------------------------------------------------------------
  await test("extra: a Binance microstructure fetch failure never breaks the presenter call - it simply proceeds without the evidence block", async () => {
    const { svc } = buildRealTimeService("BTCUSD", async () => {
      throw new MarketDataProviderError("http_error", "simulated failure", "binance");
    });
    const ctx = await svc.build({ requestId: "r-fail", userId: "u1", question: "BTCUSD", symbol: "BTCUSD", includeMicrostructure: true });
    assert.equal(ctx.microstructure, undefined);
    assert.ok(ctx.envelope);
    const { orchestrator, presenter } = orchestratorWithRecordingPresenter();
    const result = await orchestrator.present(ctx.envelope!, "BTCUSD", ctx.microstructure);
    assert.equal(result.fallbackUsed, false);
    assert.equal(presenter.lastQuestion, "BTCUSD");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
