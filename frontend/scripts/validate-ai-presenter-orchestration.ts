// scripts/validate-ai-presenter-orchestration.ts
// Sprint D2.6.8 - Verified AI Presenter, Multi-Model Fallback & Response
// Integrity. Standalone, assert-based verification (no test framework, no
// live network by default - fake presenters/fake HTTP transports
// throughout, matching this project's own scripts/validate-*.ts
// convention). Run via `npm run validate:ai-presenter-orchestration`.
//
// Fixture builders (makeCandles/snapshotFor/trendingBullishCloses) are
// copied from scripts/validate-realtime-intelligence.ts, matching this
// project's established convention of each validate-*.ts script being
// self-contained.
//
// Scope: this script tests the NEW D2.6.8 surface only -
// AIPresenterOrchestratorService, ClaudeProvider, OpenAIProvider. It
// deliberately does not re-test AIResponseIntegrityService's individual
// violation rules (already covered by scripts/validate-realtime-
// intelligence.ts) or D2.6.7's conversation-context resolution (already
// covered by scripts/validate-conversation-continuity.ts) - it proves the
// orchestrator wires correctly to both, end to end.
import dotenv from "dotenv";
// Real provider credentials (e.g. GEMINI_API_KEY) live in .env.local
// (Next.js convention), not .env - dotenv/config's default only loads
// .env, which would leave the live smoke test below honestly skipping
// even when a real key is present. Load both, .env.local last so it can
// override - same pattern as scripts/validate-indian-market-data.ts.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import assert from "node:assert/strict";
import { AIPresenterOrchestratorService, DEFAULT_PRESENTER_SLOTS, type PresenterSlot } from "../services/intelligence/chat/ai-presenter-orchestrator.service";
import { DeterministicSafeFallbackPresenter } from "../services/intelligence/chat/deterministic-safe-fallback-presenter.service";
import { GeminiIntelligencePresenter } from "../services/intelligence/chat/gemini-intelligence-presenter.service";
import { formatDecisionContextAsText } from "../services/intelligence/chat/decision-context-formatter";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { ClaudeProvider, type ClaudeFetch } from "../lib/ai/providers/claude.provider";
import { OpenAIProvider, type OpenAIFetch } from "../lib/ai/providers/openai.provider";
import { AIProviderError } from "../lib/ai/errors";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AIIntelligencePresenter, AIPresentationResult, IntelligenceEnvelope } from "../types/intelligence-envelope";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";

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

function buildEnvelope(): IntelligenceEnvelope {
  const marketState = new MarketStateService().assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: bullishSnapshot, candles: bullishCandles });
  const regime = new RegimeService().classify({ marketState });
  const hypotheses = new HypothesisService().generate({ marketState, regime });
  return new IntelligenceEnvelopeService().build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T00:00:00.000Z" });
}

/** A real envelope with two directly conflicting evidence items, so DecisionContextService produces a genuine unresolvedConflicts entry - same fixture shape as validate-realtime-intelligence.ts's test O. */
function buildConflictedEnvelope(): IntelligenceEnvelope {
  const envelope = buildEnvelope();
  const conflict = {
    type: "technical" as const,
    symbol: envelope.symbol,
    itemA: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI overbought", source: "a", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
    itemB: { type: "technical" as const, symbol: envelope.symbol, claim: "RSI oversold", source: "b", asOf: envelope.generatedAt, retrievedAt: envelope.generatedAt },
    resolution: "unresolved" as const,
    reason: "Directly contradictory technical readings",
  };
  return {
    ...envelope,
    evidence: { symbol: envelope.symbol, items: [], conflicts: [conflict], generatedAt: envelope.generatedAt },
    conflicts: [conflict],
  };
}

/** An envelope DecisionContextService will classify as state "insufficient-intelligence" (regime.regimeType === "insufficient-data"), used only as a static fixture object - never routed through a real regime computation. */
function buildInsufficientEnvelope(): IntelligenceEnvelope {
  const envelope = buildEnvelope();
  return { ...envelope, regime: { ...envelope.regime, regimeType: "insufficient-data" } };
}

function fakePresenter(name: string, present: (envelope: IntelligenceEnvelope, question: string) => Promise<AIPresentationResult>): AIIntelligencePresenter {
  return { name, present };
}

