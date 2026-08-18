// scripts/validate-mt5-provider.ts
// Sprint: MT5 (Exness) Live Data Bridge. Standalone, assert-based
// verification (no test framework, no real network in the default suite -
// fetchImpl/Clock are injected everywhere, matching every other provider
// adapter's own test convention). Run via `npm run validate:mt5-provider`.
//
// Covers: symbol resolution against the real catalog, quote/candle
// parsing against the bridge's documented response shape, auth-header
// construction (never the secret in a URL), typed error classification
// for every real bridge failure mode (401/404/malformed JSON/unreachable),
// unconfigured behavior (no env -> never a crash, always a clean
// "unconfigured" error), and caching. A separate, gated live section
// (RUN_LIVE_MT5_SMOKE_TEST=1) hits the REAL deployed bridge once it
// exists - never fabricates a PASS when the opt-in/bridge is unavailable.
import assert from "node:assert/strict";
import { Mt5Provider, type Mt5BridgeFetch } from "../lib/market-data/providers/mt5.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { Clock } from "../lib/market-data/cache";

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

function fixedClock(atMs: number): Clock {
  return { now: () => atMs };
}

const TEST_ENV = { bridgeUrl: "https://mt5.example.test", secret: "test-secret-value" };

function quoteOkResponse(overrides: Partial<{ bid: number; ask: number; last: number; volume: number; time: string }> = {}) {
  const body = { symbol: "XAGUSD", mt5Symbol: "XAGUSD", bid: 29.5, ask: 29.52, last: 0, volume: 100, time: "2026-08-18T12:00:00.000Z", ...overrides };
  return { ok: true, status: 200, json: async () => body };
}
function candlesOkResponse(candles: Array<{ datetime: string; open: number; high: number; low: number; close: number; volume?: number }>) {
  return { ok: true, status: 200, json: async () => ({ symbol: "XAGUSD", mt5Symbol: "XAGUSD", interval: "1h", candles }) };
}

// ============================================================
// Configuration / unconfigured behavior
// ============================================================
async function configurationTests(): Promise<void> {
  await test("unconfigured: no env -> isConfigured() is false, never crashes", () => {
    const provider = new Mt5Provider({ env: null });
    assert.equal(provider.isConfigured(), false);
  });

  await test("unconfigured: a call with no env throws a clean 'unconfigured' MarketDataProviderError, never an unhandled exception", async () => {
    const provider = new Mt5Provider({ env: null });
    await assert.rejects(provider.getSnapshot({ symbol: "XAGUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unconfigured");
  });

  await test("configured: real env makes isConfigured() true", () => {
    const provider = new Mt5Provider({ env: TEST_ENV });
    assert.equal(provider.isConfigured(), true);
  });
}

// ============================================================
// Symbol resolution against the real catalog
// ============================================================
async function symbolResolutionTests(): Promise<void> {
  await test("symbol resolution: XAGUSD resolves via the real instrument-catalog.ts mapping - not a second symbol table", async () => {
    const provider = new Mt5Provider({ env: TEST_ENV });
    assert.ok(provider.supportedSymbols().includes("XAGUSD"), "XAGUSD must be in the catalog-derived symbol map");
  });

  await test("symbol resolution: an unmapped symbol is rejected as unsupported_symbol, never silently attempted against the bridge", async () => {
    const provider = new Mt5Provider({ env: TEST_ENV });
    await assert.rejects(
      provider.getSnapshot({ symbol: "SOMETHING_NOT_MAPPED" }),
      (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol",
    );
  });
}

// ============================================================
// Auth header construction
// ============================================================
async function authTests(): Promise<void> {
  await test("auth: the secret is sent as an Authorization Bearer header, never appended to the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl: Mt5BridgeFetch = async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return quoteOkResponse();
    };
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl, clock: fixedClock(1_700_000_000_000) });
    await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(capturedHeaders.Authorization, `Bearer ${TEST_ENV.secret}`);
    assert.equal(capturedUrl.includes(TEST_ENV.secret), false, "the secret must never appear in the request URL");
  });

  await test("auth: a 401 from the bridge is classified as 'auth', never a fabricated quote", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: "invalid bearer token" }) });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "XAGUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "auth");
  });
}

