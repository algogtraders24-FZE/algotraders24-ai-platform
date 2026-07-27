// scripts/validate-market-intelligence-foundation.ts
// Sprint 15D.1 - Standalone validation for the Market Intelligence Domain
// Foundation: MarketDataProvider abstraction, MarketContextService,
// AnalysisRunService, and the reactivated (composed, not rewritten) intent
// scaffold. No test framework exists in this project; run via
// `npm run validate:market-foundation`.
//
// Pure Node, no DB, no network, no fetch mocking needed: everything here
// is in-memory by design (no Prisma model exists yet for AnalysisRun, and
// no concrete MarketDataProvider exists yet - this is the abstraction-only
// slice). "Self-cleaning" is automatic: every test constructs its own
// fresh service/store instance, so there is no shared state to clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  MarketDataProvider,
  MarketContextRequest,
  MarketContextResult,
} from "../types/market-data-provider";
import { MarketDataProviderUnavailableError } from "../types/market-data-provider";
import { MarketContextService } from "../services/ai/market-context.service";
import { AnalysisRunService } from "../services/ai/analysis-run.service";
import { resolvePromptRouting } from "../services/ai/prompts/resolve-routing.service";
import type { MarketContext } from "../types/market-context";

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

// Fixed timestamps so determinism assertions are byte-exact, not just
// "close enough" - a real provider will vary these, but this test double
// must not, to prove the SERVICE's mapping is deterministic.
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

// A fake provider used only inside this validation script - not a real
// vendor, not wired into any production path.
class FakeProvider implements MarketDataProvider {
  readonly name = "fake-test-provider";
  private readonly configured: boolean;
  private readonly result: Omit<MarketContextResult, "symbol">;

  constructor(configured: boolean, result: Omit<MarketContextResult, "symbol">) {
    this.configured = configured;
    this.result = result;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { ...this.result, symbol: request.symbol };
  }
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // A: provider interface contract shape
  // ---------------------------------------------------------------------
  await test("MarketDataProvider contract: a minimal implementation satisfies the interface shape", () => {
    const provider: MarketDataProvider = {
      name: "shape-check",
      isConfigured: () => false,
      getMarketContext: async (req) => ({
        symbol: req.symbol,
        provider: "shape-check",
        retrievedAt: FIXED_TIME,
        evidence: [],
      }),
    };
    assert.equal(typeof provider.name, "string");
    assert.equal(typeof provider.isConfigured, "function");
    assert.equal(typeof provider.getMarketContext, "function");
  });

  // ---------------------------------------------------------------------
  // C: no configured provider -> throws, never fabricates
  // ---------------------------------------------------------------------
  await test("no provider configured: getMarketContext throws MarketDataProviderUnavailableError, never fabricates a context", async () => {
    const service = new MarketContextService(); // no provider at all
    await assert.rejects(
      () => service.getMarketContext({ symbol: "XAUUSD" }),
      MarketDataProviderUnavailableError,
    );
  });