/** Wraps a PresenterSlot with a construction counter, so a test can assert an unavailable slot's presenter is genuinely never constructed (not merely never awaited). */
function countingSlot(name: string, available: boolean, presenter: AIIntelligencePresenter): { slot: PresenterSlot; constructedCount: () => number } {
  let count = 0;
  return {
    slot: { name, isAvailable: () => available, createPresenter: () => { count += 1; return presenter; } },
    constructedCount: () => count,
  };
}

const goodEnvelope = buildEnvelope();
const goodDecisionContext = new DecisionContextService().build(goodEnvelope);
const goodAnswerText = `EURUSD is currently trading around ${goodDecisionContext.currentState.price}. The regime is ${goodDecisionContext.regimeContext.regimeType}.`;

// ============================================================
// Section 1: Provider availability
// ============================================================
async function availabilityTests(): Promise<void> {
  await test("availability 1: an available slot is attempted and its result is used", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "what's happening?");
    assert.equal(result.presentedBy, "gemini");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].attempted, true);
    assert.equal(result.attempts[0].success, true);
  });

  await test("availability 2: an unavailable Gemini slot is recorded as unavailable and its presenter is never constructed", async () => {
    const spy = fakePresenter("gemini", async () => { throw new Error("must never be called"); });
    const { slot, constructedCount } = countingSlot("gemini", false, spy);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].attempted, false);
    assert.equal(result.attempts[0].failureCategory, "unavailable");
    assert.equal(constructedCount(), 0);
  });

  await test("availability 3: an unavailable Claude slot is skipped, next slot still attempted", async () => {
    const { slot: claudeSlot } = countingSlot("claude", false, fakePresenter("claude", async () => { throw new Error("never"); }));
    const good = fakePresenter("openai", async () => ({ text: goodAnswerText, presentedBy: "openai", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot: openaiSlot } = countingSlot("openai", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [claudeSlot, openaiSlot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.presentedBy, "openai");
    assert.equal(result.attempts[0].failureCategory, "unavailable");
    assert.equal(result.attempts[1].success, true);
  });

  await test("availability 4: an unavailable OpenAI slot is skipped when it is the only slot, falling to deterministic fallback", async () => {
    const { slot } = countingSlot("openai", false, fakePresenter("openai", async () => { throw new Error("never"); }));
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.presentedBy, "deterministic-fallback");
  });

  await test("availability 5: every provider unavailable -> deterministic fallback used, never a crash, never a fabricated answer", async () => {
    const slots = [
      countingSlot("gemini", false, fakePresenter("gemini", async () => { throw new Error("never"); })).slot,
      countingSlot("claude", false, fakePresenter("claude", async () => { throw new Error("never"); })).slot,
      countingSlot("openai", false, fakePresenter("openai", async () => { throw new Error("never"); })).slot,
    ];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.attempts.length, 4, "3 unavailable attempts plus the fallback's own attempt entry");
    assert.ok(result.attempts.slice(0, 3).every((a) => a.failureCategory === "unavailable"));
  });

  await test("availability 6: DEFAULT_PRESENTER_SLOTS priority order is exactly gemini, claude, openai", () => {
    assert.deepEqual(DEFAULT_PRESENTER_SLOTS.map((s) => s.name), ["gemini", "claude", "openai"]);
  });

  await test("availability 7: DEFAULT_PRESENTER_SLOTS gates purely on real env-var presence, toggling live with the environment", () => {
    const savedGemini = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      assert.equal(DEFAULT_PRESENTER_SLOTS[0].isAvailable(), false);
      process.env.GEMINI_API_KEY = "fake-test-key-not-real";
      assert.equal(DEFAULT_PRESENTER_SLOTS[0].isAvailable(), true);
    } finally {
      if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedGemini;
    }
  });

  await test("availability 8: a whitespace-only env value is treated as absent, never as a valid credential", () => {
    const savedOpenAI = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "   ";
      assert.equal(DEFAULT_PRESENTER_SLOTS[2].isAvailable(), false);
    } finally {
      if (savedOpenAI === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedOpenAI;
    }
  });
}

