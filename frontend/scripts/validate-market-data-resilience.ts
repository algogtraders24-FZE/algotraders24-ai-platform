// scripts/validate-market-data-resilience.ts
// Sprint D2.3.S3 - assert-based verification for Intelligence Reliability &
// Market Data Resilience. Same pattern as scripts/validate-alpha-vantage-
// provider.ts: no test framework, no real network call (fetchImpl/Clock are
// injected), run via `npm run validate:market-data-resilience`.
import assert from "node:assert/strict";
import { MarketDataService } from "../services/market-data/market-data.service";
import { TwelveDataProvider, type TwelveDataFetch } from "../lib/market-data/providers/twelve-data.provider";
import { AlphaVantageProvider, type AlphaVantageFetch } from "../lib/market-data/providers/alpha-vantage.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { toMarketDataErrorDTO } from "../lib/market-data/error-dto";
import { ProviderHealthMonitor, classify } from "../lib/market-data/health-monitor";
import { TtlCache, type Clock } from "../lib/market-data/cache";

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

const TD_KEY = "test-td-key-not-real";
const AV_KEY = "test-av-key-not-real";

async function withKeys<T>(fn: () => Promise<T> | T): Promise<T> {
  const origTd = process.env.TWELVEDATA_API_KEY;
  const origAv = process.env.ALPHA_VANTAGE_API_KEY;
  process.env.TWELVEDATA_API_KEY = TD_KEY;
  process.env.ALPHA_VANTAGE_API_KEY = AV_KEY;
  try {
    return await fn();
  } finally {
    if (origTd === undefined) delete process.env.TWELVEDATA_API_KEY;
    else process.env.TWELVEDATA_API_KEY = origTd;
    if (origAv === undefined) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = origAv;
  }
}

function fakeClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

function tdQuoteBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    symbol: "EUR/USD",
    close: "1.0850",
    open: "1.0840",
    high: "1.0860",
    low: "1.0830",
    percent_change: "0.12",
    volume: "100000",
    is_market_open: true,
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

function tdFetchAlways429(): TwelveDataFetch {
  return async () => ({ ok: false, status: 429, json: async () => ({ status: "error", code: 429, message: "rate limit" }) });
}

