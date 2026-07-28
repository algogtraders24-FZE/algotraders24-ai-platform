// scripts/validate-market-intelligence-pipeline.ts
// Sprint 15D.8 - Standalone validation for the Intelligence Integration
// Pipeline (MarketIntelligencePipelineService). No test framework exists in
// this project; run via `npm run validate:intelligence-pipeline`.
//
// Pure Node, no DB, no real network, no AI call. The provider is a
// hand-built test double (structurally satisfying MarketDataProvider) so
// this never depends on Alpha Vantage or any live vendor - the pipeline
// itself is the thing under test, not any one provider implementation.
// Every downstream stage (evidence collection/ranking, reasoning, risk,
// confidence) is the real, unmodified Sprint 15D.4-15D.7 service.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Clock } from "../lib/market-data/cache";
import type { MarketDataProvider, MarketContextResult } from "../types/market-data-provider";
import { MarketDataProviderUnavailableError } from "../types/market-data-provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketIntelligenceOutcome } from "../types/market-intelligence-result";
import {
  MarketIntelligencePipelineService,
  MARKET_INTELLIGENCE_PIPELINE_VERSION,
} from "../services/ai/market-intelligence-pipeline.service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok - ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
    });
}

const T1 = "2026-01-01T00:00:00.000Z";

function makeClock(sequence: number[]): Clock {
  return {
    now: () => {
      const value = sequence.shift();
      if (value === undefined) throw new Error("test clock sequence exhausted");
      return value;
    },
  };
}

function sampleRaw(overrides: Partial<MarketContextResult> = {}): MarketContextResult {
  return {
    symbol: "XAUUSD",
    provider: "fake-provider",
    retrievedAt: T1,
    evidence: [{ claim: "Spot price: 2685.4000 USD", source: "fake-provider", asOf: T1 }],
    headlines: ["Gold rallies on rate-cut bets"],
    ...overrides,
  };
}

function fakeProvider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    name: "fake-provider",
    isConfigured: () => true,
    getMarketContext: async () => sampleRaw(),
    ...overrides,
  };
}

