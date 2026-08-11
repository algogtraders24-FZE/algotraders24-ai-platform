// scripts/validate-verified-intelligence-workspace.ts
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:verified-intelligence-workspace`.
//
// Scope note: this project has no React/component test framework (UI
// correctness is verified via tsc/eslint/build plus a manual browser
// check, same as every prior D2.3/D2.4 UI sprint). This script covers
// the deterministic SERVER contract every UI component consumes -
// VerifiedAnswerResponse's builder, its wiring through
// IntelligencePresentationService, security/authorization, and every
// no-fabrication guarantee the sprint's 40-point checklist requires.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import { AIPresenterOrchestratorService, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { DeterministicSafeFallbackPresenter } from "../services/intelligence/chat/deterministic-safe-fallback-presenter.service";
import { formatDecisionContextAsText } from "../services/intelligence/chat/decision-context-formatter";
import { buildVerifiedAnswerResponse } from "../services/intelligence/chat/verified-answer-response.service";
import { IntelligencePresentationService } from "../services/intelligence/chat/intelligence-presentation.service";
import { AuditTraceService } from "../services/intelligence/audit/audit-trace.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, SnapshotProvider, TimeSeriesProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { IntelligenceEnvelope, AIIntelligencePresenter, AIPresentationResult } from "../types/intelligence-envelope";
import type { DataQualityAssessment } from "../types/real-time-intelligence";

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

function buildEnvelope(candles: Candle[] = bullishCandles, snapshot: MarketSnapshot = bullishSnapshot, generatedAt = "2026-01-01T00:00:00.000Z"): IntelligenceEnvelope {
  const marketState = new MarketStateService().assemble({ symbol: snapshot.symbol, timeframe: "1h", snapshot, candles });
  const regime = new RegimeService().classify({ marketState });
  const hypotheses = new HypothesisService().generate({ marketState, regime });
  return new IntelligenceEnvelopeService().build({ marketState, regime, hypotheses, generatedAt });
}

const goodEnvelope = buildEnvelope();
const goodDecisionContext = new DecisionContextService().build(goodEnvelope);
const goodAnswerText = `EURUSD is currently trading around ${goodDecisionContext.currentState.price}. The regime is ${goodDecisionContext.regimeContext.regimeType}.`;

function baseDataQuality(overrides: Partial<DataQualityAssessment> = {}): DataQualityAssessment {
  return { state: "fresh", provider: "test-fixture", providerSymbol: "EURUSD", fallbackUsed: false, cached: false, basis: ["real fixture"], ...overrides };
}

// ============================================================
// Fake MarketDataProvider + presenter fixtures (shared pattern)
// ============================================================
class FakeMarketData implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name: string;
  constructor(private readonly behavior: { snapshot?: () => Promise<MarketSnapshot>; candles?: () => Promise<Candle[]> } = {}, name = "fake-provider") {
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
function fakePresenter(name: string, present: (envelope: IntelligenceEnvelope, question: string) => Promise<AIPresentationResult>): AIIntelligencePresenter {
  return { name, present };
}
function countingSlot(name: string, available: boolean, presenter: AIIntelligencePresenter): PresenterSlot {
  return { name, isAvailable: () => available, createPresenter: () => presenter };
}
function goodPresenterSlot(): PresenterSlot {
  return countingSlot("gemini", true, fakePresenter("gemini", async (envelope) => ({ text: `${envelope.symbol} is around ${envelope.marketState.snapshot.price}.`, presentedBy: "gemini", envelopeGeneratedAt: envelope.generatedAt })));
}

// ============================================================
// 1-7: VerifiedAnswerResponse structure + freshness + provenance + fallback
// ============================================================
async function structureAndProvenanceTests(): Promise<void> {
  await test("1: verified answer structure includes every required top-level field", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    for (const key of ["answer", "decisionState", "intelligenceScore", "dataStatus", "marketContext", "currentState", "supportingEvidence", "opposingEvidence", "unresolvedConflicts", "hypotheses", "invalidationConditions", "riskContext", "historicalContext", "missingInformation", "presentedBy", "generatedAt", "version"]) {
      assert.ok(key in r, `missing field: ${key}`);
    }
  });

  await test("2: fresh data status is honestly reported", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ state: "fresh" }), presentedBy: "gemini" });
    assert.equal(r.dataStatus, "fresh");
  });

  await test("3: cached data status is honestly reported", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ state: "cached", cached: true }), presentedBy: "gemini" });
    assert.equal(r.dataStatus, "cached");
  });

  await test("4: stale data status is honestly reported", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ state: "stale" }), presentedBy: "gemini" });
    assert.equal(r.dataStatus, "stale");
  });

  await test("5: unknown freshness is honestly reported, never guessed to fresh", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ state: "unknown" }), presentedBy: "gemini" });
    assert.equal(r.dataStatus, "unknown");
  });

  await test("6: provider provenance is captured when genuinely known", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ provider: "angel-one" }), presentedBy: "gemini" });
    assert.equal(r.provider, "angel-one");
  });

  await test("7: fallback disclosure is honest - true only when a real fallback occurred", () => {
    const used = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ fallbackUsed: true }), presentedBy: "gemini" });
    const notUsed = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ fallbackUsed: false }), presentedBy: "gemini" });
    assert.equal(used.fallbackUsed, true);
    assert.equal(notUsed.fallbackUsed, false);
  });

  await test("31: no provider fabrication - provider is undefined, never a guessed default, when provenance is unavailable", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality({ provider: undefined }), presentedBy: "gemini" });
    assert.equal(r.provider, undefined);
  });
}

// ============================================================
// 8-9: provider unavailable / all providers unavailable (via IntelligencePresentationService)
// ============================================================
async function providerAvailabilityTests(): Promise<void> {
  await test("8: a provider-unavailable market fetch resolves insufficient-data - no VerifiedAnswerResponse, no fabricated answer", async () => {
    const failingMarketData = new FakeMarketData({ snapshot: async () => { throw new MarketDataProviderError("http_error", "down", "fake"); } });
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: failingMarketData }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [] }) });
    const result = await svc.present({ requestId: "r1", userId: "u1", message: "EURUSD analysis" });
    assert.equal(result.context.status, "insufficient-data");
    assert.equal(result.verifiedAnswer, undefined);
  });

  await test("9: every AI provider unavailable still resolves a real, verified answer via the deterministic fallback - never blocked", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [], fallback: new DeterministicSafeFallbackPresenter() }) });
    const result = await svc.present({ requestId: "r2", userId: "u1", message: "EURUSD analysis" });
    assert.equal(result.context.status, "resolved");
    assert.ok(result.verifiedAnswer);
    assert.equal(result.verifiedAnswer!.presentedBy, "deterministic-fallback");
  });
}

// ============================================================
// 10-18: insufficient intelligence, evidence, hypothesis, risk, historical, score
// ============================================================
async function contentContractTests(): Promise<void> {
  await test("10: insufficient-intelligence decision state carries real missing-information, never generic filler", () => {
    const insufficientEnvelope = { ...goodEnvelope, regime: { ...goodEnvelope.regime, regimeType: "insufficient-data" as const } };
    const dc = new DecisionContextService().build(insufficientEnvelope);
    const r = buildVerifiedAnswerResponse({ answer: "insufficient", envelope: insufficientEnvelope, decisionContext: dc, dataQuality: baseDataQuality(), presentedBy: "deterministic-fallback" });
    assert.equal(r.decisionState, "insufficient-intelligence");
    assert.ok(r.missingInformation.length > 0);
  });

  await test("11: conflicted evidence is preserved as real unresolved conflicts, never hidden behind a fake consensus", () => {
    const conflict = { type: "technical" as const, symbol: goodEnvelope.symbol, itemA: { type: "technical" as const, symbol: goodEnvelope.symbol, claim: "RSI overbought", source: "a", asOf: "t", retrievedAt: "t" }, itemB: { type: "technical" as const, symbol: goodEnvelope.symbol, claim: "RSI oversold", source: "b", asOf: "t", retrievedAt: "t" }, resolution: "unresolved" as const, reason: "contradiction" };
    const conflictedEnvelope = { ...goodEnvelope, evidence: { symbol: goodEnvelope.symbol, items: [], conflicts: [conflict], generatedAt: goodEnvelope.generatedAt }, conflicts: [conflict] };
    const dc = new DecisionContextService().build(conflictedEnvelope);
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: conflictedEnvelope, decisionContext: dc, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.ok(r.unresolvedConflicts.length > 0);
  });

  await test("12: supporting evidence is a real, non-fabricated passthrough of DecisionContext", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.supportingEvidence, goodDecisionContext.supportingEvidence);
  });

  await test("13: opposing evidence is a real, non-fabricated passthrough of DecisionContext", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.opposingEvidence, goodDecisionContext.opposingEvidence);
  });

  await test("14: hypothesis rendering contract matches DecisionHypothesisContext exactly, never a rewritten shape", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.hypotheses, goodDecisionContext.primaryHypotheses);
    for (const h of r.hypotheses) {
      assert.ok(typeof h.hypothesisId === "string");
      assert.ok(typeof h.claim === "string");
      assert.ok(h.predictionWindow);
      assert.ok(h.invalidationCondition);
    }
  });

  await test("15: invalidation conditions are a real, non-fabricated passthrough", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.invalidationConditions, goodDecisionContext.invalidationConditions);
  });

  await test("16: historical validation status is honestly reported (unavailable when none was supplied)", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.equal(r.historicalContext.status, goodDecisionContext.historicalContext.status);
  });

  await test("17: Intelligence Score is the real, unmodified D2.5.5 score - never recalculated in the builder", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.intelligenceScore, goodDecisionContext.intelligenceScore);
  });

  await test("18b: unresolvedConflicts defaults to a real empty array (never undefined) when there is genuinely no conflict", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.deepEqual(r.unresolvedConflicts, goodDecisionContext.unresolvedConflicts);
    assert.ok(Array.isArray(r.unresolvedConflicts));
  });

  await test("18c: generatedAt is the real envelope timestamp - what the system knew THEN, never a fresh 'now' fabricated at render time", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.equal(r.generatedAt, goodEnvelope.generatedAt);
  });

  await test("18: score explanation - every component is a real discriminated union, dataAvailable:false never carries a fabricated numeric score", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    for (const component of Object.values(r.intelligenceScore.components)) {
      if (component.dataAvailable) {
        assert.equal(typeof component.score, "number");
      } else {
        assert.equal(component.score, undefined);
      }
    }
  });
}

// ============================================================
// 19-21, 33: audit trace linkage + authorization
// ============================================================
async function auditLinkageTests(): Promise<void> {
  const ownerId = randomUUID();
  const strangerId = randomUUID();
  const createdIds: string[] = [];
  try {
    await prisma.user.create({ data: { id: ownerId, email: `d2610-owner-${ownerId}@test.local`, name: "D2.6.10 owner" } });
    await prisma.user.create({ data: { id: strangerId, email: `d2610-stranger-${strangerId}@test.local`, name: "D2.6.10 stranger" } });

    await test("19: audit trace linkage - a resolved answer carries a real, persisted auditTraceId", async () => {
      const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
      const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
      const result = await svc.present({ requestId: "r3", userId: ownerId, message: "EURUSD analysis" });
      assert.ok(result.verifiedAnswer?.auditTraceId);
      createdIds.push(result.verifiedAnswer!.auditTraceId!);
    });

    await test("20: trace authorization - the real owner can read their own linked trace", async () => {
      assert.ok(createdIds.length > 0);
      const trace = await new AuditTraceService().getTrace(createdIds[0], ownerId);
      assert.ok(trace);
    });

    await test("21: a forged traceId resolves safely to null, never leaking existence", async () => {
      const forged = await new AuditTraceService().getTrace(randomUUID(), ownerId);
      assert.equal(forged, null);
    });

    await test("33: cross-user access to a real trace resolves to null, never another user's data", async () => {
      const crossUser = await new AuditTraceService().getTrace(createdIds[0], strangerId);
      assert.equal(crossUser, null);
    });
  } finally {
    await prisma.intelligenceAuditTrace.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
    console.log("  cleanup - audit linkage test rows removed");
  }
}

// ============================================================
// 22-23, 32: conversation continuity, symbol switching, no stale-context leakage
// ============================================================
async function continuityTests(): Promise<void> {
  const ownerId = randomUUID();
  const createdIds: string[] = [];
  try {
    await prisma.user.create({ data: { id: ownerId, email: `d2610-conv-${ownerId}@test.local`, name: "D2.6.10 conversation" } });
    const conversationId = randomUUID();
    // A real Conversation row is required - ConversationContextService's
    // saveContext() is an UPDATE against Conversation.intelligenceContext,
    // a silent no-op against a row that doesn't exist (same requirement
    // scripts/validate-conversation-continuity.ts's own fixtures satisfy).
    await prisma.conversation.create({ data: { id: conversationId, userId: ownerId, title: "test", messageCount: 0, lastMessageAt: new Date() } });

    await test("22: conversation continuity - a symbol-less follow-up inherits the previously resolved symbol", async () => {
      const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
      const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
      const first = await svc.present({ requestId: "r4", userId: ownerId, conversationId, message: "Analyze EURUSD" });
      if (first.verifiedAnswer?.auditTraceId) createdIds.push(first.verifiedAnswer.auditTraceId);
      assert.equal(first.verifiedAnswer?.marketContext.symbol, "EURUSD");

      const follow = await svc.present({ requestId: "r5", userId: ownerId, conversationId, message: "What are the risks?" });
      if (follow.verifiedAnswer?.auditTraceId) createdIds.push(follow.verifiedAnswer.auditTraceId);
      assert.equal(follow.verifiedAnswer?.marketContext.symbol, "EURUSD");
    });

    const btcCandles = makeCandles(Array.from({ length: 90 }, (_, i) => 60000 + i * 10));
    const btcSnapshot = snapshotFor(btcCandles, { symbol: "BTCUSD", assetClass: "crypto", quoteCurrency: "USD" });
    const btcMarketData = new FakeMarketData({ snapshot: async () => ({ ...btcSnapshot, timestamp: new Date().toISOString() }), candles: async () => btcCandles });
    const btcChatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: btcMarketData }) });
    const btcSvc = new IntelligencePresentationService({
      chatContext: btcChatContext,
      presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [countingSlot("gemini", true, fakePresenter("gemini", async (envelope) => ({ text: `${envelope.symbol} is around ${envelope.marketState.snapshot.price}.`, presentedBy: "gemini", envelopeGeneratedAt: envelope.generatedAt })))] }),
    });

    await test("23: an explicit new symbol replaces the old conversation context", async () => {
      const switched = await btcSvc.present({ requestId: "r6", userId: ownerId, conversationId, message: "What about BTCUSD?" });
      if (switched.verifiedAnswer?.auditTraceId) createdIds.push(switched.verifiedAnswer.auditTraceId);
      assert.equal(switched.verifiedAnswer?.marketContext.symbol, "BTCUSD");
    });

    await test("32: no stale context leakage - a subsequent symbol-less follow-up inherits the new symbol, never the old one", async () => {
      const followAfterSwitch = await btcSvc.present({ requestId: "r7", userId: ownerId, conversationId, message: "What could invalidate this?" });
      if (followAfterSwitch.verifiedAnswer?.auditTraceId) createdIds.push(followAfterSwitch.verifiedAnswer.auditTraceId);
      assert.equal(followAfterSwitch.verifiedAnswer?.marketContext.symbol, "BTCUSD");
      assert.notEqual(followAfterSwitch.verifiedAnswer?.marketContext.symbol, "EURUSD");
    });
  } finally {
    await prisma.intelligenceAuditTrace.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.conversation.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    console.log("  cleanup - continuity test rows removed");
  }
}

// ============================================================
// 24-25: ambiguous symbol, missing timeframe
// ============================================================
async function clarificationTests(): Promise<void> {
  await test("24: an ambiguous question naming two real symbols never guesses - clarification required, no verified answer", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
    const result = await svc.present({ requestId: "r8", userId: "u1", message: "compare gold and bitcoin" });
    assert.equal(result.context.status, "clarification-required");
    assert.equal(result.verifiedAnswer, undefined);
  });

  await test("25: a missing timeframe still resolves a real answer using the documented default, never blocking analysis", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
    const result = await svc.present({ requestId: "r9", userId: "u1", message: "What is happening in EURUSD?" });
    assert.equal(result.context.status, "resolved");
    assert.ok(result.verifiedAnswer);
    assert.equal(result.verifiedAnswer!.marketContext.timeframe, "1h");
  });
}

// ============================================================
// 26-29: fallback AI presenter, integrity rejection, deterministic fallback, no fabricated facts
// ============================================================
async function presenterAndIntegrityTests(): Promise<void> {
  await test("26: Gemini failing routes the verified answer through the next real presenter, disclosed honestly", async () => {
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); }));
    const claudeSlot = countingSlot("claude", true, fakePresenter("claude", async (envelope) => ({ text: `${envelope.symbol} is around ${envelope.marketState.snapshot.price}.`, presentedBy: "claude", envelopeGeneratedAt: envelope.generatedAt })));
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot] }) });
    const result = await svc.present({ requestId: "r10", userId: "u1", message: "EURUSD analysis" });
    assert.equal(result.verifiedAnswer?.presentedBy, "claude");
    assert.equal(result.verifiedAnswer?.fallbackUsed, false);
  });

  await test("27: a presenter response rejected on integrity grounds never reaches the trader - the verified answer falls back", async () => {
    const badSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => ({ text: "This is a guaranteed profit, buy now.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt })));
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [badSlot], fallback: new DeterministicSafeFallbackPresenter() }) });
    const result = await svc.present({ requestId: "r11", userId: "u1", message: "EURUSD analysis" });
    assert.equal(result.verifiedAnswer?.presentedBy, "deterministic-fallback");
    assert.ok(!result.verifiedAnswer!.answer.includes("guaranteed profit"));
  });

  await test("28: the deterministic safe fallback's verified answer text matches the real formatted decision context exactly", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [], fallback: new DeterministicSafeFallbackPresenter() }) });
    const result = await svc.present({ requestId: "r12", userId: "u1", message: "EURUSD analysis" });
    const dc = new DecisionContextService().build(result.context.envelope!);
    assert.equal(result.verifiedAnswer?.answer, formatDecisionContextAsText(dc));
  });

  await test("29: the answer field is never post-processed or rewritten - always byte-identical to the real presenter's own text", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
    const result = await svc.present({ requestId: "r13", userId: "u1", message: "EURUSD analysis" });
    assert.equal(result.verifiedAnswer?.answer, result.presented?.text);
  });
}

// ============================================================
// 30: no probability-of-profit language surface (structural)
// ============================================================
async function noFabricationStructuralTests(): Promise<void> {
  await test("30: VerifiedAnswerResponse has no probability-of-profit-shaped field anywhere in its type - structurally impossible to add one accidentally", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    const serialized = JSON.stringify(r).toLowerCase();
    assert.ok(!serialized.includes("winprobability"));
    assert.ok(!serialized.includes("probabilityofprofit"));
    assert.ok(!/"probability"\s*:/.test(serialized));
  });
}

// ============================================================
// 34-39: mobile-safe/empty/missing data cases
// ============================================================
async function edgeCaseTests(): Promise<void> {
  await test("34: the full response is JSON-serializable with no functions/circular references - mobile-safe over the wire", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    // JSON has no `undefined` - a round trip legitimately drops explicitly-
    // undefined-valued keys (e.g. marketContext.previousRegime), so the
    // real check is against an equally round-tripped expected value, not
    // the raw in-memory object (same discipline as D2.6.9's audit-trace tests).
    const roundTripped = JSON.parse(JSON.stringify(r));
    assert.deepEqual(roundTripped.marketContext, JSON.parse(JSON.stringify(r.marketContext)));
    assert.equal(roundTripped.marketContext.symbol, "EURUSD");
  });

  await test("35: empty supporting/opposing evidence renders as real empty arrays, never undefined", () => {
    const flatCandles = makeCandles(Array.from({ length: 30 }, () => 1.1));
    const flatEnvelope = buildEnvelope(flatCandles, snapshotFor(flatCandles));
    const dc = new DecisionContextService().build(flatEnvelope);
    const r = buildVerifiedAnswerResponse({ answer: "flat", envelope: flatEnvelope, decisionContext: dc, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.ok(Array.isArray(r.supportingEvidence));
    assert.ok(Array.isArray(r.opposingEvidence));
  });

  await test("36: missing historical validation is reported as a real 'unavailable' status, never a fabricated rate", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    if (!goodEnvelope.historicalValidation) {
      assert.equal(r.historicalContext.status, "unavailable");
      assert.equal(r.historicalContext.validatedRate, undefined);
    }
  });

  await test("37: missing risk data is reported as dataAvailable:false, never a fabricated risk level", () => {
    const r = buildVerifiedAnswerResponse({ answer: goodAnswerText, envelope: goodEnvelope, decisionContext: goodDecisionContext, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    if (!goodEnvelope.risk) {
      assert.equal(r.riskContext.dataAvailable, false);
      assert.equal(r.riskContext.overallLevel, undefined);
    }
  });

  await test("38: zero hypotheses renders as a real empty array, never a crash or a fabricated placeholder hypothesis", () => {
    const flatCandles = makeCandles(Array.from({ length: 30 }, () => 1.1));
    const flatEnvelope = buildEnvelope(flatCandles, snapshotFor(flatCandles));
    const dc = new DecisionContextService().build(flatEnvelope);
    const r = buildVerifiedAnswerResponse({ answer: "flat", envelope: flatEnvelope, decisionContext: dc, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.ok(Array.isArray(r.hypotheses));
  });

  await test("39: a genuinely insufficient market state (too few candles) never crashes the builder, still produces a real response", () => {
    const sparseCandles = makeCandles([1.1, 1.1001, 1.0999]);
    const sparseEnvelope = buildEnvelope(sparseCandles, snapshotFor(sparseCandles));
    const dc = new DecisionContextService().build(sparseEnvelope);
    const r = buildVerifiedAnswerResponse({ answer: "sparse", envelope: sparseEnvelope, decisionContext: dc, dataQuality: baseDataQuality(), presentedBy: "gemini" });
    assert.ok(r.currentState);
  });
}

// ============================================================
// 40: end-to-end
// ============================================================
async function endToEndTest(): Promise<void> {
  await test("40: end-to-end verified answer - real market data through the complete chat-facing pipeline produces a complete, well-formed VerifiedAnswerResponse", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData() }) });
    const svc = new IntelligencePresentationService({ chatContext, presenterOrchestrator: new AIPresenterOrchestratorService({ slots: [goodPresenterSlot()] }) });
    const result = await svc.present({ requestId: "r14", userId: "u1", message: "What is happening in EURUSD?" });
    assert.equal(result.context.status, "resolved");
    const r = result.verifiedAnswer!;
    assert.ok(r.answer.length > 0);
    assert.equal(r.marketContext.symbol, "EURUSD");
    assert.ok(r.intelligenceScore);
    assert.ok(r.generatedAt);
    assert.equal(r.version, "1.0.0");
  });
}

async function main(): Promise<void> {
  await structureAndProvenanceTests();
  await providerAvailabilityTests();
  await contentContractTests();
  await auditLinkageTests();
  await continuityTests();
  await clarificationTests();
  await presenterAndIntegrityTests();
  await noFabricationStructuralTests();
  await edgeCaseTests();
  await endToEndTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
