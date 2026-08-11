// scripts/validate-conversation-continuity.ts
// Sprint D2.6.7 - Conversation Continuity & Verified Market Context
// Memory. Standalone, assert-based verification (no test framework, no
// live network - fake market-data providers throughout), matching every
// prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:conversation-continuity`.
//
// Design: real Prisma-backed User/Conversation/Message/IntelligenceAnalysisRun
// rows are used for persistence/authorization/analysis-linking proof
// (self-cleaning, same pattern as every DB-touching validate-*.ts script
// this session) - only the market-data seam is faked. This proves genuine
// end-to-end wiring: real conversation rows, real ConversationContextService
// queries, real RealTimeIntelligenceService/IntelligenceChatContextService
// orchestration, against fake market data so freshness/replacement
// behavior is fully controllable and deterministic.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { ConversationContextService, deriveNextContext } from "../services/intelligence/chat/conversation-context.service";
import { CONVERSATION_CONTEXT_VERSION } from "../types/conversation-context";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import { IntelligenceAnalysisRunService, type CreateIntelligenceAnalysisRunInput } from "../services/intelligence/memory/analysis-run.service";
import { resolveSymbol } from "../services/intelligence/query/intelligence-query.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import type { MarketDataProvider, SnapshotProvider, TimeSeriesProvider, MarketContextRequest } from "../types/market-data-provider";
import type { TimeSeriesRequest } from "../types/market-candle";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
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
// Fixtures
// ============================================================
function makeCandles(closesArr: number[]): Candle[] {
  return closesArr.map((close, i) => {
    const range = 0.0015 * close;
    return { datetime: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), open: close - range / 3, high: close + range / 2, low: close - range / 2, close, volume: 1000 + i };
  });
}
function trendingBullish(base: number): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(base + i * (base * 0.0015));
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - base * 0.0005 + (i % 3) * (base * 0.0001));
  return [...rise, ...plateau];
}
const niftyCandles = makeCandles(trendingBullish(24000));
const bankNiftyCandles = makeCandles(trendingBullish(51000));
const btcCandles = makeCandles(trendingBullish(65000));

function snapshotFor(symbol: string, candles: Candle[], overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol,
    assetClass: symbol === "BTCUSD" ? "crypto" : "indices",
    price: last.close,
    quoteCurrency: symbol === "BTCUSD" ? "USD" : "INR",
    timestamp: new Date().toISOString(),
    timezone: symbol === "BTCUSD" ? "UTC" : "Asia/Kolkata",
    marketStatus: "unknown",
    provider: "fake-provider",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Stateful across calls (mutable `behavior`) so a single instance can prove "the second call returns genuinely different, fresh data" rather than replaying the first call's fixture. */
class FakeMarketData implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name = "fake-provider";
  behavior: { snapshot: (symbol: string) => Promise<MarketSnapshot>; candles: (symbol: string) => Promise<Candle[]> };
  constructor(behavior?: Partial<typeof this.behavior>) {
    this.behavior = {
      snapshot: behavior?.snapshot ?? (async (symbol) => snapshotFor(symbol, symbol === "BANKNIFTY" ? bankNiftyCandles : symbol === "BTCUSD" ? btcCandles : niftyCandles)),
      candles: behavior?.candles ?? (async (symbol) => (symbol === "BANKNIFTY" ? bankNiftyCandles : symbol === "BTCUSD" ? btcCandles : niftyCandles)),
    };
  }
  isConfigured(): boolean { return true; }
  async getMarketContext(request: MarketContextRequest) { return { symbol: request.symbol, provider: this.name, retrievedAt: new Date().toISOString(), evidence: [] }; }
  async getSnapshot(request: MarketContextRequest): Promise<MarketSnapshot> { return this.behavior.snapshot(request.symbol); }
  async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> { return this.behavior.candles(request.symbol); }
}

function fakeAnalysisRunService(): IntelligenceAnalysisRunService & { created: CreateIntelligenceAnalysisRunInput[] } {
  const created: CreateIntelligenceAnalysisRunInput[] = [];
  let n = 0;
  return {
    created,
    async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
      created.push(input);
      n += 1;
      return { id: `fake-run-${n}`, userId: input.userId, symbol: input.symbol, timeframe: input.timeframe, pipelineVersion: input.analysisResult?.metadata.pipelineVersion ?? null, analysisResult: input.analysisResult, regimeAtTime: null, hypothesisSnapshot: input.hypothesisSnapshot ?? null, evaluationStatus: "pending", createdAt: new Date().toISOString() };
    },
    async getAnalysisRun() { return null; },
    async listPendingEvaluationRuns() { return []; },
    async markEvaluated() { return null; },
  } as unknown as IntelligenceAnalysisRunService & { created: CreateIntelligenceAnalysisRunInput[] };
}

