// scripts/validate-alpha-vantage-provider.ts
// Sprint 15D.3A - Standalone validation for the Alpha Vantage
// MarketDataProvider adapter, plus an integration check through the real
// MarketContextService, and (Sprint 15D.10) through the real
// MarketIntelligencePipelineService + MarketAnalysisOrchestrationService,
// which no longer uses MarketContextService as its data path. No test
// framework exists in this project; run via
// `npm run validate:alpha-vantage`.
//
// No real network call is ever made: the HTTP transport is a controlled
// fake injected via AlphaVantageProviderOptions.fetchImpl, and cache
// timing is controlled via an injectable Clock - both are the exact
// dependency-injection points the provider was built with for this
// purpose. "Self-cleaning" here means: the one test that manipulates
// process.env.ALPHA_VANTAGE_API_KEY restores it in a finally block, and
// every other test constructs its own fresh provider/cache/service
// instances, so there is no shared state to clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AlphaVantageProvider,
  type AlphaVantageFetch,
} from "../lib/market-data/providers/alpha-vantage.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { Clock } from "../lib/market-data/cache";
import { MarketContextService } from "../services/ai/market-context.service";
import { MarketDataProviderUnavailableError } from "../types/market-data-provider";
import { MarketIntelligencePipelineService } from "../services/ai/market-intelligence-pipeline.service";
import { MarketAnalysisOrchestrationService } from "../services/ai/market-analysis-orchestration.service";
import { AnalysisRunService } from "../services/ai/analysis-run.service";
import type { AIService } from "../lib/ai";

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

const TEST_API_KEY = "test-key-not-real";

async function withApiKey<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = process.env.ALPHA_VANTAGE_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = TEST_API_KEY;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = original;
  }
}

function fakeClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