// ============================================================
// Section 2: Provider fallback chains
// ============================================================
async function fallbackChainTests(): Promise<void> {
  await test("fallback 1: Gemini throws -> Claude succeeds", async () => {
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new AIProviderError("network", "down", "gemini"); })).slot;
    const claudeSlot = countingSlot("claude", true, fakePresenter("claude", async () => ({ text: goodAnswerText, presentedBy: "claude", envelopeGeneratedAt: goodEnvelope.generatedAt }))).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.presentedBy, "claude");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.attempts[0].success, false);
    assert.equal(result.attempts[0].failureCategory, "provider-error");
    assert.equal(result.attempts[1].success, true);
  });

  await test("fallback 2: Gemini throws, Claude unavailable -> OpenAI succeeds", async () => {
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("boom"); })).slot;
    const claudeSlot = countingSlot("claude", false, fakePresenter("claude", async () => { throw new Error("never"); })).slot;
    const openaiSlot = countingSlot("openai", true, fakePresenter("openai", async () => ({ text: goodAnswerText, presentedBy: "openai", envelopeGeneratedAt: goodEnvelope.generatedAt }))).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot, openaiSlot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.presentedBy, "openai");
  });

  await test("fallback 3: Gemini and Claude both fail -> OpenAI succeeds", async () => {
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new AIProviderError("timeout", "slow", "gemini"); })).slot;
    const claudeSlot = countingSlot("claude", true, fakePresenter("claude", async () => { throw new AIProviderError("rate_limit", "429", "claude"); })).slot;
    const openaiSlot = countingSlot("openai", true, fakePresenter("openai", async () => ({ text: goodAnswerText, presentedBy: "openai", envelopeGeneratedAt: goodEnvelope.generatedAt }))).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot, openaiSlot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.presentedBy, "openai");
    assert.equal(result.attempts[0].failureCategory, "timeout");
    assert.equal(result.attempts[1].failureCategory, "rate-limit");
  });

  await test("fallback 4: all three real providers fail -> deterministic fallback used, matching the exact real formatted text", async () => {
    const slots = ["gemini", "claude", "openai"].map((n) => countingSlot(n, true, fakePresenter(n, async () => { throw new Error("down"); })).slot);
    const fallback = new DeterministicSafeFallbackPresenter();
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.presentedBy, "deterministic-fallback");
    assert.equal(result.text, formatDecisionContextAsText(new DecisionContextService().build(goodEnvelope)));
  });

  await test("fallback 5: one provider failing immediately allows the very next attempt (no retry of the same slot)", async () => {
    let geminiCallCount = 0;
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async () => { geminiCallCount += 1; throw new Error("down"); })).slot;
    const claudeSlot = countingSlot("claude", true, fakePresenter("claude", async () => ({ text: goodAnswerText, presentedBy: "claude", envelopeGeneratedAt: goodEnvelope.generatedAt }))).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot] });
    await orchestrator.present(goodEnvelope, "q");
    assert.equal(geminiCallCount, 1);
  });

  await test("fallback 6: a synchronous throw inside createPresenter (construction failure) is handled the same as an async rejection, never crashing the pipeline", async () => {
    const throwingSlot: PresenterSlot = { name: "gemini", isAvailable: () => true, createPresenter: () => { throw new Error("constructor exploded"); } };
    const goodSlot = countingSlot("claude", true, fakePresenter("claude", async () => ({ text: goodAnswerText, presentedBy: "claude", envelopeGeneratedAt: goodEnvelope.generatedAt }))).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [throwingSlot, goodSlot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.presentedBy, "claude");
    assert.equal(result.attempts[0].success, false);
    assert.equal(result.attempts[0].failureCategory, "provider-error");
  });
}