async function createTestUser(): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `d267-${id}@test.local`, name: "D2.6.7 test user" } });
  return id;
}
async function createTestConversation(userId: string): Promise<string> {
  const row = await prisma.conversation.create({ data: { userId, title: "D2.6.7 test conversation", messageCount: 0, lastMessageAt: new Date() } });
  return row.id;
}

// ============================================================
// Persistence
// ============================================================
async function persistenceTests(): Promise<void> {
  const userId = await createTestUser();
  const conversationId = await createTestConversation(userId);
  const svc = new ConversationContextService();

  try {
    await test("Persistence: conversation creation produces a real row with no context yet", async () => {
      const ctx = await svc.getContext(conversationId, userId);
      assert.equal(ctx, null);
    });

    await test("Persistence: context persistence - saveContext then getContext round-trips", async () => {
      const next = deriveNextContext(conversationId, userId, { symbol: "NIFTY50", timeframe: "1h" }, Date.now());
      await svc.saveContext(next);
      const loaded = await svc.getContext(conversationId, userId);
      assert.equal(loaded?.activeSymbol, "NIFTY50");
      assert.equal(loaded?.activeTimeframe, "1h");
    });

    await test("Persistence: context update - a second save overwrites, get returns the latest", async () => {
      const next = deriveNextContext(conversationId, userId, { symbol: "BANKNIFTY", timeframe: "15m" }, Date.now());
      await svc.saveContext(next);
      const loaded = await svc.getContext(conversationId, userId);
      assert.equal(loaded?.activeSymbol, "BANKNIFTY");
      assert.equal(loaded?.activeTimeframe, "15m");
    });

    await test("Persistence: context version - a mismatched contextVersion is honestly discarded, never misread", async () => {
      await prisma.conversation.updateMany({ where: { id: conversationId, userId }, data: { intelligenceContext: { ...deriveNextContext(conversationId, userId, { symbol: "NIFTY50" }, Date.now()), contextVersion: "999.0.0" } as object } });
      const loaded = await svc.getContext(conversationId, userId);
      assert.equal(loaded, null);
    });

    await test("Persistence: message linking - context and messages share the same real conversationId", async () => {
      await prisma.message.create({ data: { conversationId, userId, role: "user", content: "Analyze NIFTY." } });
      const next = deriveNextContext(conversationId, userId, { symbol: "NIFTY50", analysisRunId: "run-1" }, Date.now());
      await svc.saveContext(next);
      const [messages, loaded] = await Promise.all([
        prisma.message.findMany({ where: { conversationId, userId } }),
        svc.getContext(conversationId, userId),
      ]);
      assert.ok(messages.length > 0);
      assert.equal(messages[0].conversationId, conversationId);
      assert.equal(loaded?.conversationId, conversationId);
    });

    await test("deriveNextContext: contextVersion/conversationId/userId/updatedAt are always real, never omitted", () => {
      const next = deriveNextContext(conversationId, userId, { symbol: "NIFTY50" }, 1_700_000_000_000);
      assert.equal(next.contextVersion, CONVERSATION_CONTEXT_VERSION);
      assert.equal(next.conversationId, conversationId);
      assert.equal(next.userId, userId);
      assert.equal(next.updatedAt, new Date(1_700_000_000_000).toISOString());
    });
  } finally {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

// ============================================================
// Resolution (pure, no DB - direct RealTimeIntelligenceService.build())
// ============================================================
async function resolutionTests(): Promise<void> {
  function svc(marketData = new FakeMarketData()) {
    return new RealTimeIntelligenceService({ marketData, analysisRunService: fakeAnalysisRunService() });
  }

  await test("Resolution: explicit symbol overrides a persisted previous symbol", async () => {
    const ctx = await svc().build({ requestId: "r1", userId: "u", question: "Analyze BANKNIFTY.", conversationContext: { activeSymbol: "NIFTY50" } });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.symbol, "BANKNIFTY");
  });

  await test("Resolution: previous symbol is inherited when the question has none", async () => {
    const ctx = await svc().build({ requestId: "r2", userId: "u", question: "What are the risks?", conversationContext: { activeSymbol: "NIFTY50" } });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.symbol, "NIFTY50");
  });

  await test("Resolution: explicit timeframe overrides a persisted previous timeframe", async () => {
    const ctx = await svc().build({ requestId: "r3", userId: "u", question: "Analyze NIFTY on the daily timeframe.", conversationContext: { activeSymbol: "NIFTY50", activeTimeframe: "5m" } });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.query.timeframe, "1d");
  });

  await test("Resolution: previous timeframe is inherited when the question has none", async () => {
    const ctx = await svc().build({ requestId: "r4", userId: "u", question: "What are the risks?", conversationContext: { activeSymbol: "NIFTY50", activeTimeframe: "15m" } });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.query.timeframe, "15m");
  });

  await test("Resolution: exchange/market are real, catalog-derived facts for the resolved symbol", () => {
    const instrument = getCanonicalInstrument("NIFTY50");
    assert.equal(instrument?.exchange, "NSE");
    assert.equal(instrument?.marketCategory, "indices");
  });

  await test("Resolution: unresolved symbol with no context and no explicit mention returns clarification-required", async () => {
    const ctx = await svc().build({ requestId: "r5", userId: "u", question: "how do I use this platform" });
    assert.equal(ctx.status, "clarification-required");
    assert.equal(ctx.clarification?.reason, "unresolved-symbol");
  });

  await test("Resolution: ambiguous symbol (two real symbols in one message) is never resolved by guessing, even with a persisted context present", async () => {
    const ctx = await svc().build({ requestId: "r6", userId: "u", question: "compare nifty and banknifty", conversationContext: { activeSymbol: "RELIANCE" } });
    assert.equal(ctx.status, "clarification-required");
    assert.equal(ctx.clarification?.reason, "ambiguous-symbol");
  });

  await test("Resolution: unresolved timeframe uses the documented default for computation but query.timeframe stays honestly undefined", async () => {
    const ctx = await svc().build({ requestId: "r7", userId: "u", question: "Analyze NIFTY." });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.query.timeframe, undefined);
  });
}

