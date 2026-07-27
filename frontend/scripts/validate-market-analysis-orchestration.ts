// scripts/validate-market-analysis-orchestration.ts
// Sprint 15D.2 - Standalone validation for MarketAnalysisOrchestrationService.
// No test framework exists in this project; run via
// `npm run validate:market-orchestration`.
//
// Pure Node, no DB, no network: the two external dependencies
// (MarketDataProvider, the AI completer) are both controlled, in-memory
// test doubles defined ONLY in this file - never imported by any
// production service (see services/ai/market-analysis-orchestration
// .service.ts and services/ai/market-context.service.ts, neither of which
// reference this file). "Self-cleaning" is automatic: every test
// constructs its own fresh AnalysisRunService/store, so there is no shared
// state to clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AIService } from "../lib/ai";
import { AIProviderError } from "../lib/ai";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import { MarketContextService } from "../services/ai/market-context.service";
import { AnalysisRunService } from "../services/ai/analysis-run.service";
import { MarketAnalysisOrchestrationService } from "../services/ai/market-analysis-orchestration.service";
import type { MarketAnalysisRequest } from "../types/market-analysis-orchestration";

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

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

// Controlled in-memory market data test double. Only ever constructed
// inside this script - not exported, not imported by production code.
class FakeProvider implements MarketDataProvider {
  readonly name = "fake-test-provider";
  constructor(
    private readonly configured: boolean,
    private readonly result: Omit<MarketContextResult, "symbol">,
  ) {}
  isConfigured(): boolean {
    return this.configured;
  }
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { ...this.result, symbol: request.symbol };
  }
}

// Controlled in-memory AI test double, satisfying Pick<AIService,
// "complete"> - never a real network call. Captures the last prompt it
// received so tests can assert on prompt construction without reaching
// into the orchestrator's private buildPrompt method.
class FakeAI implements Pick<AIService, "complete"> {
  lastPrompt = "";
  constructor(private readonly behavior: { content?: string; throws?: unknown }) {}
  async complete(prompt: string) {
    this.lastPrompt = prompt;
    if (this.behavior.throws) throw this.behavior.throws;
    return { content: this.behavior.content ?? "", model: "fake-model", provider: "fake-ai" };
  }
}