function avFetchUnsupported(): AlphaVantageFetch {
  return async () => ({ ok: true, status: 200, json: async () => ({}) });
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: 429 retried in-place, then succeeds (no fallback needed)
  // ---------------------------------------------------------------------
  await test("1: a transient 429 is retried on the same provider and succeeds on the second attempt", async () => {
    await withKeys(async () => {
      let calls = 0;
      const fetchImpl: TwelveDataFetch = async () => {
        calls += 1;
        if (calls === 1) return { ok: false, status: 429, json: async () => ({ status: "error", code: 429, message: "rate limit" }) };
        return { ok: true, status: 200, json: async () => tdQuoteBody() };
      };
      const td = new TwelveDataProvider({ fetchImpl });
      const service = new MarketDataService({
        providers: [td],
        reliability: { sleep: async () => {}, random: () => 0 },
      });
      const result = await service.getSnapshot({ symbol: "EURUSD" });
      assert.equal(result.provider, "twelve-data");
      assert.equal(calls, 2, "expected exactly one retry before success");
    });
  });

  // ---------------------------------------------------------------------
  // 2: 429 exhausts retries on the primary, falls back to the secondary
  // ---------------------------------------------------------------------
  await test("2: a persistent 429 exhausts retries then falls back to the secondary provider", async () => {
    await withKeys(async () => {
      const td = new TwelveDataProvider({ fetchImpl: tdFetchAlways429() });
      const avFetch: AlphaVantageFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          "Realtime Currency Exchange Rate": {
            "5. Exchange Rate": "1.0850",
            "6. Last Refreshed": "2026-01-15 20:00:01",
            "7. Time Zone": "UTC",
          },
        }),
      });
      const av = new AlphaVantageProvider({ fetchImpl: avFetch });
      const service = new MarketDataService({
        providers: [td, av],
        reliability: { sleep: async () => {}, random: () => 0, retries: 1 },
      });
      const result = await service.getMarketContext({ symbol: "EURUSD" });
      assert.equal(result.provider, "alpha-vantage", "expected fallback to Alpha Vantage after Twelve Data exhausted retries");
    });
  });

  // ---------------------------------------------------------------------
  // 3: stale-cache fallback served when every provider fails
  // ---------------------------------------------------------------------
  await test("3: a stale-but-in-grace-window cache entry is served (honestly stamped) when every provider fails", async () => {
    await withKeys(async () => {
      const clock = fakeClock(0);
      let mode: "ok" | "fail" = "ok";
      const fetchImpl: TwelveDataFetch = async () => {
        if (mode === "fail") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => tdQuoteBody() };
      };
      // cacheTtlMs: 0 on the provider itself - this test isolates the
      // SERVICE-level cache/stale-fallback behavior, so the provider's own
      // independent cache must never mask the simulated failure below.
      const td = new TwelveDataProvider({ fetchImpl, clock, cacheTtlMs: 0 });
      const service = new MarketDataService({
        providers: [td],
        clock,
        cacheTtlMs: 1_000,
        staleFallbackMs: 60_000,
        reliability: { sleep: async () => {}, random: () => 0 },
      });

      const first = await service.getSnapshot({ symbol: "EURUSD" });
      assert.equal(first.cached, undefined, "a genuinely live response must not claim to be cached");

      mode = "fail";
      clock.advance(5_000); // past cacheTtlMs, still within staleFallbackMs
      const second = await service.getSnapshot({ symbol: "EURUSD" });
      assert.equal(second.cached, true, "expected the stale-cache fallback to be used and honestly marked");
      assert.ok(typeof second.cacheAgeMs === "number" && second.cacheAgeMs >= 5_000);
    });
  });

  // ---------------------------------------------------------------------
  // 4: empty cache + total failure produces the standardized DTO shape
  // ---------------------------------------------------------------------
  await test("4: total failure with no cache entry throws, and the DTO built from it has the exact spec shape", async () => {
    await withKeys(async () => {
      const td = new TwelveDataProvider({ fetchImpl: tdFetchAlways429() });
      const service = new MarketDataService({
        providers: [td],
        reliability: { sleep: async () => {}, random: () => 0, retries: 0 },
      });
      await assert.rejects(
        () => service.getSnapshot({ symbol: "EURUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError,
      );
      assert.equal(service.hasCacheEntry("EURUSD"), false);

      try {
        await service.getSnapshot({ symbol: "EURUSD" });
        assert.fail("expected getSnapshot to throw");
      } catch (err) {
        const dto = toMarketDataErrorDTO(err as MarketDataProviderError, { cached: service.hasCacheEntry("EURUSD") });
        assert.equal(dto.success, false);
        assert.equal(dto.cached, false);
        assert.ok(typeof dto.timestamp === "string" && dto.timestamp.length > 0);
        assert.ok(["unconfigured", "unsupported_symbol", "auth_error", "rate_limited", "provider_error", "timeout", "invalid_response", "unknown"].includes(dto.reason));
        assert.equal(typeof dto.provider, "string");
      }
    });
  });

  // ---------------------------------------------------------------------
  // 5: crypto symbols (SOLUSD, XRPUSD, BTCUSD, ETHUSD) via Twelve Data;
  // Alpha Vantage cleanly reports unsupported_symbol for the same symbols
  // ---------------------------------------------------------------------
  for (const symbol of ["SOLUSD", "XRPUSD", "BTCUSD", "ETHUSD"]) {
    await test(`5: ${symbol} resolves via Twelve Data`, async () => {
      await withKeys(async () => {
        const fetchImpl: TwelveDataFetch = async () => ({ ok: true, status: 200, json: async () => tdQuoteBody({ symbol }) });
        const td = new TwelveDataProvider({ fetchImpl });
        const result = await td.getSnapshot({ symbol });
        assert.equal(result.provider, "twelve-data");
      });
    });
  }

  await test("5b: Alpha Vantage rejects a crypto symbol with unsupported_symbol, never a crash", async () => {
    await withKeys(async () => {
      const av = new AlphaVantageProvider({ fetchImpl: avFetchUnsupported() });
      await assert.rejects(
        () => av.getMarketContext({ symbol: "SOLUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError && err.kind === "unsupported_symbol",
      );
    });
  });

  await test("5c: both providers failing on a crypto symbol still returns one clean aggregate error, never throws unexpectedly", async () => {
    await withKeys(async () => {
      const td = new TwelveDataProvider({ fetchImpl: tdFetchAlways429() });
      const av = new AlphaVantageProvider({ fetchImpl: avFetchUnsupported() });
      const service = new MarketDataService({
        providers: [td, av],
        reliability: { sleep: async () => {}, random: () => 0, retries: 0 },
      });
      await assert.rejects(
        () => service.getSnapshot({ symbol: "SOLUSD" }),
        (err: unknown) => err instanceof MarketDataProviderError,
      );
    });
  });

  // ---------------------------------------------------------------------
  // 6: Provider Health Monitor classification
  // ---------------------------------------------------------------------
  await test("6a: classify() reports healthy with no recorded outcomes", () => {
    assert.equal(classify([]), "healthy");
  });

  await test("6b: classify() reports rate_limited after 2+ consecutive rate_limit failures", () => {
    assert.equal(classify([{ ok: false, kind: "rate_limit" }, { ok: false, kind: "rate_limit" }]), "rate_limited");
  });

  await test("6c: classify() reports offline after 3+ consecutive failures of any kind", () => {
    assert.equal(
      classify([{ ok: false, kind: "http_error" }, { ok: false, kind: "timeout" }, { ok: false, kind: "http_error" }]),
      "offline",
    );
  });

  await test("6d: classify() reports degraded when a recent failure exists but not enough to be offline", () => {
    assert.equal(classify([{ ok: true }, { ok: false, kind: "http_error" }]), "degraded");
  });

  await test("6e: classify() reports healthy after only successes", () => {
    assert.equal(classify([{ ok: true }, { ok: true }, { ok: true }]), "healthy");
  });

  await test("6f: ProviderHealthMonitor records real outcomes and snapshot() reflects them", () => {
    const monitor = new ProviderHealthMonitor(20, { now: () => 0 });
    monitor.recordSuccess("twelve-data", 120);
    monitor.recordFailure("twelve-data", "rate_limit");
    monitor.recordFailure("twelve-data", "rate_limit");
    const snap = monitor.snapshot("twelve-data");
    assert.equal(snap.state, "rate_limited");
    assert.equal(snap.lastErrorKind, "rate_limit");
    assert.equal(snap.successCount, 1);
    assert.equal(snap.failureCount, 2);
  });

  // ---------------------------------------------------------------------
  // 7: cache primitives - getStale / has
  // ---------------------------------------------------------------------
  await test("7a: getStale returns a value within maxAgeMs without evicting it", () => {
    const clock = fakeClock(0);
    const cache = new TtlCache<string>(1_000, clock);
    cache.set("k", "v");
    clock.advance(5_000);
    const stale = cache.getStale("k", 10_000);
    assert.ok(stale && stale.value === "v" && stale.ageMs === 5_000);
    // Still present afterward - getStale must never evict.
    assert.equal(cache.has("k"), true);
  });

  await test("7b: getStale returns undefined once the entry is older than maxAgeMs", () => {
    const clock = fakeClock(0);
    const cache = new TtlCache<string>(1_000, clock);
    cache.set("k", "v");
    clock.advance(20_000);
    assert.equal(cache.getStale("k", 10_000), undefined);
  });

  await test("7c: has() is false for a key that was never set", () => {
    const cache = new TtlCache<string>(1_000);
    assert.equal(cache.has("missing"), false);
  });

  // ---------------------------------------------------------------------
  // 8: startup validation - pure evaluation, no real server needed
  // ---------------------------------------------------------------------
  await test("8: a temporarily-missing TWELVEDATA_API_KEY is detected, then restored", async () => {
    const original = process.env.TWELVEDATA_API_KEY;
    delete process.env.TWELVEDATA_API_KEY;
    try {
      const { loadTwelveDataEnv } = await import("../lib/market-data/env");
      assert.equal(loadTwelveDataEnv(), null);
    } finally {
      if (original === undefined) delete process.env.TWELVEDATA_API_KEY;
      else process.env.TWELVEDATA_API_KEY = original;
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