// ============================================================
// Section 3: Response integrity gating inside the orchestrator loop
// ============================================================
async function integrityGatingTests(): Promise<void> {
  await test("integrity gate 1: a genuinely valid response is accepted directly, never replaced", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, false);
    assert.equal(result.attempts[0].integrityPassed, true);
  });

  await test("integrity gate 2: a fabricated price-like number is rejected and the orchestrator moves to the next provider", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "EURUSD is trading around 999999.99 right now.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const good = fakePresenter("claude", async () => ({ text: goodAnswerText, presentedBy: "claude", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const slots = [countingSlot("gemini", true, bad).slot, countingSlot("claude", true, good).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].integrityPassed, false);
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
    assert.equal(result.presentedBy, "claude");
  });

  await test("integrity gate 3: a fabricated indicator (Stochastic, never computed by this platform) is rejected", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "The Stochastic oscillator confirms this move.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
    assert.equal(result.fallbackUsed, true);
  });

  await test("integrity gate 4: an RSI claim with no real rsi14 value computed is rejected as an unsupported indicator claim", async () => {
    const envelopeNoRsi: IntelligenceEnvelope = { ...goodEnvelope, marketState: { ...goodEnvelope.marketState, technical: undefined } };
    const bad = fakePresenter("gemini", async () => ({ text: "RSI is showing overbought conditions.", presentedBy: "gemini", envelopeGeneratedAt: envelopeNoRsi.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(envelopeNoRsi, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("integrity gate 5: a fabricated historical-performance claim is rejected when no historical validation was actually supplied", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "Historically, this setup has worked 90% of the time.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("integrity gate 6: a risk-context claim ('guaranteed profit') is rejected", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "This is a guaranteed profit, buy now.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("integrity gate 7: Intelligence Score restated as a win probability ('85% probability of winning') is rejected, never presented as-is", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "There is an 85% probability of winning this trade.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
    assert.equal(result.fallbackUsed, true);
  });

  await test("integrity gate 8: unsupported over-certainty while a real unresolved evidence conflict exists is rejected", async () => {
    const conflicted = buildConflictedEnvelope();
    const bad = fakePresenter("gemini", async () => ({ text: "This is definitely going to continue rising without a doubt.", presentedBy: "gemini", envelopeGeneratedAt: conflicted.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(conflicted, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("integrity gate 9: confident language with no hedging while the decision state is insufficient-intelligence is rejected", async () => {
    const insufficient = buildInsufficientEnvelope();
    const bad = fakePresenter("gemini", async () => ({ text: "EURUSD looks strong and is likely to keep climbing.", presentedBy: "gemini", envelopeGeneratedAt: insufficient.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(insufficient, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("integrity gate 10: empty presenter output is treated as a malformed response, never passed to the integrity checker as a pass", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "   ", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "malformed-response");
    assert.equal(result.attempts[0].integrityPassed, undefined, "an empty response never reaches the integrity checker at all");
  });

  await test("integrity gate 11: the deterministic safe fallback's own output always passes integrity when it is the last resort", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, true);
    const lastAttempt = result.attempts[result.attempts.length - 1];
    assert.equal(lastAttempt.success, true);
    assert.equal(lastAttempt.integrityPassed, true);
  });
}

// ============================================================
// Section 4: Context preservation (decision context fields reach the integrity gate)
// ============================================================
async function contextPreservationTests(): Promise<void> {
  await test("context 1: the real symbol from the envelope is what unsupported-symbol checks against, not a hardcoded default", async () => {
    const bad = fakePresenter("gemini", async () => ({ text: "This looks similar to BTCUSD right now.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "integrity-rejection");
  });

  await test("context 2: the real timeframe/regime basis text is honestly restated by the deterministic fallback when it is used", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.ok(result.text.includes(goodDecisionContext.regimeContext.regimeType));
  });

  await test("context 3: real hypotheses (when present) are reflected in the deterministic fallback's text, never omitted", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    if (goodDecisionContext.primaryHypotheses.length > 0) {
      assert.ok(result.text.includes(goodDecisionContext.primaryHypotheses[0].claim));
    }
  });

  await test("context 4: invalidation conditions (when present) appear in the deterministic fallback's text", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    if (goodDecisionContext.invalidationConditions.length > 0) {
      assert.ok(result.text.includes(goodDecisionContext.invalidationConditions[0].description));
    }
  });

  await test("context 5: historical-validation status text (e.g. 'unavailable') is present in the deterministic fallback, never silently dropped", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.ok(result.text.includes("## Historical Validation"));
  });

  await test("context 6: risk context section is present in the deterministic fallback text even when no RiskProfile was supplied (honest 'unavailable')", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.ok(result.text.includes("## Risk"));
  });

  await test("context 7: missing-information items are present in the deterministic fallback text, never hidden", async () => {
    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.ok(result.text.includes("## Missing Information"));
  });

  await test("context 8: no cross-call state leakage - a second present() call for a different symbol never reuses the first call's decision context", async () => {
    const marketState2 = new MarketStateService().assemble({ symbol: "BTCUSD", timeframe: "1h", snapshot: { ...bullishSnapshot, symbol: "BTCUSD", price: 65000 }, candles: bullishCandles });
    const regime2 = new RegimeService().classify({ marketState: marketState2 });
    const hypotheses2 = new HypothesisService().generate({ marketState: marketState2, regime: regime2 });
    const envelope2 = new IntelligenceEnvelopeService().build({ marketState: marketState2, regime: regime2, hypotheses: hypotheses2, generatedAt: "2026-01-02T00:00:00.000Z" });

    const slots = [countingSlot("gemini", true, fakePresenter("gemini", async () => { throw new Error("down"); })).slot];
    const orchestrator = new AIPresenterOrchestratorService({ slots, fallback: new DeterministicSafeFallbackPresenter() });
    const r1 = await orchestrator.present(goodEnvelope, "q");
    const r2 = await orchestrator.present(envelope2, "q");
    assert.ok(r1.text.includes("EURUSD") || r1.text.includes(String(goodEnvelope.marketState.snapshot.price)));
    assert.ok(r2.text.includes("BTCUSD") || r2.text.includes("65000"));
    assert.notEqual(r1.text, r2.text);
  });
}

// ============================================================
// Section 5: Security
// ============================================================
async function securityTests(): Promise<void> {
  await test("security 1: PresenterAttempt objects never contain an apiKey/key/secret/token-shaped field", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    for (const attempt of result.attempts) {
      for (const key of Object.keys(attempt)) {
        assert.ok(!/key|secret|token|credential/i.test(key), `PresenterAttempt leaked a credential-shaped field: ${key}`);
      }
    }
  });

  await test("security 2: a provider error containing a fake secret in its message never surfaces that message anywhere in the result - only a closed-vocabulary failureCategory does", async () => {
    const secretLeak = "network error, api key sk-FAKE-TEST-SECRET-VALUE was rejected";
    const bad = fakePresenter("gemini", async () => { throw new AIProviderError("auth", secretLeak, "gemini"); });
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("sk-FAKE-TEST-SECRET-VALUE"));
    assert.equal(result.attempts[0].failureCategory, "authentication");
  });

  await test("security 3: ClaudeProvider never includes the raw API key in its own thrown error messages on an HTTP failure", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-FAKE-TEST-KEY-999";
    try {
      const fetchImpl: ClaudeFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "unauthorized" } }) });
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
        (err: unknown) => {
          assert.ok(err instanceof AIProviderError);
          assert.ok(!err.message.includes("sk-ant-FAKE-TEST-KEY-999"));
          return true;
        },
      );
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  await test("security 4: OpenAIProvider never includes the raw API key in its own thrown error messages on an HTTP failure", async () => {
    const savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-FAKE-TEST-OPENAI-KEY-999";
    try {
      const fetchImpl: OpenAIFetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) });
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(
        provider.complete({ messages: [{ role: "user", content: "hi" }] }),
        (err: unknown) => {
          assert.ok(err instanceof AIProviderError);
          assert.ok(!err.message.includes("sk-FAKE-TEST-OPENAI-KEY-999"));
          return true;
        },
      );
    } finally {
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  await test("security 5: PresenterOrchestrationResult carries no raw request/prompt text, only the final validated response", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "a secret-sounding trader question about my account");
    assert.deepEqual(Object.keys(result).sort(), ["attempts", "envelopeGeneratedAt", "fallbackUsed", "presentedBy", "text"].sort());
  });
}

// ============================================================
// Section 6: Determinism & observability shape
// ============================================================
async function determinismAndObservabilityTests(): Promise<void> {
  await test("determinism 1: identical envelope + identical mocked presenter behavior + a fixed clock produce identical validation outcomes", async () => {
    const fixedClock = { now: () => 1_700_000_000_000 };
    const behavior = async (): Promise<AIPresentationResult> => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt });
    const slots1 = [countingSlot("gemini", true, fakePresenter("gemini", behavior)).slot];
    const slots2 = [countingSlot("gemini", true, fakePresenter("gemini", behavior)).slot];
    const o1 = new AIPresenterOrchestratorService({ slots: slots1, clock: fixedClock });
    const o2 = new AIPresenterOrchestratorService({ slots: slots2, clock: fixedClock });
    const r1 = await o1.present(goodEnvelope, "q");
    const r2 = await o2.present(goodEnvelope, "q");
    assert.deepEqual(r1, r2);
  });

  await test("determinism 2: an unresolvable integrity outcome (fabricated claim) is rejected identically across two independent orchestrator instances", async () => {
    const fixedClock = { now: () => 1_700_000_000_000 };
    const badBehavior = async (): Promise<AIPresentationResult> => ({ text: "EURUSD is trading around 999999.99.", presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt });
    const o1 = new AIPresenterOrchestratorService({ slots: [countingSlot("gemini", true, fakePresenter("gemini", badBehavior)).slot], fallback: new DeterministicSafeFallbackPresenter(), clock: fixedClock });
    const o2 = new AIPresenterOrchestratorService({ slots: [countingSlot("gemini", true, fakePresenter("gemini", badBehavior)).slot], fallback: new DeterministicSafeFallbackPresenter(), clock: fixedClock });
    const r1 = await o1.present(goodEnvelope, "q");
    const r2 = await o2.present(goodEnvelope, "q");
    assert.equal(r1.fallbackUsed, r2.fallbackUsed);
    assert.equal(r1.text, r2.text);
  });

  await test("observability 1: every attempt entry carries provider, attempted, success, and an ISO timestamp", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    for (const attempt of result.attempts) {
      assert.ok(typeof attempt.provider === "string" && attempt.provider.length > 0);
      assert.ok(typeof attempt.attempted === "boolean");
      assert.ok(typeof attempt.success === "boolean");
      assert.ok(!Number.isNaN(Date.parse(attempt.timestamp)));
    }
  });

  await test("observability 2: a successful attempt records a numeric latencyMs, never a fabricated or missing one", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(typeof result.attempts[0].latencyMs, "number");
    assert.ok(result.attempts[0].latencyMs! >= 0);
  });

  await test("observability 3: an unavailable slot's attempt has no latencyMs (never invented for work that was never attempted)", async () => {
    const { slot } = countingSlot("gemini", false, fakePresenter("gemini", async () => { throw new Error("never"); }));
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].latencyMs, undefined);
  });

  await test("observability 4: fallbackUsed is false whenever any real provider's response was actually used", async () => {
    const good = fakePresenter("gemini", async () => ({ text: goodAnswerText, presentedBy: "gemini", envelopeGeneratedAt: goodEnvelope.generatedAt }));
    const { slot } = countingSlot("gemini", true, good);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot] });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.fallbackUsed, false);
  });

  await test("observability 5: classifyFailure maps every real AIErrorKind to a documented PresenterFailureCategory, never an unmapped/undefined category", async () => {
    const kinds = ["auth", "rate_limit", "timeout", "network", "invalid_input", "invalid_output", "invalid_dimensions", "unknown"] as const;
    for (const kind of kinds) {
      const bad = fakePresenter("gemini", async () => { throw new AIProviderError(kind, "x", "gemini"); });
      const { slot } = countingSlot("gemini", true, bad);
      const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
      const result = await orchestrator.present(goodEnvelope, "q");
      assert.ok(result.attempts[0].failureCategory !== undefined, `kind "${kind}" produced no failureCategory`);
    }
  });

  await test("observability 6: a non-AIProviderError exception (a plain bug) is classified as provider-error, never crashing the loop", async () => {
    const bad = fakePresenter("gemini", async () => { throw new TypeError("unexpected shape"); });
    const { slot } = countingSlot("gemini", true, bad);
    const orchestrator = new AIPresenterOrchestratorService({ slots: [slot], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "q");
    assert.equal(result.attempts[0].failureCategory, "provider-error");
  });
}

