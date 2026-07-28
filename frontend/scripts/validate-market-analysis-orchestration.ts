// scripts/validate-market-analysis-orchestration.ts
// Sprint 15D.2 - Standalone validation for MarketAnalysisOrchestrationService.
// Sprint 15D.10 - Rewritten: the service now wires through
// MarketIntelligencePipelineService (Sprint 15D.8, itself chaining the
// real, unmodified Evidence/Reasoning/Risk/Confidence engines) and
// ExplainableAnalysisService (Sprint 15D.9) instead of MarketContextService
// directly, and Gemini is now given only the resulting ExplainableAnalysis.
// No test framework exists in this project; run via
// `npm run validate:market-orchestration`.
//
// Pure Node, no DB, no network: the two external dependencies
// (MarketDataProvider, the AI completer) are both controlled, in-memory
// test doubles defined ONLY in this file - never imported by any
// production service. "Self-cleaning" is automatic: every test constructs
// its own fresh AnalysisRunService/store, so there is no shared state to
// clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AIService } from "../lib/ai";
import { AIProviderError } from "../lib/ai";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import { MarketIntelligencePipelineService } from "../services/ai/market-intelligence-pipeline.service";
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
      evidence: [{ claim: "Spot price: 2685.4000 USD", source: "fake-test-provider", asOf: FIXED_TIME }],
    };
    const makeOrchestrator = () =>
      new MarketAnalysisOrchestrationService(
        new MarketIntelligencePipelineService(new FakeProvider(true, providerResult)),
        undefined,
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
    const orchestrator = new MarketAnalysisOrchestrationService(); // default: no provider configured anywhere in the pipeline
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "provider-unavailable");
    if (outcome.status === "provider-unavailable") {
      assert.equal(outcome.run.status, "unavailable");
      assert.equal(outcome.run.context, null);
    }
  });

  // ---------------------------------------------------------------------
  // 2b: a configured provider that errors is distinguished from "unavailable"
  // ---------------------------------------------------------------------
  await test("2b: a configured provider that returns a typed error is reported as provider-error, never disguised as success", async () => {
    const erroringProvider: MarketDataProvider = {
      name: "fake-test-provider",
      isConfigured: () => true,
      getMarketContext: async () => {
        throw new MarketDataProviderError("rate_limit", "Alpha Vantage rate limit: too many requests", "fake-test-provider");
      },
    };
    const orchestrator = new MarketAnalysisOrchestrationService(new MarketIntelligencePipelineService(erroringProvider));
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "provider-error");
    if (outcome.status === "provider-error") {
      assert.equal(outcome.run.status, "failed");
      assert.ok(outcome.reason.includes("rate limit"));
    }
  });

  // ---------------------------------------------------------------------
  // 3: no mock dashboard data is imported, and MarketContextService is no
  // longer this service's data path (rewired to the 15D.8 pipeline)
  // ---------------------------------------------------------------------
  await test("3: the orchestration service never imports mock dashboard/market data, and no longer uses MarketContextService directly", () => {
    const source = readFileSync(
      new URL("../services/ai/market-analysis-orchestration.service.ts", import.meta.url),
      "utf8",
    );
    const forbidden = [
      "data/mock",
      "data/market-intelligence",
      "data/signals",
      "market-intelligence.service",
      "services/ai/trading/",
      "services/ai/providers/",
    ];
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const needle of forbidden) {
      assert.ok(!importLines.some((line) => line.includes(needle)), `orchestration service must not import ${needle}`);
    }
    assert.ok(!importLines.some((line) => line.includes("./market-context.service")), "must no longer import MarketContextService directly");
    assert.ok(importLines.some((line) => line.includes("market-intelligence-pipeline.service")), "must wire through the 15D.8 pipeline");
    assert.ok(importLines.some((line) => line.includes("explainable-analysis.service")), "must wire through the 15D.9 explainer");
  });

  // ---------------------------------------------------------------------
  // 4: no fabricated market fields are added to the prompt
  // ---------------------------------------------------------------------
  await test("4: the AI prompt is built only from ExplainableAnalysis - real claims pass through, absences are stated explicitly", async () => {
    const fakeAI = new FakeAI({ content: "Limited analysis due to missing data." });
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketIntelligencePipelineService(
        new FakeProvider(true, {
          provider: "fake-test-provider",
          retrievedAt: FIXED_TIME,
          trend: "bearish", // only trend + one evidence claim supplied
          evidence: [{ claim: "Momentum turning down", source: "fake-test-provider", asOf: FIXED_TIME }],
        }),
      ),
      undefined,
      new AnalysisRunService(),
      fakeAI,
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "completed");
    assert.ok(fakeAI.lastPrompt.includes("Momentum turning down"), "supplied evidence claim must appear as-is");
    assert.ok(fakeAI.lastPrompt.includes("Trend: bearish"), "supplied trend claim must appear as-is");
    assert.ok(fakeAI.lastPrompt.includes("No news evidence was available"), "a genuinely absent evidence type must be stated, never invented");
    assert.ok(
      fakeAI.lastPrompt.includes("never invent a price, direction, headline, or conclusion"),
      "the model must be explicitly told not to fabricate",
    );

    if (outcome.status === "completed") {
      assert.equal(outcome.result.explainable.marketThesis, "Price evidence for XAUUSD is consistent: Momentum turning down.");
    }
  });

  // ---------------------------------------------------------------------
  // 5: routing is resolved through the existing scaffold
  // ---------------------------------------------------------------------
  await test("5: intent/persona routing is actually resolved through the existing dormant scaffold", async () => {
    const orchestrator = new MarketAnalysisOrchestrationService(
      new MarketIntelligencePipelineService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      undefined,
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
      new MarketIntelligencePipelineService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      undefined,
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
      new MarketIntelligencePipelineService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      undefined,
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
      new MarketIntelligencePipelineService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      undefined,
      analysisRuns,
      new FakeAI({ content: "Analysis text." }),
    );
    const outcome = await orchestrator.analyze(baseRequest());
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      const persisted = await analysisRuns.getRun(outcome.run.id, "user-1");
      assert.equal(persisted?.status, "completed");
      assert.ok(persisted?.completedAt);
      assert.ok(persisted?.context, "the AnalysisRun bridge context must be populated on completion");
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
      new MarketIntelligencePipelineService(new FakeProvider(true, { provider: "fake-test-provider", retrievedAt: FIXED_TIME, evidence: [] })),
      undefined,
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
      "market-intelligence-pipeline",
      "explainable",
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
