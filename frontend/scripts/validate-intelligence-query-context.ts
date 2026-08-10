// scripts/validate-intelligence-query-context.ts
// Sprint D2.6.2 - Standalone validation for IntelligenceQueryService and
// IntelligenceQueryContextService. Mixes pure/in-memory query-parsing
// tests with real-DB tests (previous-analysis retrieval + authorization),
// exercised end-to-end through the real, unmodified MarketStateService ->
// RegimeService -> HypothesisService -> IntelligenceEnvelopeService ->
// DecisionContextService chain (same discipline as
// scripts/validate-decision-context.ts). Run via
// `npm run validate:intelligence-query-context`.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { IntelligenceQueryService, resolveSymbol, resolveTimeframe } from "../services/intelligence/query/intelligence-query.service";
import { IntelligenceQueryContextService } from "../services/intelligence/query/intelligence-query-context.service";
import { IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { EvidenceBundle } from "../types/evidence";
import type { IntelligenceEnvelope } from "../types/intelligence-envelope";
import type { HypothesisSnapshot } from "../types/intelligence-hypothesis-snapshot";

const RUN_TAG = `d2-6-2-${Date.now()}`;
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

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

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
function snapshotFor(candles: Candle[]): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "XAUUSD",
    assetClass: "commodities",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}
// Copied verbatim from scripts/validate-hypothesis-engine.ts (verified there to produce a trending-bullish regime).
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();
const hypothesisSvc = new HypothesisService();
const envelopeSvc = new IntelligenceEnvelopeService();
const querySvc = new IntelligenceQueryService();
const contextSvc = new IntelligenceQueryContextService();