// ============================================================
// Section 7: ClaudeProvider adapter (mocked HTTP transport only - no live @anthropic-ai credentials exist for this project)
// ============================================================
async function claudeProviderTests(): Promise<void> {
  const withFakeKey = async (fn: () => Promise<void>): Promise<void> => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-FAKE-TEST-KEY";
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  };

  await test("ClaudeProvider 1: constructor throws when ANTHROPIC_API_KEY is genuinely missing, never silently degrading", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.throws(() => new ClaudeProvider());
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  await test("ClaudeProvider 2: a successful call folds every system-role message into the top-level `system` field, never as a message role", () =>
    withFakeKey(async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const fetchImpl: ClaudeFetch = async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "hello" }], model: "claude-sonnet-4-5" }) };
      };
      const provider = new ClaudeProvider({ fetchImpl });
      await provider.complete({ messages: [{ role: "system", content: "be concise" }, { role: "user", content: "hi" }] });
      assert.equal(capturedBody!.system, "be concise");
      const messages = capturedBody!.messages as { role: string }[];
      assert.ok(messages.every((m) => m.role !== "system"));
    }));

  await test("ClaudeProvider 3: the parsed response content and provider name are returned correctly", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "EURUSD is discussed here." }], model: "claude-sonnet-4-5", usage: { input_tokens: 10, output_tokens: 5 } }) });
      const provider = new ClaudeProvider({ fetchImpl });
      const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(result.content, "EURUSD is discussed here.");
      assert.equal(result.provider, "claude");
      assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5 });
    }));

  await test("ClaudeProvider 4: HTTP 401 maps to kind 'auth'", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "auth");
    }));

  await test("ClaudeProvider 5: HTTP 429 maps to kind 'rate_limit'", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "rate_limit");
    }));

  await test("ClaudeProvider 6: a transport-level rejection (network failure) maps to kind 'network', never uncaught", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => { throw new Error("ECONNRESET"); };
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "network");
    }));

  await test("ClaudeProvider 7: malformed (non-JSON-parseable) response body maps to kind 'invalid_output'", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } });
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "invalid_output");
    }));

  await test("ClaudeProvider 8: an empty text response is rejected as invalid_output, never returned as a blank success", () =>
    withFakeKey(async () => {
      const fetchImpl: ClaudeFetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "   " }], model: "claude-sonnet-4-5" }) });
      const provider = new ClaudeProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "invalid_output");
    }));
}

