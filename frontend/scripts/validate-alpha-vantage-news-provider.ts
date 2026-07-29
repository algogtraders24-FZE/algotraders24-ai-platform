// scripts/validate-alpha-vantage-news-provider.ts
// Sprint 15D.12 - Standalone validation for AlphaVantageNewsProvider (the
// first real implementation of Sprint 15D.11's NewsProvider interface),
// plus an integration check through the real MarketIntelligencePipelineService.
// No test framework exists in this project; run via
// `npm run validate:news-provider`.
//
// No real network call is ever made: the HTTP transport is a controlled
// fake injected via AlphaVantageNewsProviderOptions.fetchImpl, and cache
// timing is controlled via an injectable Clock - the exact same
// dependency-injection points AlphaVantageProvider (Sprint 15D.3A) was
// already built with. "Self-cleaning" here means: the one test that
// manipulates process.env.ALPHA_VANTAGE_API_KEY restores it in a finally
// block, and every other test constructs its own fresh provider/cache
// instance, so there is no shared state to clean up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AlphaVantageNewsProvider,
  type AlphaVantageNewsFetch,
} from "../lib/market-data/providers/alpha-vantage-news.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { Clock } from "../lib/market-data/cache";
import { MarketIntelligencePipelineService } from "../services/ai/market-intelligence-pipeline.service";
import type { MarketDataProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { NewsProvider } from "../types/evidence-fusion";

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

const FIXED_TIME = "2026-01-15T20:00:00.000Z";

function makeClock(nowMs: number): Clock {
  return { now: () => nowMs };
}

function makeFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  const calls: string[] = [];
  const fetchImpl: AlphaVantageNewsFetch = async (url: string) => {
    calls.push(url);
    return { ok, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

function feedResponse(articles: Array<Partial<{ title: string; source: string; time_published: string }>>) {
  return { feed: articles };
}

async function withApiKey(fn: () => Promise<void>): Promise<void> {
  const original = process.env.ALPHA_VANTAGE_API_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = "test-news-key-do-not-log";
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = original;
  }
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------
  await test("1: isConfigured() is false with no API key, true once one is set", async () => {
    const original = process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    try {
      assert.equal(new AlphaVantageNewsProvider().isConfigured(), false);
    } finally {
      if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = original;
    }
    await withApiKey(async () => {
      assert.equal(new AlphaVantageNewsProvider().isConfigured(), true);
    });
  });

  await test("2: getNewsEvidence throws a typed 'unconfigured' error when no API key is set, never a fabricated empty success", async () => {
    const original = process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    try {
      const provider = new AlphaVantageNewsProvider();
      await assert.rejects(
        () => provider.getNewsEvidence({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "unconfigured",
      );
    } finally {
      if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = original;
    }
  });

  // ---------------------------------------------------------------------
  // Normalization
  // ---------------------------------------------------------------------
  await test("3: a valid response normalizes into news EvidenceItems with correct claim/source/symbol", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(
        200,
        feedResponse([{ title: "Gold rallies on rate-cut bets", source: "Reuters", time_published: "20260115T190000" }]),
      );
      const provider = new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(new Date(FIXED_TIME).getTime()) });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(items.length, 1);
      assert.equal(items[0].type, "news");
      assert.equal(items[0].symbol, "XAUUSD");
      assert.equal(items[0].claim, "Gold rallies on rate-cut bets");
      assert.equal(items[0].source, "Reuters");
      assert.equal(items[0].asOf, "2026-01-15T19:00:00.000Z");
      assert.equal(items[0].retrievedAt, FIXED_TIME);
    });
  });

  await test("4: a missing/unparseable time_published falls back to retrievedAt, never a guessed publish time", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([{ title: "Headline with no timestamp", source: "Wire" }]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(new Date(FIXED_TIME).getTime()) });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(items[0].asOf, FIXED_TIME, "falls back to retrievedAt, not a fabricated value");
    });
  });

  await test("5: an article missing a title is filtered out rather than producing a blank claim", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([{ source: "Wire" }, { title: "Real headline", source: "Wire" }]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(items.length, 1);
      assert.equal(items[0].claim, "Real headline");
    });
  });

  await test("6: an article missing a source falls back to the provider's own name, never a blank attribution", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([{ title: "Headline with no source" }]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(items[0].source, "alpha-vantage-news");
    });
  });

  await test("7: an empty feed produces zero evidence, never an error - 'no news' is a valid outcome", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.deepEqual(items, []);
    });
  });

  await test("8: results are capped at 5 headlines even when the feed returns more", async () => {
    await withApiKey(async () => {
      const articles = Array.from({ length: 12 }, (_, i) => ({ title: `Headline ${i}`, source: "Wire" }));
      const { fetchImpl } = makeFetch(200, feedResponse(articles));
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      const items = await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(items.length, 5);
      assert.equal(items[0].claim, "Headline 0", "the cap keeps the first N deterministically, never a random subset");
    });
  });

  // ---------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------
  await test("9: a rate-limit response (HTTP 200 with a Note field) fails explicitly, never as an empty success", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, { Note: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." });
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getNewsEvidence({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "rate_limit",
      );
    });
  });

  await test("10: an HTTP 401/403 is classified as an auth failure, not a generic http_error", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(401, {});
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getNewsEvidence({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "auth",
      );
    });
  });

  await test("11: an upstream HTTP 500 fails explicitly as http_error", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(500, {});
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getNewsEvidence({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "http_error",
      );
    });
  });

  await test("12: malformed/non-JSON response fails explicitly as invalid_response", async () => {
    await withApiKey(async () => {
      const fetchImpl: AlphaVantageNewsFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("not json");
        },
      });
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      await assert.rejects(
        () => provider.getNewsEvidence({ symbol: "XAUUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "invalid_response",
      );
    });
  });

  // ---------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------
  await test("13: a cache hit avoids a second upstream call for the same topics within the TTL", async () => {
    await withApiKey(async () => {
      const { fetchImpl, calls } = makeFetch(200, feedResponse([{ title: "Cached headline", source: "Wire" }]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(1_000) });
      await provider.getNewsEvidence({ symbol: "XAUUSD" });
      await provider.getNewsEvidence({ symbol: "XAGUSD" }); // different symbol, same topics -> same cache key
      assert.equal(calls.length, 1, "the second call must be served from cache");
    });
  });

  await test("14: cache expiry triggers a fresh upstream request", async () => {
    await withApiKey(async () => {
      let now = 0;
      const clock: Clock = { now: () => now };
      const { fetchImpl, calls } = makeFetch(200, feedResponse([{ title: "Headline", source: "Wire" }]));
      const provider = new AlphaVantageNewsProvider({ fetchImpl, clock, cacheTtlMs: 1000 });
      await provider.getNewsEvidence({ symbol: "XAUUSD" });
      now = 5000;
      await provider.getNewsEvidence({ symbol: "XAUUSD" });
      assert.equal(calls.length, 2, "a stale cache entry must trigger a fresh request");
    });
  });

  // ---------------------------------------------------------------------
  // Determinism and security
  // ---------------------------------------------------------------------
  await test("15: identical provider output produces byte-identical evidence across two calls (different cache keys to force two real fetches)", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([{ title: "Same headline", source: "Wire", time_published: "20260115T190000" }]));
      const first = await new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(new Date(FIXED_TIME).getTime()) }).getNewsEvidence({
        symbol: "XAUUSD",
      });
      const second = await new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(new Date(FIXED_TIME).getTime()) }).getNewsEvidence({
        symbol: "XAUUSD",
      });
      assert.deepEqual(first, second);
    });
  });

  await test("16: error messages never contain the API key, even on failure paths", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(500, {});
      const provider = new AlphaVantageNewsProvider({ fetchImpl });
      try {
        await provider.getNewsEvidence({ symbol: "XAUUSD" });
        assert.fail("expected a rejection");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert.ok(!message.includes("test-news-key-do-not-log"));
      }
    });
  });

  await test("17: structural - the provider module never exports the raw API key, and imports no mock data", () => {
    const source = readFileSync(new URL("../lib/market-data/providers/alpha-vantage-news.provider.ts", import.meta.url), "utf8");
    assert.ok(!/export\s+const\s+apiKey/i.test(source));
    const forbidden = ["data/mock", "data/market-intelligence", "services/ai/providers/"];
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), `must not reference ${needle}`);
    }
  });

  // ---------------------------------------------------------------------
  // Integration through MarketIntelligencePipelineService (Sprint 15D.8)
  // ---------------------------------------------------------------------
  class FakeMarketDataProvider implements MarketDataProvider {
    readonly name = "fake-market-data";
    isConfigured(): boolean {
      return true;
    }
    async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
      return {
        symbol: request.symbol,
        provider: "fake-market-data",
        retrievedAt: FIXED_TIME,
        evidence: [{ claim: "Spot price: 2685.4000 USD", source: "fake-market-data", asOf: FIXED_TIME }],
      };
    }
  }

  await test("18: a configured, successful NewsProvider contributes real fused news evidence to a completed analysis", async () => {
    await withApiKey(async () => {
      const { fetchImpl } = makeFetch(200, feedResponse([{ title: "Gold rallies on rate-cut bets", source: "Reuters", time_published: "20260115T190000" }]));
      const newsProvider = new AlphaVantageNewsProvider({ fetchImpl, clock: makeClock(new Date(FIXED_TIME).getTime()) });
      const pipeline = new MarketIntelligencePipelineService(
        new FakeMarketDataProvider(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        newsProvider,
      );
      const outcome = await pipeline.run({ symbol: "XAUUSD" });
      assert.equal(outcome.status, "completed");
      if (outcome.status === "completed") {
        assert.ok(outcome.result.evidence.items.some((item) => item.type === "news" && item.claim === "Gold rallies on rate-cut bets"));
      }
    });
  });

  await test("19: an unconfigured NewsProvider never blocks or fails an otherwise-successful analysis", async () => {
    const original = process.env.ALPHA_VANTAGE_API_KEY;
    delete process.env.ALPHA_VANTAGE_API_KEY;
    try {
      const newsProvider = new AlphaVantageNewsProvider();
      assert.equal(newsProvider.isConfigured(), false);
      const pipeline = new MarketIntelligencePipelineService(
        new FakeMarketDataProvider(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        newsProvider,
      );
      const outcome = await pipeline.run({ symbol: "XAUUSD" });
      assert.equal(outcome.status, "completed");
      if (outcome.status === "completed") {
        assert.ok(!outcome.result.evidence.items.some((item) => item.type === "news"));
      }
    } finally {
      if (original === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
      else process.env.ALPHA_VANTAGE_API_KEY = original;
    }
  });

  await test("20: a NewsProvider that throws (e.g. rate-limited) never fails the overall analysis - best-effort, non-fatal", async () => {
    const failingNewsProvider: NewsProvider = {
      name: "failing-news",
      isConfigured: () => true,
      getNewsEvidence: async () => {
        throw new MarketDataProviderError("rate_limit", "simulated rate limit", "failing-news");
      },
    };
    const pipeline = new MarketIntelligencePipelineService(
      new FakeMarketDataProvider(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      failingNewsProvider,
    );
    const outcome = await pipeline.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "completed", "a failing optional news source must never turn a completed analysis into a failure");
  });

  await test("21: with no NewsProvider injected at all, behavior is byte-identical to Sprint 15D.11 (no news source group)", async () => {
    const pipeline = new MarketIntelligencePipelineService(new FakeMarketDataProvider());
    const outcome = await pipeline.run({ symbol: "XAUUSD" });
    assert.equal(outcome.status, "completed");
    if (outcome.status === "completed") {
      assert.equal(outcome.result.evidence.items.length, 1, "only the market-data price item - no news source was ever consulted");
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