  await test("a provider that reports isConfigured() === false also throws, never fabricates", async () => {
    const service = new MarketContextService(new FakeProvider(false, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] }));
    await assert.rejects(
      () => service.getMarketContext({ symbol: "EURUSD" }),
      MarketDataProviderUnavailableError,
    );
  });

  // ---------------------------------------------------------------------
  // C: deterministic, bounded context behavior
  // ---------------------------------------------------------------------
  await test("deterministic: identical provider output produces byte-identical MarketContext across two calls", async () => {
    const provider = new FakeProvider(true, {
      provider: "fake-test-provider",
      retrievedAt: FIXED_TIME,
      trend: "bullish",
      evidence: [{ claim: "Price broke above resistance", source: "fake-test-provider", asOf: FIXED_TIME }],
    });
    const service = new MarketContextService(provider);
    const first = await service.getMarketContext({ symbol: "XAUUSD" });
    const second = await service.getMarketContext({ symbol: "XAUUSD" });
    assert.deepEqual(first, second);
  });

  await test("bounded: confidence score never exceeds 100 regardless of evidence volume", async () => {
    const manyEvidence = Array.from({ length: 10 }, (_, i) => ({
      claim: `fact ${i}`,
      source: "fake-test-provider",
      asOf: FIXED_TIME,
    }));
    const provider = new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: manyEvidence });
    const service = new MarketContextService(provider);
    const context = await service.getMarketContext({ symbol: "BTCUSD" });
    assert.ok(context.confidence.score <= 100);
    assert.equal(context.confidence.basis.length, 10);
  });

  // ---------------------------------------------------------------------
  // C: no fabricated market data
  // ---------------------------------------------------------------------
  await test("no fabrication: fields the provider did not supply stay absent, never a guessed default", async () => {
    const provider = new FakeProvider(true, {
      provider: "fake-test-provider",
      retrievedAt: FIXED_TIME,
      trend: "bullish", // supplied
      // volatility, liquidity, riskLevel, sentiment, technicalSummary, riskNotes, headlines: deliberately omitted
      evidence: [{ claim: "Momentum is up", source: "fake-test-provider", asOf: FIXED_TIME }],
    });
    const service = new MarketContextService(provider);
    const context: MarketContext = await service.getMarketContext({ symbol: "XAUUSD" });

    assert.equal(context.state.trend, "bullish", "supplied field must pass through unchanged");
    assert.equal(context.state.volatility, undefined, "unsupplied field must stay absent, not defaulted");
    assert.equal(context.state.liquidity, undefined);
    assert.equal(context.risk.level, undefined);
    assert.equal(context.risk.notes, undefined);
    assert.equal(context.sentiment, undefined);
    assert.equal(context.technical.summary, undefined);
    assert.deepEqual(context.news.headlines, [], "no headlines supplied means an empty list, not fabricated ones");
  });

  await test("no fabrication: zero evidence produces zero confidence, not a placeholder score", async () => {
    const provider = new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] });
    const service = new MarketContextService(provider);
    const context = await service.getMarketContext({ symbol: "USDJPY" });
    assert.equal(context.confidence.score, 0);
    assert.deepEqual(context.confidence.basis, []);
  });

  // ---------------------------------------------------------------------
  // E: AnalysisRun domain shape + ownership
  // ---------------------------------------------------------------------
  await test("AnalysisRun: starts pending with no context/summary, then completes", async () => {
    const service = new AnalysisRunService();
    const run = await service.startRun("user-1", "XAUUSD");
    assert.equal(run.status, "pending");
    assert.equal(run.context, null);
    assert.equal(run.summary, null);
    assert.equal(run.completedAt, null);

    const fakeContext: MarketContext = {
      symbol: "XAUUSD",
      state: { symbol: "XAUUSD", trend: "bullish", evidence: [] },
      technical: { symbol: "XAUUSD", evidence: [] },
      news: { symbol: "XAUUSD", headlines: [], evidence: [] },
      risk: { symbol: "XAUUSD", evidence: [] },
      confidence: { score: 40, basis: [] },
      generatedAt: FIXED_TIME,
    };
    const completed = await service.completeRun(run.id, "user-1", fakeContext, "Bullish bias, evidence-backed.");
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.summary, "Bullish bias, evidence-backed.");
    assert.deepEqual(completed?.context, fakeContext);
    assert.ok(completed?.completedAt);
  });

  await test("AnalysisRun: markUnavailable records the reason without a fabricated summary", async () => {
    const service = new AnalysisRunService();
    const run = await service.startRun("user-1", "BTCUSD");
    const updated = await service.markUnavailable(run.id, "user-1", "No market data provider is configured.");
    assert.equal(updated?.status, "unavailable");
    assert.equal(updated?.summary, "No market data provider is configured.");
    assert.equal(updated?.context, null);
  });

  await test("AnalysisRun: a different user cannot read or update another user's run", async () => {
    const service = new AnalysisRunService();
    const run = await service.startRun("owner", "EURUSD");

    const foreignRead = await service.getRun(run.id, "stranger");
    assert.equal(foreignRead, null);

    const foreignUpdate = await service.markUnavailable(run.id, "stranger", "injected");
    assert.equal(foreignUpdate, null);

    const ownerRead = await service.getRun(run.id, "owner");
    assert.equal(ownerRead?.status, "pending", "a rejected foreign update must not have changed anything");
  });

  await test("AnalysisRun: empty userId/symbol are rejected", async () => {
    const service = new AnalysisRunService();
    await assert.rejects(() => service.startRun("", "XAUUSD"));
    await assert.rejects(() => service.startRun("user-1", ""));
  });

  // ---------------------------------------------------------------------
  // D: dormant intent scaffold remains discoverable
  // ---------------------------------------------------------------------
  await test("dormant intent scaffold is discoverable via resolvePromptRouting (one call, not four)", () => {
    const result = resolvePromptRouting("Can you analyze gold XAUUSD for me?");
    assert.equal(result.intent, "market-analysis");
    assert.equal(result.persona.id, "trading-analyst");
    assert.equal(result.schema.id, "market-analysis");
    assert.ok(result.template.length > 0);
  });

  await test("dormant intent scaffold: risk-analysis intent resolves to the risk-manager persona", () => {
    const result = resolvePromptRouting("What's my risk if I use 2% position size?");
    assert.equal(result.intent, "risk-analysis");
    assert.equal(result.persona.id, "risk-manager");
  });

  await test("dormant intent scaffold: unrecognized input falls back to general-chat", () => {
    const result = resolvePromptRouting("hello there");
    assert.equal(result.intent, "general-chat");
    assert.equal(result.persona.id, "general-assistant");
  });

  // ---------------------------------------------------------------------
  // F: no changes to Sprint 15C route behavior (structural)
  // ---------------------------------------------------------------------
  await test("structural: the frozen Sprint 15C chat route has no coupling to any Sprint 15D.1 file", () => {
    const source = readFileSync(
      new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url),
      "utf8",
    );
    const forbidden = ["market-context", "market-data-provider", "analysis-run", "resolve-routing"];
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), `chat route must not import ${needle} - Sprint 15C behavior is frozen`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