// ============================================================
// Quote parsing (GET /quote)
// ============================================================
async function quoteParsingTests(): Promise<void> {
  await test("quote: real bid/ask/time are parsed into a valid MarketSnapshot", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => quoteOkResponse({ bid: 29.5, ask: 29.52 });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl, clock: fixedClock(1_700_000_000_000) });
    const snapshot = await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(snapshot.bid, 29.5);
    assert.equal(snapshot.ask, 29.52);
    assert.equal(snapshot.provider, "mt5");
    assert.equal(snapshot.providerSymbol, "XAGUSD");
  });

  await test("quote: price falls back to the real bid/ask midpoint when 'last' is 0 (forex/CFD has no true last-trade price) - never a guess", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => quoteOkResponse({ bid: 29.5, ask: 29.52, last: 0 });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    const snapshot = await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(snapshot.price, (29.5 + 29.52) / 2);
  });

  await test("quote: price uses the real 'last' when the bridge reports a genuine non-zero value", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => quoteOkResponse({ bid: 29.5, ask: 29.52, last: 29.51 });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    const snapshot = await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(snapshot.price, 29.51);
  });

  await test("quote: marketStatus is honestly 'unknown' - the bridge's current response has no open/closed field, never guessed as 'open'", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => quoteOkResponse();
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    const snapshot = await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(snapshot.marketStatus, "unknown");
  });

  await test("quote: a 404 (unmapped symbol on the bridge side, e.g. wrong Exness suffix) is classified unsupported_symbol, never a fabricated price", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => ({ ok: false, status: 404, json: async () => ({ detail: "not mapped" }) });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "XAGUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol");
  });

  await test("quote: malformed JSON is classified invalid_response, never crashes uncaught", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "XAGUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
  });

  await test("quote: a response missing bid/ask/time is classified invalid_response, never partially trusted", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => ({ ok: true, status: 200, json: async () => ({ symbol: "XAGUSD" }) });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "XAGUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
  });

  await test("quote: a network failure reaching the bridge is classified http_error, and the bridge URL never leaks into the error message", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => {
      throw new Error(`connect ECONNREFUSED ${TEST_ENV.bridgeUrl}`);
    };
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    try {
      await provider.getSnapshot({ symbol: "XAGUSD" });
      assert.fail("expected a rejection");
    } catch (e) {
      assert.ok(e instanceof MarketDataProviderError);
      assert.equal(e.kind, "http_error");
      assert.equal(e.message.includes(TEST_ENV.bridgeUrl), false, "the bridge URL must never appear in the thrown error message");
    }
  });

  await test("quote: caching - a second request for the same symbol within the TTL is served from cache, never a second bridge call", async () => {
    let calls = 0;
    const fetchImpl: Mt5BridgeFetch = async () => {
      calls += 1;
      return quoteOkResponse();
    };
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl, cacheTtlMs: 60_000 });
    await provider.getSnapshot({ symbol: "XAGUSD" });
    await provider.getSnapshot({ symbol: "XAGUSD" });
    assert.equal(calls, 1);
  });
}

// ============================================================
// Candle parsing (GET /candles)
// ============================================================
async function candleParsingTests(): Promise<void> {
  await test("candles: real oldest-first OHLCV rows are parsed into Candle[] unmodified", async () => {
    const rows = [
      { datetime: "2026-08-18T10:00:00.000Z", open: 29.4, high: 29.6, low: 29.3, close: 29.5, volume: 120 },
      { datetime: "2026-08-18T11:00:00.000Z", open: 29.5, high: 29.7, low: 29.45, close: 29.6, volume: 140 },
    ];
    const fetchImpl: Mt5BridgeFetch = async () => candlesOkResponse(rows);
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    const candles = await provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h", outputSize: 2 });
    assert.equal(candles.length, 2);
    assert.equal(candles[0].close, 29.5);
    assert.equal(candles[1].close, 29.6);
    assert.ok(new Date(candles[0].datetime).getTime() < new Date(candles[1].datetime).getTime());
  });

  await test("candles: a malformed row (missing OHLC) is filtered out, never fabricated into a fake candle", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => candlesOkResponse([{ datetime: "2026-08-18T10:00:00.000Z", open: 29.4, high: 29.6, low: 29.3, close: 29.5 } as never, { datetime: "bad-row" } as never]);
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    const candles = await provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h" });
    assert.equal(candles.length, 1);
  });

  await test("candles: a 400 (unsupported interval) is classified invalid_response, never silently defaulted to a different timeframe", async () => {
    const fetchImpl: Mt5BridgeFetch = async () => ({ ok: false, status: 400, json: async () => ({ detail: "unsupported interval" }) });
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl });
    await assert.rejects(provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
  });

  await test("candles: caching - identical symbol/interval/outputSize within the TTL is served from cache", async () => {
    let calls = 0;
    const fetchImpl: Mt5BridgeFetch = async () => {
      calls += 1;
      return candlesOkResponse([{ datetime: "2026-08-18T10:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    };
    const provider = new Mt5Provider({ env: TEST_ENV, fetchImpl, candleCacheTtlMs: 60_000 });
    await provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h", outputSize: 100 });
    await provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h", outputSize: 100 });
    assert.equal(calls, 1);
  });
}

// ============================================================
// Live MT5 bridge smoke test - gated, non-fatal, only runs when
// explicitly requested via RUN_LIVE_MT5_SMOKE_TEST=1 AND the bridge env
// is actually configured. Never reports PASS unless actually verified
// against the real, deployed bridge - see mt5-bridge/README.md's own
// deployment runbook for how to stand it up first.
// ============================================================
async function liveMt5SmokeTest(): Promise<void> {
  console.log("\n=== LIVE MT5 BRIDGE SMOKE TEST ===");
  if (process.env.RUN_LIVE_MT5_SMOKE_TEST !== "1") {
    console.log("LIVE TEST: NOT RUN - opt-in RUN_LIVE_MT5_SMOKE_TEST=1 not set.");
    return;
  }
  const provider = new Mt5Provider();
  if (!provider.isConfigured()) {
    console.log("LIVE TEST: NOT RUN - MT5_BRIDGE_URL/MT5_BRIDGE_SECRET not set.");
    return;
  }

  async function check(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      const result = await fn();
      console.log(`  ${label}: PASS (${JSON.stringify(result)})`);
    } catch (err) {
      console.log(`  ${label}: FAIL (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  await check("real XAGUSD quote from the live bridge", async () => {
    const s = await provider.getSnapshot({ symbol: "XAGUSD" });
    return { price: s.price, bid: s.bid, ask: s.ask, provider: s.provider, providerSymbol: s.providerSymbol };
  });
  await check("real XAGUSD candles from the live bridge", async () => {
    const candles = await provider.getTimeSeries({ symbol: "XAGUSD", interval: "1h", outputSize: 10 });
    return { count: candles.length, latestClose: candles[candles.length - 1]?.close };
  });
}

async function main(): Promise<void> {
  await configurationTests();
  await symbolResolutionTests();
  await authTests();
  await quoteParsingTests();
  await candleParsingTests();
  await liveMt5SmokeTest();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