// ============================================================
// Follow-up language (deterministic, no LLM reference resolution)
// ============================================================
async function followUpTests(): Promise<void> {
  function svc() {
    return new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService() });
  }
  const context = { activeSymbol: "NIFTY50" as const, activeTimeframe: "1h" as const };

  for (const [label, question] of [
    ["it", "What would invalidate it?"],
    ["this", "Tell me more about this."],
    ["that", "Is that still valid?"],
    ["same setup", "Is the same setup still there?"],
    ["previous analysis", "What did the previous analysis say?"],
    ["this hypothesis", "What would invalidate this hypothesis?"],
    ["risk follow-up", "What are the risks?"],
    ["invalidation follow-up", "What could invalidate this?"],
  ] as const) {
    await test(`Follow-up: "${label}" resolves against the persisted symbol deterministically, never via LLM guessing`, async () => {
      const ctx = await svc().build({ requestId: `f-${label}`, userId: "u", question, conversationContext: context });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "NIFTY50");
    });
  }

  await test("Follow-up: invalidation-style question classifies as hypothesis/invalidation scope (D2.6.2, reused unmodified)", async () => {
    const ctx = await svc().build({ requestId: "f-cls", userId: "u", question: "What could invalidate this?", conversationContext: context });
    assert.equal(ctx.query.queryType, "hypothesis");
    assert.ok(ctx.query.requestedScopes.includes("invalidation"));
  });
}