function expectCompleted(outcome: MarketIntelligenceOutcome) {
  assert.equal(outcome.status, "completed", `expected "completed", got "${outcome.status}"`);
  return (outcome as Extract<MarketIntelligenceOutcome, { status: "completed" }>).result;
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Real pipeline integration
  // ---------------------------------------------------------------------
  await test("integrates evidence/reasoning/risk/confidence engines end to end from one provider call", async () => {
    const service = new MarketIntelligencePipelineService(fakeProvider());
    const result = expectCompleted(await service.run({ symbol: "XAUUSD" }));
    assert.equal(result.symbol, "XAUUSD");
    assert.ok(result.evidence.items.length > 0, "evidence collected from the raw provider result");
    assert.ok(result.evidence.items.some((i) => i.type === "news"), "the raw headline was collected as news evidence");
    assert.equal(result.reasoning.symbol, "XAUUSD");
    assert.equal(result.risk.categories.length, 8, "RiskEngineService's 8 categories");
    assert.equal(result.confidence.categories.length, 7, "ConfidenceEngineService's 7 categories");
  });

  await test("the same generatedAt threads through evidence, reasoning, risk, confidence, and metadata", async () => {
    const service = new MarketIntelligencePipelineService(fakeProvider());
    const result = expectCompleted(await service.run({ symbol: "XAUUSD" }));
    assert.equal(result.evidence.generatedAt, T1);
    assert.equal(result.reasoning.generatedAt, T1);
    assert.equal(result.risk.generatedAt, T1);
    assert.equal(result.confidence.generatedAt, T1);
    assert.equal(result.metadata.generatedAt, T1);
  });

  // ---------------------------------------------------------------------
  // Deterministic execution
  // ---------------------------------------------------------------------
  await test("determinism: two independent runs with identical inputs and clocks produce a deep-equal result", async () => {
    const runOnce = () => {
      const service = new MarketIntelligencePipelineService(
        fakeProvider(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        makeClock([5000, 5040]),
      );
      return service.run({ symbol: "XAUUSD" });
    };
    const first = await runOnce();
    const second = await runOnce();
    assert.deepEqual(first, second);
  });

  // ---------------------------------------------------------------------
  // Immutable output
  // ---------------------------------------------------------------------
  await test("immutable: the completed result and everything nested in it is deep-frozen", async () => {
    const service = new MarketIntelligencePipelineService(fakeProvider());
    const result = expectCompleted(await service.run({ symbol: "XAUUSD" }));
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.metadata));
    assert.ok(Object.isFrozen(result.evidence));
    assert.ok(Object.isFrozen(result.evidence.items));
    assert.ok(Object.isFrozen(result.evidence.items[0]));
    assert.ok(Object.isFrozen(result.risk.categories));
    assert.ok(Object.isFrozen(result.confidence.categories));

    assert.throws(() => {
      (result as unknown as { symbol: string }).symbol = "OTHER";
    });
    assert.throws(() => {
      (result.metadata as unknown as { executionTimeMs: number }).executionTimeMs = 999;
    });
    assert.throws(() => {
      (result.evidence.items as unknown as unknown[]).push({});
    });
    assert.throws(() => {
      (result.risk.categories[0] as unknown as { level: string }).level = "high";
    });
    assert.throws(() => {
      (result.confidence.categories[0] as unknown as { score: number }).score = 0;
    });
  });

  // ---------------------------------------------------------------------
  // Metadata correctness
  // ---------------------------------------------------------------------
  await test("metadata: pipelineVersion, providerStatus, executionTimeMs, and generatedAt are all correct", async () => {
    const service = new MarketIntelligencePipelineService(
      fakeProvider(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      makeClock([2000, 2075]),
    );
    const result = expectCompleted(await service.run({ symbol: "XAUUSD" }));
    assert.equal(result.metadata.pipelineVersion, MARKET_INTELLIGENCE_PIPELINE_VERSION);
    assert.deepEqual(result.metadata.providerStatus, { status: "ok", provider: "fake-provider" });
    assert.equal(result.metadata.executionTimeMs, 75);
    assert.equal(result.metadata.generatedAt, T1);
  });

  // ---------------------------------------------------------------------
  // Provider unavailable
  // ---------------------------------------------------------------------
  await test("provider-unavailable: no provider injected (the default) never makes a live call", async () => {
    const service = new MarketIntelligencePipelineService();
    const outcome = await service.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "provider-unavailable");
    if (outcome.status === "provider-unavailable") assert.equal(outcome.provider, "none");
  });

  await test("provider-unavailable: an injected but unconfigured provider is reported by name", async () => {
    const provider = fakeProvider({ name: "unconfigured-provider", isConfigured: () => false });
    const service = new MarketIntelligencePipelineService(provider);
    const outcome = await service.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "provider-unavailable");
    if (outcome.status === "provider-unavailable") assert.equal(outcome.provider, "unconfigured-provider");
  });

  await test("provider-unavailable: a provider that throws MarketDataProviderUnavailableError mid-call is still classified correctly", async () => {
    const provider = fakeProvider({
      isConfigured: () => true,
      getMarketContext: async () => {
        throw new MarketDataProviderUnavailableError("flaky-provider");
      },
    });
    const service = new MarketIntelligencePipelineService(provider);
    const outcome = await service.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "provider-unavailable");
  });

  await test("provider-error: a typed MarketDataProviderError (e.g. rate limit) is reported, never disguised as success", async () => {
    const provider = fakeProvider({
      getMarketContext: async () => {
        throw new MarketDataProviderError("rate_limit", "Alpha Vantage rate limit: too many requests", "fake-provider");
      },
    });
    const service = new MarketIntelligencePipelineService(provider);
    const outcome = await service.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "provider-error");
    if (outcome.status === "provider-error") {
      assert.equal(outcome.provider, "fake-provider");
      assert.ok(outcome.reason.includes("rate limit"));
    }
  });

  // ---------------------------------------------------------------------
  // Failure propagation
  // ---------------------------------------------------------------------
  await test("failure propagation: an unexpected, untyped provider error is never swallowed into a fake result", async () => {
    const boom = new Error("unexpected network explosion");
    const provider = fakeProvider({
      getMarketContext: async () => {
        throw boom;
      },
    });
    const service = new MarketIntelligencePipelineService(provider);
    await assert.rejects(() => service.run({ symbol: "XAUUSD" }), (err: unknown) => err === boom);
  });

  // ---------------------------------------------------------------------
  // Structural: no AI/UI coupling, orchestration-only
  // ---------------------------------------------------------------------
  await test("structural: the pipeline's import statements never reach into lib/ai, the Gemini SDK, or mock data", () => {
    const files = [
      "types/market-intelligence-result.ts",
      "services/ai/market-intelligence-pipeline.service.ts",
    ];
    const forbidden = [
      "lib/ai",
      "@google/genai",
      "data/mock",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
      "market-intelligence.service",
      "market-analysis-orchestration.service",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(
          !importLines.some((line) => line.includes(needle)),
          `${file} must not import from anything matching "${needle}"`,
        );
      }
    }
  });

  await test("structural: the frozen Sprint 15C chat route has zero coupling to the intelligence pipeline", () => {
    const source = readFileSync(new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url), "utf8");
    assert.ok(!source.includes("market-intelligence-pipeline"), "chat route must not import the pipeline");
    assert.ok(!source.includes("MarketIntelligencePipelineService"), "chat route must not reference the pipeline class");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