function makeFetch(status: number, body: unknown): { fetchImpl: AlphaVantageFetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: AlphaVantageFetch = async (url: string) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

function successBody(overrides: Partial<Record<string, string>> = {}) {
  return {
    "Realtime Currency Exchange Rate": {
      "1. From_Currency Code": "XAU",
      "2. From_Currency Name": "Gold",
      "3. To_Currency Code": "USD",
      "4. To_Currency Name": "United States Dollar",
      "5. Exchange Rate": "2685.4000",
      "6. Last Refreshed": "2026-01-15 20:00:01",
      "7. Time Zone": "UTC",
      "8. Bid Price": "2685.3000",
      "9. Ask Price": "2685.5000",
      ...overrides,
    },
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1/2: symbol mapping
  // ---------------------------------------------------------------------
  await test("1: XAUUSD maps to provider symbol XAU in the outgoing request", async () => {
    await withApiKey(async () => {
      const { fetchImpl, calls } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.ok(calls[0].includes("from_currency=XAU"));
    });
  });

  await test("2: XAGUSD maps to provider symbol XAG in the outgoing request", async () => {
    await withApiKey(async () => {
      const { fetchImpl, calls } = makeFetch(200, successBody({ "1. From_Currency Code": "XAG" }));
      const provider = new AlphaVantageProvider({ fetchImpl });
      await provider.getMarketContext({ symbol: "XAGUSD" });
      assert.ok(calls[0].includes("from_currency=XAG"));
    });
  });

  // ---------------------------------------------------------------------
  // 3: unsupported symbol rejected
  // ---------------------------------------------------------------------
  await test("3: an unsupported symbol is rejected explicitly, with no network call made", async () => {
    await withApiKey(async () => {
      const { fetchImpl, calls } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getMarketContext({ symbol: "EURUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "unsupported_symbol",
      );
      assert.equal(calls.length, 0, "no fetch call should happen for a rejected symbol");
    });
  });

  // ---------------------------------------------------------------------
  // 4/5/6/7: successful normalization
  // ---------------------------------------------------------------------
  await test("4: a valid provider response normalizes into the MarketContextResult contract", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      const result = await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.equal(result.symbol, "XAUUSD");
      assert.equal(result.provider, "alpha-vantage");
      assert.ok(result.evidence[0].claim.includes("2685.4000"));
    });
  });

  await test("5: evidence carries factual, attributable source information", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      const result = await provider.getMarketContext({ symbol: "XAUUSD" });
      for (const item of result.evidence) {
        assert.equal(item.source, "alpha-vantage");
        assert.ok(item.asOf);
      }
    });
  });

  await test("6: fields this provider cannot supply remain undefined, never guessed", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      const result = await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.equal(result.trend, undefined);
      assert.equal(result.volatility, undefined);
      assert.equal(result.liquidity, undefined);
      assert.equal(result.riskLevel, undefined);
      assert.equal(result.sentiment, undefined);
      assert.equal(result.technicalSummary, undefined);
      assert.equal(result.headlines, undefined);
    });
  });

  await test("7: the provider's own timestamp is preserved (converted to ISO) when present and UTC", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl });
      const result = await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.equal(result.evidence[0].asOf, "2026-01-15T20:00:01.000Z");
    });
  });

  await test("7b: a non-UTC or missing timestamp is treated as absent, never guessed", async () => {
    await withApiKey(async () => {
      const clock = fakeClock(Date.parse("2026-02-01T00:00:00.000Z"));
      const { fetchImpl } = makeFetch(200, successBody({ "7. Time Zone": "EST" }));
      const provider = new AlphaVantageProvider({ fetchImpl, clock });
      const result = await provider.getMarketContext({ symbol: "XAUUSD" });
      // Falls back to retrievedAt (the fake clock's time), not a guessed conversion.
      assert.equal(result.evidence[0].asOf, result.retrievedAt);
    });
  });

  // ---------------------------------------------------------------------
  // 8/9/10: explicit failure modes
  // ---------------------------------------------------------------------
  await test("8: a malformed/unexpected response shape fails explicitly", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, { unexpected: "shape" });
      const provider = new AlphaVantageProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getMarketContext({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "invalid_response",
      );
    });
  });

  await test("9: an upstream HTTP failure fails explicitly, never as a successful empty context", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(500, {});
      const provider = new AlphaVantageProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getMarketContext({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "http_error",
      );
    });
  });

  await test("10: a rate-limit response (HTTP 200 with a Note field) fails explicitly", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, {
        Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
      });
      const provider = new AlphaVantageProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getMarketContext({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "rate_limit",
      );
    });
  });

  await test("10b: an HTTP 401/403 is classified as an auth failure, not a generic http_error", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(401, {});
      const provider = new AlphaVantageProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getMarketContext({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "auth",
      );
    });
  });

  // ---------------------------------------------------------------------
  // 11/12: cache behavior
  // ---------------------------------------------------------------------
  await test("11: a cache hit avoids a second upstream call", async () => {
    await withApiKey(async () => {
      const clock = fakeClock(0);
      const { fetchImpl, calls } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl, clock, cacheTtlMs: 60_000 });
      await provider.getMarketContext({ symbol: "XAUUSD" });
      await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.equal(calls.length, 1);
    });
  });

  await test("11b: no cross-symbol contamination - XAU and XAG are cached independently", async () => {
    await withApiKey(async () => {
      const clock = fakeClock(0);
      const { fetchImpl, calls } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl, clock, cacheTtlMs: 60_000 });
      await provider.getMarketContext({ symbol: "XAUUSD" });
      await provider.getMarketContext({ symbol: "XAGUSD" });
      assert.equal(calls.length, 2, "different symbols must not share a cache entry");
    });
  });

  await test("12: cache expiry triggers a fresh upstream request", async () => {
    await withApiKey(async () => {
      const clock = fakeClock(0);
      const { fetchImpl, calls } = makeFetch(200, successBody());
      const provider = new AlphaVantageProvider({ fetchImpl, clock, cacheTtlMs: 1_000 });
      await provider.getMarketContext({ symbol: "XAUUSD" });
      clock.advance(1_001);
      await provider.getMarketContext({ symbol: "XAUUSD" });
      assert.equal(calls.length, 2);
    });
  });

  // ---------------------------------------------------------------------
  // 13: missing API key
  // ---------------------------------------------------------------------
  await test("13: a missing API key reports provider-unavailable through MarketContextService", async () => {
    const original = process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    try {
      const provider = new AlphaVantageProvider();
      assert.equal(provider.isConfigured(), false);
      const service = new MarketContextService(provider);
      await assert.rejects(
        () => service.getMarketContext({ symbol: "XAUUSD" }),
        MarketDataProviderUnavailableError,
      );
    } finally {
      if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = original;
    }
  });

  // ---------------------------------------------------------------------
  // 14: no API key exposed to client code
  // ---------------------------------------------------------------------
  await test("14: error messages never contain the API key, even on failure paths", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(500, {});
      const provider = new AlphaVantageProvider({ fetchImpl });
      try {
        await provider.getMarketContext({ symbol: "XAUUSD" });
        assert.fail("expected getMarketContext to throw");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        assert.ok(!message.includes(TEST_API_KEY), "error message must never leak the API key");
      }
    });
  });

  await test("14b: structural - the provider module never exports the raw API key", () => {
    const source = readFileSync(
      new URL("../lib/market-data/providers/alpha-vantage.provider.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!/export\s+const\s+\w*apiKey/i.test(source), "the module must not export a raw API key constant");
  });

  // ---------------------------------------------------------------------
  // 15: no mock dashboard/data imports
  // ---------------------------------------------------------------------
  await test("15: no market-data file imports mock dashboard/data sources", () => {
    const files = [
      "lib/market-data/env.ts",
      "lib/market-data/errors.ts",
      "lib/market-data/cache.ts",
      "lib/market-data/providers/alpha-vantage.provider.ts",
    ];
    const forbidden = ["data/mock", "data/market-intelligence", "data/signals", "market-intelligence.service", "services/ai/trading/", "services/ai/providers/"];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      for (const needle of forbidden) {
        assert.ok(!source.includes(needle), `${file} must not reference ${needle}`);
      }
    }
  });

  // ---------------------------------------------------------------------
  // G: integration through MarketIntelligencePipelineService (Sprint 15D.8)
  // + MarketAnalysisOrchestrationService (Sprint 15D.10 rewiring) - the
  // orchestration service no longer uses MarketContextService as its data
  // path, so this section now injects AlphaVantageProvider directly into
  // the pipeline instead.
  // ---------------------------------------------------------------------
  class FakeAI implements Pick<AIService, "complete"> {
    lastPrompt = "";
    async complete(prompt: string) {
      this.lastPrompt = prompt;
      return { content: "Gold is trading near recent levels based on available spot data.", model: "fake-model", provider: "fake-ai" };
    }
  }

  await test("G1: a successful provider result reaches orchestration end to end through the 15D.8 pipeline", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const pipeline = new MarketIntelligencePipelineService(new AlphaVantageProvider({ fetchImpl }));
      const fakeAI = new FakeAI();
      const orchestrator = new MarketAnalysisOrchestrationService(pipeline, undefined, new AnalysisRunService(), fakeAI);
      const outcome = await orchestrator.analyze({ userId: "user-1", symbol: "XAUUSD", question: "Analyze gold XAUUSD" });
      assert.equal(outcome.status, "completed");
      if (outcome.status === "completed") {
        assert.ok(outcome.result.confidence.basis.some((item) => item.source === "alpha-vantage"));
        assert.ok(outcome.result.explainable.supportingEvidence.some((line) => line.basis[0]?.source === "alpha-vantage"));
      }
    });
  });

  await test("G2: an unavailable provider remains explicit through orchestration", async () => {
    const original = process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    try {
      const pipeline = new MarketIntelligencePipelineService(new AlphaVantageProvider());
      const orchestrator = new MarketAnalysisOrchestrationService(pipeline, undefined, new AnalysisRunService(), new FakeAI());
      const outcome = await orchestrator.analyze({ userId: "user-1", symbol: "XAUUSD", question: "Analyze gold" });
      assert.equal(outcome.status, "provider-unavailable");
    } finally {
      if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = original;
    }
  });

  await test("G3: no fabricated fields appear anywhere in the orchestrated prompt or result", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, successBody());
      const pipeline = new MarketIntelligencePipelineService(new AlphaVantageProvider({ fetchImpl }));
      const fakeAI = new FakeAI();
      const orchestrator = new MarketAnalysisOrchestrationService(pipeline, undefined, new AnalysisRunService(), fakeAI);
      const outcome = await orchestrator.analyze({ userId: "user-1", symbol: "XAUUSD", question: "Analyze gold XAUUSD" });
      assert.equal(outcome.status, "completed");
      // AlphaVantageProvider never supplies trend/volatility/sentiment/
      // headlines (see the provider's own file header) - the explainer's
      // own assumptions/limitations must say so explicitly in the prompt,
      // never a guessed value standing in for them.
      assert.ok(fakeAI.lastPrompt.includes("No technical evidence was available"));
      assert.ok(fakeAI.lastPrompt.includes("No news evidence was available"));
      assert.ok(fakeAI.lastPrompt.includes("No sentiment evidence was available"));
      assert.ok(fakeAI.lastPrompt.includes("never invent a price, direction, headline, or conclusion"));
      if (outcome.status === "completed") {
        assert.equal(outcome.result.confidence.basis.every((item) => item.source === "alpha-vantage"), true);
      }
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