// ============================================================
// Analysis-run + hypothesis linking (real DB persistence)
// ============================================================
async function analysisLinkingTests(): Promise<void> {
  const userId = await createTestUser();
  const conversationId = await createTestConversation(userId);
  const runService = new IntelligenceAnalysisRunService();

  try {
    await test("Analysis linking: a resolved turn persists a real IntelligenceAnalysisRun referenced by the saved context", async () => {
      const chatSvc = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: runService }) });
      const ctx = await chatSvc.resolve({ requestId: "a1", userId, message: "Analyze NIFTY.", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.ok(ctx.analysisRunId);

      const persisted = await new ConversationContextService().getContext(conversationId, userId);
      assert.equal(persisted?.lastAnalysisRunId, ctx.analysisRunId);

      const run = await runService.getAnalysisRun(ctx.analysisRunId!, userId);
      assert.ok(run);
      assert.equal(run!.symbol, "NIFTY50");
    });

    await test("Analysis linking: hypothesis ids from the resolved envelope are persisted for 'this hypothesis' reference", async () => {
      const persisted = await new ConversationContextService().getContext(conversationId, userId);
      assert.ok(Array.isArray(persisted?.lastHypothesisIds));
    });

    await test("Analysis linking: a fresh follow-up turn produces a NEW, distinct analysis run - never reuses the old one as current", async () => {
      const before = await new ConversationContextService().getContext(conversationId, userId);
      const chatSvc = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: runService }) });
      const ctx = await chatSvc.resolve({ requestId: "a2", userId, message: "What are the risks?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.notEqual(ctx.analysisRunId, before?.lastAnalysisRunId);
    });
  } finally {
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { userId } });
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

// ============================================================
// Freshness - conversation memory is context, never current market fact
// ============================================================
async function freshnessTests(): Promise<void> {
  await test("Freshness: current price always comes from a fresh provider request, never from conversation history", async () => {
    let callCount = 0;
    const marketData = new FakeMarketData({
      snapshot: async (symbol) => {
        callCount += 1;
        return snapshotFor(symbol, niftyCandles, { price: callCount === 1 ? 24150 : 24999 });
      },
    });
    const svc = new RealTimeIntelligenceService({ marketData, analysisRunService: fakeAnalysisRunService() });
    const first = await svc.build({ requestId: "fr1", userId: "u", question: "Analyze NIFTY." });
    const second = await svc.build({ requestId: "fr2", userId: "u", question: "What is the current situation?", conversationContext: { activeSymbol: "NIFTY50" } });
    assert.equal(first.envelope?.marketState.snapshot.price, 24150);
    assert.equal(second.envelope?.marketState.snapshot.price, 24999, "the second call must reflect the NEW fetch, never the first call's cached price");
    assert.equal(callCount, 2, "a fresh provider request must happen on every call, never skipped because context exists");
  });

  await test("Freshness: old price is never reused even when persisted context supplies the symbol", async () => {
    const prices = [24150, 24800, 25200];
    let i = 0;
    const marketData = new FakeMarketData({ snapshot: async (symbol) => snapshotFor(symbol, niftyCandles, { price: prices[Math.min(i++, prices.length - 1)] }) });
    const svc = new RealTimeIntelligenceService({ marketData, analysisRunService: fakeAnalysisRunService() });
    const results: number[] = [];
    for (let n = 0; n < 3; n++) {
      const ctx = await svc.build({ requestId: `op-${n}`, userId: "u", question: n === 0 ? "Analyze NIFTY." : "What's the current price?", conversationContext: n === 0 ? undefined : { activeSymbol: "NIFTY50" } });
      results.push(ctx.envelope!.marketState.snapshot.price);
    }
    assert.deepEqual(results, prices);
  });

  await test("Freshness: stale data is still honestly reported even on a context-inherited follow-up", async () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const marketData = new FakeMarketData({ snapshot: async (symbol) => snapshotFor(symbol, niftyCandles, { timestamp: stale }) });
    const svc = new RealTimeIntelligenceService({ marketData, analysisRunService: fakeAnalysisRunService() });
    const ctx = await svc.build({ requestId: "fr3", userId: "u", question: "What are the risks?", conversationContext: { activeSymbol: "NIFTY50" } });
    assert.equal(ctx.dataQuality?.state, "stale");
  });

  await test("Freshness: provider failure on a follow-up returns insufficient-data, never the last known snapshot", async () => {
    const marketData = new FakeMarketData({ snapshot: async () => { throw new MarketDataProviderError("http_error", "down", "fake-provider"); } });
    const svc = new RealTimeIntelligenceService({ marketData, analysisRunService: fakeAnalysisRunService() });
    const ctx = await svc.build({ requestId: "fr4", userId: "u", question: "What is the current situation?", conversationContext: { activeSymbol: "NIFTY50" } });
    assert.equal(ctx.status, "insufficient-data");
  });
}