const candles = makeCandles(trendingBullishCloses());
const marketState = marketStateSvc.assemble({ symbol: "XAUUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles });
const regime = regimeSvc.classify({ marketState });
const hypotheses = hypothesisSvc.generate({ marketState, regime });
assert.equal(regime.regimeType, "trending-bullish", "fixture sanity check");
assert.equal(hypotheses.length, 1, "fixture sanity check");

function evidenceFixture(): EvidenceBundle {
  return {
    symbol: "XAUUSD",
    items: [
      { type: "price", symbol: "XAUUSD", claim: "price up", source: "provider-a", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
      { type: "technical", symbol: "XAUUSD", claim: "RSI neutral", source: "provider-b", asOf: GENERATED_AT, retrievedAt: GENERATED_AT },
    ],
    conflicts: [],
    generatedAt: GENERATED_AT,
  };
}

function fullEnvelope(): IntelligenceEnvelope {
  return envelopeSvc.build({ marketState, regime, hypotheses, evidence: evidenceFixture(), generatedAt: GENERATED_AT });
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}-owner@internal.test`, name: "D2.6.2 Test Owner" } });
  const otherUser = await prisma.user.create({ data: { email: `${RUN_TAG}-other@internal.test`, name: "D2.6.2 Test Other" } });
  const runIds: string[] = [];

  try {
    // ---- Query classification: one test per queryType ----
    const classificationCases: { question: string; expectedType: string; expectedScope: string }[] = [
      { question: "what is XAUUSD doing?", expectedType: "current-state", expectedScope: "market-state" },
      { question: "what regime is gold in?", expectedType: "regime", expectedScope: "regime" },
      { question: "why is gold moving?", expectedType: "evidence", expectedScope: "evidence" },
      { question: "what could happen next for gold?", expectedType: "hypothesis", expectedScope: "hypotheses" },
      { question: "what would invalidate the gold hypothesis?", expectedType: "hypothesis", expectedScope: "invalidation" },
      { question: "how did this perform historically for gold?", expectedType: "historical", expectedScope: "historical-validation" },
      { question: "what are the risks for gold?", expectedType: "risk", expectedScope: "risk" },
      { question: "how confident is the analysis on gold?", expectedType: "explanation", expectedScope: "intelligence-score" },
      { question: "gold thing", expectedType: "general-intelligence", expectedScope: "decision-context" },
    ];
    for (const c of classificationCases) {
      await test(`query classification: "${c.question}" -> ${c.expectedType}`, () => {
        const q = querySvc.parse({ rawQuestion: c.question, requestedAt: GENERATED_AT });
        assert.equal(q.queryType, c.expectedType);
        assert.ok(q.requestedScopes.includes(c.expectedScope as never));
      });
    }

    // ---- Symbol resolution ----
    await test("symbol resolution: explicit symbol in question text", () => {
      const r = resolveSymbol("what is XAUUSD doing?", undefined, undefined);
      assert.equal(r.symbol, "XAUUSD");
      assert.equal(r.source, "explicit-query");
    });
    await test("symbol resolution: falls back to conversation context when no explicit symbol", () => {
      const r = resolveSymbol("what is happening right now?", undefined, { activeSymbol: "BTCUSD" });
      assert.equal(r.symbol, "BTCUSD");
      assert.equal(r.source, "conversation-context");
    });
    await test("symbol resolution: request context beats conversation context, both beat nothing", () => {
      const withRequestContext = resolveSymbol("what is happening?", "EURUSD", { activeSymbol: "BTCUSD" });
      assert.equal(withRequestContext.symbol, "EURUSD");
      assert.equal(withRequestContext.source, "request-context");
      const withNothing = resolveSymbol("what is happening?", undefined, undefined);
      assert.equal(withNothing.symbol, undefined);
      assert.equal(withNothing.source, "unresolved");
    });
    await test("symbol resolution: missing symbol never invented", () => {
      const q = querySvc.parse({ rawQuestion: "what regime is this in?", requestedAt: GENERATED_AT });
      assert.equal(q.symbol, undefined);
      assert.ok(q.missingContext.includes("symbol"));
    });
    await test("symbol resolution: multiple distinct symbols mentioned -> unresolved, never guessed", () => {
      const r = resolveSymbol("is gold or bitcoin moving more?", undefined, undefined);
      assert.equal(r.symbol, undefined);
      assert.equal(r.ambiguousCandidates.length, 2);
      assert.ok(r.ambiguousCandidates.includes("XAUUSD"));
      assert.ok(r.ambiguousCandidates.includes("BTCUSD"));
    });

    // ---- Timeframe resolution ----
    await test("timeframe resolution: explicit timeframe token in question text", () => {
      const r = resolveTimeframe("what is the 1h trend for gold?", undefined, undefined);
      assert.equal(r.timeframe, "1h");
      assert.equal(r.source, "explicit-query");
    });
    await test("timeframe resolution: falls back to conversation context", () => {
      const r = resolveTimeframe("what is happening?", undefined, { activeTimeframe: "4h" });
      assert.equal(r.timeframe, "4h");
      assert.equal(r.source, "conversation-context");
    });
    await test("timeframe resolution: missing timeframe never defaulted", () => {
      const r = resolveTimeframe("what is gold doing?", undefined, undefined);
      assert.equal(r.timeframe, undefined);
      assert.equal(r.source, "unresolved");
    });

    // ---- Scope selection / evidence relevance / hypothesis relevance ----
    await test("scope selection + evidence relevance: only the real, same-symbol evidence bundle is selected, ranked deterministically", async () => {
      const query = querySvc.parse({ rawQuestion: "why is gold weak?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.selectedEvidence.length, 2);
      assert.ok(ctx.selectedEvidence.every((e) => e.symbol === "XAUUSD"));
      assert.deepEqual(ctx.selectedConflicts, []);
    });

    await test("hypothesis relevance: only active (non-expired) hypotheses selected", async () => {
      const query = querySvc.parse({ rawQuestion: "what could happen next for gold?", requestedAt: GENERATED_AT });
      const envelope = fullEnvelope();
      const dueAt = new Date(GENERATED_AT).getTime() + hypotheses[0].statement.predictionWindow.candles * 60 * 60 * 1000;

      const stillActive = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: new Date(dueAt - 1000).toISOString() });
      assert.equal(stillActive.selectedHypotheses.length, 1);

      const expired = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: new Date(dueAt + 1000).toISOString() });
      assert.equal(expired.selectedHypotheses.length, 0);
      assert.ok(expired.missingContext.some((m) => m.includes("prediction window has already closed")));
    });

    // ---- Historical retrieval ----
    await test("historical retrieval: available segment passed through unchanged", async () => {
      const query = querySvc.parse({ rawQuestion: "how did this perform historically for gold?", requestedAt: GENERATED_AT });
      const envelope = envelopeSvc.build({
        marketState,
        regime,
        hypotheses,
        historicalValidation: {
          symbol: "XAUUSD",
          timeframe: "1h",
          regimeType: regime.regimeType,
          hypothesisType: hypotheses[0].type,
          sampleSize: 30,
          validatedCount: 21,
          invalidatedCount: 9,
          inconclusiveCount: 2,
          validatedRate: 0.7,
          minSampleSize: 30,
          generatedAt: GENERATED_AT,
        },
        generatedAt: GENERATED_AT,
      });
      const ctx = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.historicalContext?.status, "available");
      assert.equal(ctx.historicalContext?.validatedRate, 0.7);
    });

    await test("historical retrieval: unavailable segment explicitly represented, never fabricated", async () => {
      const query = querySvc.parse({ rawQuestion: "how did this perform historically for gold?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.historicalContext?.status, "unavailable");
      assert.ok(ctx.missingContext.some((m) => m.startsWith("historical-validation")));
    });

    // ---- Previous analysis + authorization ----
    let previousRunId: string;
    await test("previous analysis: correct AnalysisRun retrieved via explicit conversation context, never guessed from question wording", async () => {
      const runs = new IntelligenceAnalysisRunService();
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses, capturedAt: GENERATED_AT };
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "XAUUSD", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(run.id);
      previousRunId = run.id;

      const query = querySvc.parse({ rawQuestion: "was your earlier breakout hypothesis correct?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({
        query,
        userId: user.id,
        conversationContext: { previousAnalysisRunId: run.id },
        generatedAt: GENERATED_AT,
      });
      assert.ok(ctx.previousAnalysis);
      assert.equal(ctx.previousAnalysis?.analysisRun.id, run.id);
      assert.equal(ctx.previousAnalysis?.analysisRun.userId, user.id);
    });

    await test("authorization: a different user cannot retrieve another user's analysis run", async () => {
      const query = querySvc.parse({ rawQuestion: "was your earlier breakout hypothesis correct?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({
        query,
        userId: otherUser.id,
        conversationContext: { previousAnalysisRunId: previousRunId },
        generatedAt: GENERATED_AT,
      });
      assert.equal(ctx.previousAnalysis, undefined);
      assert.ok(ctx.missingContext.some((m) => m.startsWith("previous-analysis")));
    });

    // ---- Missing information for other requested-but-unavailable scopes ----
    await test("missing information: requested risk scope with no RiskProfile is explicitly represented, never fabricated", async () => {
      const query = querySvc.parse({ rawQuestion: "what are the risks for gold?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.riskContext?.dataAvailable, false);
      assert.ok(ctx.missingContext.some((m) => m.startsWith("risk")));
    });

    // ---- Ambiguous query ----
    await test("ambiguous query: no invented interpretation, honestly falls back to general-intelligence", () => {
      const q = querySvc.parse({ rawQuestion: "What about Gold?", requestedAt: GENERATED_AT });
      assert.equal(q.queryType, "general-intelligence");
      assert.equal(q.classificationConfidence, "low");
      assert.equal(q.ambiguous, true);
      assert.deepEqual(q.requestedScopes, ["decision-context"]);
    });

    // ---- Context completeness ----
    await test("context completeness: insufficient when symbol unresolved", async () => {
      const query = querySvc.parse({ rawQuestion: "what regime is this in?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.completeness, "insufficient");
    });
    await test("context completeness: complete when symbol+timeframe resolved and every requested scope is satisfied", async () => {
      const query = querySvc.parse({ rawQuestion: "what regime is XAUUSD in on the 1h?", requestedAt: GENERATED_AT });
      assert.equal(query.symbol, "XAUUSD");
      assert.equal(query.timeframe, "1h");
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.completeness, "complete");
    });
    await test("context completeness: partial when a requested scope is genuinely unavailable", async () => {
      const query = querySvc.parse({ rawQuestion: "what are the risks for XAUUSD on the 1h?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      assert.equal(ctx.completeness, "partial");
    });

    // ---- Determinism ----
    await test("determinism: same inputs -> byte-identical IntelligenceQueryContext", async () => {
      const query = querySvc.parse({ rawQuestion: "why is XAUUSD weak on the 1h?", requestedAt: GENERATED_AT });
      const envelope = fullEnvelope();
      const a = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: GENERATED_AT });
      const b = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: GENERATED_AT });
      assert.deepEqual(a, b);
    });

    // ---- Freshness: no fabricated timestamps ----
    await test("freshness: dataAsOf is the real envelope timestamp, never a fabricated 'now'", async () => {
      const query = querySvc.parse({ rawQuestion: "what is XAUUSD doing?", requestedAt: GENERATED_AT });
      const envelope = fullEnvelope();
      const laterNow = "2026-01-02T00:00:00.000Z";
      const ctx = await contextSvc.build({ query, envelope, userId: user.id, generatedAt: laterNow });
      assert.equal(ctx.dataAsOf, envelope.generatedAt);
      assert.notEqual(ctx.dataAsOf, laterNow);
      assert.equal(ctx.generatedAt, laterNow);

      const noEnvelopeCtx = await contextSvc.build({ query, userId: user.id, generatedAt: laterNow });
      assert.equal(noEnvelopeCtx.dataAsOf, undefined, "no envelope means no real data timestamp exists - never fabricated");
    });

    // ---- No LLM / no network (structural) ----
    await test("structural: query orchestration services never import Gemini/Claude/OpenAI SDKs or lib/ai", () => {
      const files = [
        "services/intelligence/query/intelligence-query.service.ts",
        "services/intelligence/query/intelligence-query-context.service.ts",
        "services/intelligence/query/analysis-history.service.ts",
      ];
      for (const file of files) {
        const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
        const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
        for (const needle of ["@google/genai", "lib/ai", "openai", "anthropic", "axios", "node-fetch"]) {
          assert.ok(!importLines.some((line) => line.toLowerCase().includes(needle.toLowerCase())), `${file} must not import from anything matching "${needle}"`);
        }
        for (const needle of ["fetch(", "XMLHttpRequest"]) {
          assert.ok(!source.includes(needle), `${file} must not perform a raw network call ("${needle}")`);
        }
      }
    });

    // ---- No signal / no prediction language ----
    await test("no signal, no prediction: output never contains a BUY/SELL instruction, win-rate claim, or probability language", async () => {
      const query = querySvc.parse({ rawQuestion: "why is XAUUSD weak and what could invalidate this view on the 1h?", requestedAt: GENERATED_AT });
      const ctx = await contextSvc.build({ query, envelope: fullEnvelope(), userId: user.id, generatedAt: GENERATED_AT });
      const text = JSON.stringify(ctx);
      const prohibited = [/buy now/i, /sell now/i, /\d+%\s*win rate/i, /target\s*=/i, /stop loss\s*=/i, /\d+%\s*chance/i, /\d+%\s*probability/i, /probability of profit\s*[:=]\s*\d/i];
      for (const pattern of prohibited) {
        assert.ok(!pattern.test(text), `IntelligenceQueryContext output must not match prohibited pattern ${pattern}`);
      }
      const keys = JSON.stringify(Object.keys(ctx));
      for (const forbiddenKey of ["action", "recommendation", "signal", "positionSize", "buySignal", "sellSignal"]) {
        assert.ok(!keys.toLowerCase().includes(forbiddenKey.toLowerCase()));
      }
    });
  } finally {
    await prisma.intelligenceAnalysisOutcome.deleteMany({ where: { analysisRunId: { in: runIds } } });
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });

    const leftoverRuns = await prisma.intelligenceAnalysisRun.count({ where: { id: { in: runIds } } });
    const leftoverUsers = await prisma.user.count({ where: { id: { in: [user.id, otherUser.id] } } });
    if (leftoverRuns > 0 || leftoverUsers > 0) {
      console.error(`  WARNING: leftover rows - runs:${leftoverRuns} users:${leftoverUsers}`);
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, runs)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