// ============================================================
// Section 8: OpenAIProvider adapter (mocked HTTP transport only - no live credentials exist for this project)
// ============================================================
async function openAIProviderTests(): Promise<void> {
  const withFakeKey = async (fn: () => Promise<void>): Promise<void> => {
    const saved = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-FAKE-TEST-OPENAI-KEY";
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = saved;
    }
  };

  await test("OpenAIProvider 1: constructor throws when OPENAI_API_KEY is genuinely missing, never silently degrading", async () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(() => new OpenAIProvider());
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });

  await test("OpenAIProvider 2: request messages are sent with role/content directly, no system-field split (unlike Claude)", () =>
    withFakeKey(async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const fetchImpl: OpenAIFetch = async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hello" } }], model: "gpt-4o" }) };
      };
      const provider = new OpenAIProvider({ fetchImpl });
      await provider.complete({ messages: [{ role: "system", content: "be concise" }, { role: "user", content: "hi" }] });
      const messages = capturedBody!.messages as { role: string; content: string }[];
      assert.equal(messages[0].role, "system");
      assert.equal(messages[0].content, "be concise");
    }));

  await test("OpenAIProvider 3: the parsed response content and provider name are returned correctly", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "EURUSD is discussed here." } }], model: "gpt-4o", usage: { prompt_tokens: 8, completion_tokens: 4 } }) });
      const provider = new OpenAIProvider({ fetchImpl });
      const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(result.content, "EURUSD is discussed here.");
      assert.equal(result.provider, "openai");
      assert.deepEqual(result.usage, { promptTokens: 8, completionTokens: 4 });
    }));

  await test("OpenAIProvider 4: HTTP 401/403 maps to kind 'auth'", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "auth");
    }));

  await test("OpenAIProvider 5: HTTP 429 maps to kind 'rate_limit'", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "rate_limit");
    }));

  await test("OpenAIProvider 6: a transport-level rejection maps to kind 'network'", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => { throw new Error("ECONNRESET"); };
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "network");
    }));

  await test("OpenAIProvider 7: malformed (non-JSON-parseable) response body maps to kind 'invalid_output'", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } });
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "invalid_output");
    }));

  await test("OpenAIProvider 8: an empty choices array is rejected as invalid_output, never returned as a blank success", () =>
    withFakeKey(async () => {
      const fetchImpl: OpenAIFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [], model: "gpt-4o" }) });
      const provider = new OpenAIProvider({ fetchImpl });
      await assert.rejects(provider.complete({ messages: [{ role: "user", content: "hi" }] }), (e: unknown) => e instanceof AIProviderError && e.kind === "invalid_output");
    }));

  await test("OpenAIProvider 9: optional temperature/maxTokens are omitted from the request body entirely when not supplied, never sent as fabricated defaults", () =>
    withFakeKey(async () => {
      let capturedBody: Record<string, unknown> | undefined;
      const fetchImpl: OpenAIFetch = async (_url, init) => {
        capturedBody = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hello" } }], model: "gpt-4o" }) };
      };
      const provider = new OpenAIProvider({ fetchImpl });
      await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      assert.ok(!("temperature" in capturedBody!));
      assert.ok(!("max_tokens" in capturedBody!));
    }));
}