// ============================================================
// Security / authorization
// ============================================================
async function securityTests(): Promise<void> {
  const ownerId = await createTestUser();
  const strangerId = await createTestUser();
  const conversationId = await createTestConversation(ownerId);
  const svc = new ConversationContextService();

  try {
    await svc.saveContext(deriveNextContext(conversationId, ownerId, { symbol: "NIFTY50" }, Date.now()));

    await test("Security: the owning user can read their own conversation context", async () => {
      const ctx = await svc.getContext(conversationId, ownerId);
      assert.equal(ctx?.activeSymbol, "NIFTY50");
    });

    await test("Security: a different real user cannot read the owner's conversation context", async () => {
      const ctx = await svc.getContext(conversationId, strangerId);
      assert.equal(ctx, null);
    });

    await test("Security: a forged/nonexistent conversation id returns null, never throws or leaks existence", async () => {
      const ctx = await svc.getContext(randomUUID(), ownerId);
      assert.equal(ctx, null);
    });

    await test("Security: an empty userId never matches a real row", async () => {
      const ctx = await svc.getContext(conversationId, "");
      assert.equal(ctx, null);
    });

    await test("Security: a stranger's saveContext call is a scoped no-op, never overwrites the owner's real context", async () => {
      await svc.saveContext(deriveNextContext(conversationId, strangerId, { symbol: "BANKNIFTY" }, Date.now()));
      const ownerCtx = await svc.getContext(conversationId, ownerId);
      assert.equal(ownerCtx?.activeSymbol, "NIFTY50", "the owner's real context must be untouched by another user's write attempt");
    });

    await test("Security: IntelligenceChatContextService.resolve never leaks another user's persisted context into a stranger's request", async () => {
      const chatSvc = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService() }) });
      const ctx = await chatSvc.resolve({ requestId: "sec1", userId: strangerId, message: "What are the risks?", conversationId });
      // The stranger has no real symbol context of their own for this
      // conversation (authorization-scoped load returns null for them),
      // so a symbol-less follow-up question must fail to resolve - never
      // silently inherit the owner's NIFTY50.
      assert.equal(ctx.status, "clarification-required");
    });
  } finally {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  }
}