function baseRequest(overrides: Partial<MarketAnalysisRequest> = {}): MarketAnalysisRequest {
  return { userId: "user-1", symbol: "XAUUSD", question: "Analyze gold XAUUSD for me", ...overrides };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: valid request + controlled provider -> deterministic output
  // ---------------------------------------------------------------------
  await test("1: a valid request with a controlled provider produces deterministic analysis content across two runs", async () => {
    const providerResult: Omit<MarketContextResult, "symbol"> = {
      provider: "fake-test-provider",
      retrievedAt: FIXED_TIME,
      trend: "bullish",
      evidence: [{ claim: "Price broke resistance", source: "fake-test-provider", asOf: FIXED_TIME }],
    };
    const makeOrchestrator = () =>
      new MarketAnalysisOrchestrationService(
        new MarketContextService(new FakeProvider(true, providerResult)),
        new AnalysisRunService(),
        new FakeAI({ content: "Bullish bias based on available evidence." }),
      );

    const first = await makeOrchestrator().analyze(baseRequest());
    const second = await makeOrchestrator().analyze(baseRequest());
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
    if (first.status === "completed" && second.status === "completed") {
      assert.deepEqual(first.result, second.result, "analysis content must be deterministic for identical inputs");
    }
  });

  // ---------------------------------------------------------------------
  // 2: unavailable provider never produces an analysis
  // ---------------------------------------------------------------------
  await test("2: an unavailable provider never produces a completed analysis", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService(); // default: no provider configured
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "provider-unavailable");
    if (outcome.status === "provider-unavailable") {
      assert.equal(outcome.run.status, "unavailable");
      assert.equal(outcome.run.context, null);
    }
  });

  // ---------------------------------------------------------------------
  // 3: no mock dashboard data is imported
  // ---------------------------------------------------------------------
  await test("3: the orchestration service never imports mock dashboard/market data", () => {
    const source = readFileSync(
      new URL("../services/ai/market-analysis-orchestration.service.ts", import.meta.url),
      "utf8",
    );
    const forbidden = ["data/mock", "data/market-intelligence", "data/signals", "market-intelligence.service", "services/ai/trading/", "services/ai/providers/"];
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), `orchestration service must not reference ${needle}`);
    }
  });

  // ---------------------------------------------------------------------
  // 4: no fabricated market fields are added
  // ---------------------------------------------------------------------
  await test("4: missing context fields are stated as unavailable in the AI prompt, never guessed", async () => {
    const fakeAI = new FakeAI({ content: "Limited analysis due to missing data." });
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(
        new FakeProvider(true, {
          provider: "fake-test-provider",
          retrievedAt: FIXED_TIME,
          trend: "bearish", // only trend supplied
          evidence: [{ claim: "Momentum turning down", source: "fake-test-provider", asOf: FIXED_TIME }],
        }),
      ),
      new AnalysisRunService(),
      fakeAI,
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "completed");
    assert.ok(fakeAI.lastPrompt.includes("Trend: bearish"), "supplied field must appear as-is");
    assert.ok(fakeAI.lastPrompt.includes("Volatility: unavailable"), "unsupplied field must be marked unavailable");
    assert.ok(fakeAI.lastPrompt.includes("Liquidity: unavailable"));
    assert.ok(fakeAI.lastPrompt.includes("Risk level: unavailable"));
    assert.ok(fakeAI.lastPrompt.includes("Recent headlines: none available"));
    assert.ok(fakeAI.lastPrompt.includes("Never invent specific prices"), "the model must be explicitly told not to fabricate");

    if (outcome.status === "completed") {
      assert.deepEqual(outcome.result.evidence, [{ claim: "Momentum turning down", source: "fake-test-provider", asOf: FIXED_TIME }]);
    }
  });

  // ---------------------------------------------------------------------
  // 5: routing is resolved through the existing scaffold
  // ---------------------------------------------------------------------
  await test("5: intent/persona routing is actually resolved through the existing dormant scaffold", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      new AnalysisRunService(),
      new FakeAI({ content: "Analysis text." }),
    );
    const outcome = await orchestrator.analyze(baseRequest({ question: "Analyze gold XAUUSD for me" }));
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      assert.equal(outcome.result.intent, "market-analysis");
    }
  });

  // ---------------------------------------------------------------------
  // 6: AI failure is represented explicitly
  // ---------------------------------------------------------------------
  await test("6: an AI provider error is represented as ai-failed, never as a completed analysis", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      new AnalysisRunService(),
      new FakeAI({ throws: new AIProviderError("network", "simulated network failure", "fake-ai") }),
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "ai-failed");
    if (outcome.status === "ai-failed") {
      assert.equal(outcome.run.status, "failed");
    }
  });

  await test("6b: an empty AI response is treated as a failure, not a blank success", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      new AnalysisRunService(),
      new FakeAI({ content: "   " }),
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "ai-failed");
  });

  // ---------------------------------------------------------------------
  // 7: AnalysisRun lifecycle is correct
  // ---------------------------------------------------------------------
  await test("7: AnalysisRun transitions pending -> completed on success", async () => {
    const analysisRuns = new AnalysisRunService();
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      analysisRuns,
      new FakeAI({ content: "Analysis text." }),
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      const persisted = await analysisRuns.getRun(outcome.run.id, "user-1");
      assert.equal(persisted?.status, "completed");
      assert.ok(persisted?.completedAt);
    }
  });

  await test("7b: an invalid request never creates an AnalysisRun at all", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService();
    const outcome = await orchestrator.analyze(baseRequest({ symbol: "" }));
    assert.equal(outcome.status, "invalid-request");
    assert.ok(!("run" in outcome));
  });

  // ---------------------------------------------------------------------
  // 8: ownership boundaries remain correct
  // ---------------------------------------------------------------------
  await test("8: a different user cannot read another user's AnalysisRun through the shared service", async () => {
    const analysisRuns = new AnalysisRunService();
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketContextService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      analysisRuns,
      new FakeAI({ content: "Analysis text." }),
    );
    const outcome = await orchestrator.analyze(baseRequest({ userId: "owner" }));
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      const foreignRead = await analysisRuns.getRun(outcome.run.id, "stranger");
      assert.equal(foreignRead, null);
    }
  });

  // ---------------------------------------------------------------------
  // 9: existing 15C chat route remains structurally untouched
  // ---------------------------------------------------------------------
  await test("9: the frozen Sprint 15C chat route has zero coupling to any Sprint 15D file", () => {
    const source = readFileSync(
      new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "market-context",
      "market-data-provider",
      "analysis-run",
      "resolve-routing",
      "market-analysis-orchestration",
    ];
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