// ============================================================
// Section 9: Multi-provider consistency (never an ensemble/voting model)
// ============================================================
async function consistencyTests(): Promise<void> {
  await test("consistency 1: every configured slot receives the exact same envelope object, never a per-provider mutated copy", async () => {
    const seenEnvelopes: IntelligenceEnvelope[] = [];
    const geminiSlot = countingSlot("gemini", true, fakePresenter("gemini", async (env) => { seenEnvelopes.push(env); throw new Error("fail to force fallthrough"); })).slot;
    const claudeSlot = countingSlot("claude", true, fakePresenter("claude", async (env) => { seenEnvelopes.push(env); return { text: goodAnswerText, presentedBy: "claude", envelopeGeneratedAt: env.generatedAt }; })).slot;
    const orchestrator = new AIPresenterOrchestratorService({ slots: [geminiSlot, claudeSlot] });
    await orchestrator.present(goodEnvelope, "q");
    assert.equal(seenEnvelopes.length, 2);
    assert.equal(seenEnvelopes[0], goodEnvelope);
    assert.equal(seenEnvelopes[1], goodEnvelope);
  });

  await test("consistency 2: GeminiIntelligencePresenter is reused generically for a Claude-injected provider - no separate ClaudeIntelligencePresenter class exists", () => {
    const provider: AIProvider = { name: "claude", complete: async () => ({ content: "x", model: "claude-sonnet-4-5", provider: "claude" }) };
    const presenter = new GeminiIntelligencePresenter({ provider });
    assert.equal(presenter.name, "claude", "the presenter reports the real injected provider's name, proving it is provider-generic, not Gemini-specific");
  });
}