// ============================================================
// Context replacement (explicit, never time-based expiration)
// ============================================================
async function replacementTests(): Promise<void> {
  await test("Replacement: NIFTY -> BANKNIFTY - the new symbol fully replaces the old, never merged", () => {
    const next = deriveNextContext("c1", "u", { symbol: "BANKNIFTY", analysisRunId: "run-2" }, Date.now());
    assert.equal(next.activeSymbol, "BANKNIFTY");
    assert.equal(next.lastAnalysisRunId, "run-2");
  });

  await test("Replacement: M5 -> M15 - an explicit new timeframe replaces the old one", () => {
    const next = deriveNextContext("c1", "u", { symbol: "NIFTY50", timeframe: "15m" }, Date.now());
    assert.equal(next.activeTimeframe, "15m");
  });

  await test("Replacement: Indian market -> crypto - exchange/market fields honestly reflect the new instrument (no exchange for BTCUSD)", () => {
    const niftyInstrument = getCanonicalInstrument("NIFTY50");
    const btcInstrument = getCanonicalInstrument("BTCUSD");
    const next = deriveNextContext("c1", "u", { symbol: "BTCUSD", exchange: btcInstrument?.exchange, market: btcInstrument?.marketCategory }, Date.now());
    assert.equal(next.activeExchange, undefined);
    assert.equal(next.activeMarket, "crypto");
    assert.notEqual(niftyInstrument?.exchange, next.activeExchange);
  });

  await test("Replacement: explicit new topic never carries the old hypothesis ids forward into the new symbol's context", () => {
    const next = deriveNextContext("c1", "u", { symbol: "BANKNIFTY", hypothesisIds: ["new-hyp-1"] }, Date.now());
    assert.deepEqual(next.lastHypothesisIds, ["new-hyp-1"]);
  });

  await test("Replacement: end-to-end - a real BANKNIFTY turn after a real NIFTY50 turn persists only BANKNIFTY's own run/hypotheses", async () => {
    const userId = await createTestUser();
    const conversationId = await createTestConversation(userId);
    try {
      const runService = fakeAnalysisRunService();
      const chatSvc = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: runService }) });
      const first = await chatSvc.resolve({ requestId: "rep1", userId, message: "Analyze NIFTY.", conversationId });
      const second = await chatSvc.resolve({ requestId: "rep2", userId, message: "How about BANKNIFTY?", conversationId });
      assert.equal(first.envelope?.symbol, "NIFTY50");
      assert.equal(second.envelope?.symbol, "BANKNIFTY");
      const persisted = await new ConversationContextService().getContext(conversationId, userId);
      assert.equal(persisted?.activeSymbol, "BANKNIFTY");
      assert.equal(persisted?.lastAnalysisRunId, second.analysisRunId);
      assert.notEqual(persisted?.lastAnalysisRunId, first.analysisRunId);
    } finally {
      await prisma.message.deleteMany({ where: { conversationId } });
      await prisma.conversation.deleteMany({ where: { id: conversationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
}

// ============================================================
// Chat integration (multi-turn, real DB + fake market data)
// ============================================================
async function chatIntegrationTests(): Promise<void> {
  const userId = await createTestUser();
  const conversationId = await createTestConversation(userId);

  try {
    const chatSvc = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: new FakeMarketData(), analysisRunService: fakeAnalysisRunService() }) });

    await test("Chat: first message resolves with no prior context", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci1", userId, message: "Analyze NIFTY.", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "NIFTY50");
    });

    await test("Chat: follow-up message inherits the persisted symbol", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci2", userId, message: "What are the risks?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "NIFTY50");
    });

    await test("Chat: multi-turn analysis - hypothesis follow-up still resolves NIFTY50 via inherited context", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci3", userId, message: "What would invalidate this?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "NIFTY50");
      assert.equal(ctx.query.queryType, "hypothesis");
    });

    await test("Chat: risk follow-up classifies correctly and still resolves the inherited symbol", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci4", userId, message: "What are the risks here?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.query.queryType, "risk");
    });

    await test("Chat: historical validation follow-up classifies correctly", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci5", userId, message: "What about the historical performance?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.query.queryType, "historical");
    });

    await test("Chat: current-price follow-up still performs a fresh fetch (never a cached echo)", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci6", userId, message: "What is the current price?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.ok(ctx.dataQuality?.state === "fresh" || ctx.dataQuality?.state === "cached");
    });

    await test("Chat: an explicit new topic (BANKNIFTY) overrides the multi-turn NIFTY context", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci7", userId, message: "What about BANKNIFTY?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "BANKNIFTY");
    });

    await test("Chat: after the topic change, a subsequent symbol-less follow-up now inherits BANKNIFTY, not the old NIFTY", async () => {
      const ctx = await chatSvc.resolve({ requestId: "ci8", userId, message: "What are the risks?", conversationId });
      assert.equal(ctx.status, "resolved");
      assert.equal(ctx.envelope?.symbol, "BANKNIFTY");
    });
  } finally {
    await prisma.message.deleteMany({ where: { conversationId } });
    await prisma.conversation.deleteMany({ where: { id: conversationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

// ============================================================
// resolveSymbol priority sanity (D2.6.2, confirms the existing 4-tier chain the whole sprint depends on)
// ============================================================
async function resolveSymbolPriorityTests(): Promise<void> {
  await test("resolveSymbol: explicit-query wins over conversation context", () => {
    const r = resolveSymbol("Analyze BANKNIFTY.", undefined, { activeSymbol: "NIFTY50" });
    assert.equal(r.symbol, "BANKNIFTY");
    assert.equal(r.source, "explicit-query");
  });
  await test("resolveSymbol: request-context wins over conversation context", () => {
    const r = resolveSymbol("what are the risks", "RELIANCE", { activeSymbol: "NIFTY50" });
    assert.equal(r.symbol, "RELIANCE");
    assert.equal(r.source, "request-context");
  });
  await test("resolveSymbol: conversation context is the last real source before unresolved", () => {
    const r = resolveSymbol("what are the risks", undefined, { activeSymbol: "NIFTY50" });
    assert.equal(r.symbol, "NIFTY50");
    assert.equal(r.source, "conversation-context");
  });
  await test("resolveSymbol: truly nothing resolves to unresolved, never guessed", () => {
    const r = resolveSymbol("what are the risks", undefined, undefined);
    assert.equal(r.symbol, undefined);
    assert.equal(r.source, "unresolved");
  });
}

async function main(): Promise<void> {
  await persistenceTests();
  await resolutionTests();
  await followUpTests();
  await analysisLinkingTests();
  await freshnessTests();
  await securityTests();
  await replacementTests();
  await chatIntegrationTests();
  await resolveSymbolPriorityTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