// ============================================================
// Section 10: Live Gemini smoke test (self-skips honestly if no key)
// ============================================================
async function liveSmokeTest(): Promise<void> {
  const hasKey = typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
  if (!hasKey) {
    console.log("  skip - live Gemini smoke test (GEMINI_API_KEY not set in this environment - never substituting a fake 'live test passed')");
    return;
  }
  await test("live: a real Gemini call through the default orchestrator slot succeeds and passes integrity validation", async () => {
    const orchestrator = new AIPresenterOrchestratorService({ slots: [DEFAULT_PRESENTER_SLOTS[0]], fallback: new DeterministicSafeFallbackPresenter() });
    const result = await orchestrator.present(goodEnvelope, "What is the current state of EURUSD?");
    assert.ok(result.text.trim().length > 0);
    assert.equal(result.attempts[0].provider, "gemini");
    assert.ok(result.attempts[0].success === true || result.fallbackUsed === true, "either the real Gemini call passed integrity, or the pipeline honestly fell back - never a crash");
  });
}

async function main(): Promise<void> {
  await availabilityTests();
  await fallbackChainTests();
  await integrityGatingTests();
  await contextPreservationTests();
  await securityTests();
  await determinismAndObservabilityTests();
  await claudeProviderTests();
  await openAIProviderTests();
  await consistencyTests();
  await liveSmokeTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
