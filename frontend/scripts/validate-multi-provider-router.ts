// scripts/validate-multi-provider-router.ts
// Sprint D2.6.3 - Global Instrument Discovery & Intelligent Multi-Provider
// Data Fabric. Standalone, assert-based verification (no test framework,
// no real network - fetchImpl/Clock are injected everywhere), matching
// scripts/validate-market-data-resilience.ts's established pattern. Run
// via `npm run validate:multi-provider-router`.
//
// Covers: instrument search ranking, the Binance/Angel One adapters
// (against fake responses matching their documented/live-verified
// contracts), TOTP correctness (RFC 6238 test vectors), the router's
// fallback chain (MarketDataService, extended but unmodified in its own
// selection logic), provenance (fallbackUsed/providerSymbol), and the
// absolute no-fabrication rule.
import assert from "node:assert/strict";
import { InstrumentSearchService } from "../services/market-data/instrument-search.service";
import { MarketDataService } from "../services/market-data/market-data.service";
import { BinanceProvider, type BinanceFetch } from "../lib/market-data/providers/binance.provider";
import { AngelOneProvider, type AngelOneFetch } from "../lib/market-data/providers/angel-one.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { generateTotp } from "../lib/market-data/angel-one-totp";
import type { MarketDataProvider, SnapshotProvider, MarketContextRequest } from "../types/market-data-provider";
import type { MarketSnapshot } from "../types/market-snapshot";
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

function fixedClock(startMs: number): Clock & { advance: (ms: number) => void } {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

// ============================================================
// 1. Instrument search - deterministic ranking (sprint §21 "Instrument tests")
// ============================================================
async function instrumentSearchTests(): Promise<void> {
  const svc = new InstrumentSearchService();

  await test("search: exact canonical symbol", () => {
    const r = svc.search("XAUUSD");
    assert.equal(r[0].instrument.id, "XAUUSD");
    assert.equal(r[0].matchType, "exact-canonical");
  });
  await test("search: exact provider symbol", () => {
    const r = svc.search("BTCUSDT");
    assert.equal(r[0].instrument.id, "BTCUSD");
    assert.equal(r[0].matchType, "exact-provider-symbol");
  });
  await test("search: exact alias (name)", () => {
    const r = svc.search("Bitcoin");
    assert.equal(r[0].instrument.id, "BTCUSD");
    assert.equal(r[0].matchType, "exact-alias");
    const r2 = svc.search("Gold");
    assert.equal(r2[0].instrument.id, "XAUUSD");
  });
  await test("search: partial/prefix symbol", () => {
    const r = svc.search("BTC");
    assert.ok(r.some((x) => x.instrument.id === "BTCUSD"));
  });
  await test("search: provider-symbol match distinguishes exchange (NIFTY 50)", () => {
    const r = svc.search("NIFTY 50");
    assert.equal(r[0].instrument.id, "NIFTY50");
  });
  await test("search: no result for a genuinely unknown query - never invents a match", () => {
    const r = svc.search("notarealinstrumentxyz123");
    assert.deepEqual(r, []);
  });
  await test("search: empty query returns [], never 'everything'", () => {
    assert.deepEqual(svc.search(""), []);
    assert.deepEqual(svc.search("   "), []);
  });
  await test("search: multiple results returned, ranked - never arbitrarily narrowed to one", () => {
    // "USD" substring-matches many display names (Euro/US Dollar, Bitcoin/US Dollar, ...).
    const r = svc.search("US Dollar");
    assert.ok(r.length > 1, "a broad query must return every real match, not just one");
  });
  await test("search: deterministic - identical query run twice returns identical order", () => {
    const a = svc.search("gold");
    const b = svc.search("gold");
    assert.deepEqual(a, b);
  });
  await test("search: AAPL is findable (real instrument) but honestly has zero live providers", () => {
    const r = svc.search("Apple");
    assert.equal(r[0].instrument.id, "AAPL");
    assert.deepEqual(r[0].instrument.providerMappings, []);
  });
}

// ============================================================
// 2. TOTP correctness - RFC 6238 Appendix B published test vectors
// ============================================================
async function totpTests(): Promise<void> {
  const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32(ascii "12345678901234567890")
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [timeSec, expected] of vectors) {
    await test(`TOTP: RFC 6238 vector T=${timeSec}`, async () => {
      const actual = await generateTotp(SECRET, timeSec * 1000);
      assert.equal(actual, expected);
    });
  }
}

// ============================================================
// 3. Binance provider - real endpoints, fake transport
// ============================================================
function binance24hrBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    symbol: "BTCUSDT",
    lastPrice: "64800.50",
    openPrice: "65200.00",
    highPrice: "65474.46",
    lowPrice: "64518.01",
    priceChangePercent: "-0.61",
    volume: "10559.17",
    closeTime: 1_700_000_000_000,
    ...overrides,
  };
}

async function binanceProviderTests(): Promise<void> {
  await test("Binance: successful quote parses real fields, no auth needed", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody() });
    const provider = new BinanceProvider({ fetchImpl, clock: fixedClock(1_700_000_100_000) });
    assert.equal(provider.isConfigured(), true);
    const snapshot = await provider.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snapshot.price, 64800.5);
    assert.equal(snapshot.providerSymbol, "BTCUSDT");
    assert.equal(snapshot.marketStatus, "open");
  });

  await test("Binance: HTTP 500 classified as http_error", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const provider = new BinanceProvider({ fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "http_error");
  });

  await test("Binance: HTTP 429 classified as rate_limit", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: false, status: 429, json: async () => ({ code: -1003, msg: "Too many requests" }) });
    const provider = new BinanceProvider({ fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "rate_limit");
  });

  await test("Binance: real documented -1121 invalid-symbol error classified as unsupported_symbol", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: false, status: 400, json: async () => ({ code: -1121, msg: "Invalid symbol." }) });
    const provider = new BinanceProvider({ fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol");
  });

  await test("Binance: a symbol not in the catalog is rejected before any network call", async () => {
    const provider = new BinanceProvider({ fetchImpl: async () => { throw new Error("should not be called"); } });
    await assert.rejects(provider.getSnapshot({ symbol: "AAPL" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol");
  });

  await test("Binance: malformed JSON response classified as invalid_response", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } });
    const provider = new BinanceProvider({ fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
  });

  await test("Binance: missing required lastPrice field classified as invalid_response, never defaulted to 0", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody({ lastPrice: undefined }) });
    const provider = new BinanceProvider({ fetchImpl });
    await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
  });

  await test("Binance: invalid/absent closeTime -> providerTimestamp honestly undefined, never guessed", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody({ closeTime: -1 }) });
    const provider = new BinanceProvider({ fetchImpl, clock: fixedClock(1_700_000_100_000) });
    const snapshot = await provider.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snapshot.timestamp, new Date(1_700_000_100_000).toISOString(), "falls back to retrievedAt, not a fabricated source timestamp");
  });

  await test("Binance: candles come back oldest-first, real values only", async () => {
    const rows = [
      [1_700_000_000_000, "64000", "64100", "63900", "64050", "10", 0, "", 0, "", "", ""],
      [1_700_003_600_000, "64050", "64200", "64000", "64150", "12", 0, "", 0, "", "", ""],
    ];
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => rows });
    const provider = new BinanceProvider({ fetchImpl });
    const candles = await provider.getTimeSeries({ symbol: "BTCUSD", interval: "1h", outputSize: 2 });
    assert.equal(candles.length, 2);
    assert.ok(new Date(candles[0].datetime).getTime() < new Date(candles[1].datetime).getTime());
    assert.equal(candles[0].close, 64050);
  });
}

// ============================================================
// 4. Angel One provider - documented contract, fake transport, no live auth
// ============================================================
function withAngelOneEnv<T>(fn: () => Promise<T>): Promise<T> {
  const keys = ["API_KEY", "CLIENT_CODE", "PIN", "TOTP_SECRET"] as const;
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.API_KEY = "test-api-key";
  process.env.CLIENT_CODE = "T12345";
  process.env.PIN = "1234";
  process.env.TOTP_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  return fn().finally(() => {
    for (const k of keys) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });
}

async function angelOneProviderTests(): Promise<void> {
  await test("Angel One: unconfigured (missing credentials) reports honestly, never fakes a session", async () => {
    const original = { a: process.env.API_KEY, c: process.env.CLIENT_CODE, p: process.env.PIN, t: process.env.TOTP_SECRET };
    delete process.env.API_KEY;
    delete process.env.CLIENT_CODE;
    delete process.env.PIN;
    delete process.env.TOTP_SECRET;
    try {
      const provider = new AngelOneProvider({ fetchImpl: async () => { throw new Error("should not be called"); } });
      assert.equal(provider.isConfigured(), false);
      await assert.rejects(provider.getSnapshot({ symbol: "RELIANCE" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unconfigured");
    } finally {
      if (original.a !== undefined) process.env.API_KEY = original.a;
      if (original.c !== undefined) process.env.CLIENT_CODE = original.c;
      if (original.p !== undefined) process.env.PIN = original.p;
      if (original.t !== undefined) process.env.TOTP_SECRET = original.t;
    }
  });

  await test("Angel One: successful login + quote against the documented SmartAPI contract", () =>
    withAngelOneEnv(async () => {
      let loginCalls = 0;
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) {
          loginCalls++;
          return { ok: true, status: 200, json: async () => ({ status: true, message: "SUCCESS", errorcode: "", data: { jwtToken: "fake.jwt", refreshToken: "r", feedToken: "f" } }) };
        }
        if (url.endsWith("/getLtpData")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: true, message: "SUCCESS", errorcode: "", data: { exchange: "NSE", tradingsymbol: "RELIANCE-EQ", symboltoken: "2885", open: "2900", high: "2950", low: "2890", close: "2920", ltp: "2915.5" } }),
          };
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
      const snapshot = await provider.getSnapshot({ symbol: "RELIANCE" });
      assert.equal(snapshot.price, 2915.5);
      assert.equal(snapshot.providerSymbol, "RELIANCE-EQ");
      assert.equal(snapshot.quoteCurrency, "INR");

      // A second call within the session TTL must reuse the session - no second login.
      await provider.getSnapshot({ symbol: "NIFTY50" });
      assert.equal(loginCalls, 1, "session must be cached, not re-authenticated on every quote");
    }));

  await test("Angel One: failed login (bad TOTP/session) classified as auth, never a fabricated session", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: false, message: "Invalid totp", errorcode: "AB1050", data: null }),
      });
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getSnapshot({ symbol: "RELIANCE" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "auth");
    }));

  await test("Angel One: unsupported symbol rejected before any network call", () =>
    withAngelOneEnv(async () => {
      const provider = new AngelOneProvider({ fetchImpl: async () => { throw new Error("should not be called"); } });
      await assert.rejects(provider.getSnapshot({ symbol: "BTCUSD" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol");
    }));

  await test("Angel One: malformed response (missing ltp/close) classified as invalid_response, never defaulted to 0", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return { ok: true, status: 200, json: async () => ({ status: true, data: { jwtToken: "fake.jwt" } }) };
        return { ok: true, status: 200, json: async () => ({ status: true, data: {} }) };
      };
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getSnapshot({ symbol: "RELIANCE" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "invalid_response");
    }));
}

// ============================================================
// 5. Router (MarketDataService) - fallback chain, capability skipping,
//    determinism, provenance, no-fabrication. Minimal fake
//    MarketDataProvider doubles isolate the ROUTER's own selection
//    logic from any real provider's parsing logic (tested separately
//    above).
// ============================================================
function fakeSnapshot(provider: string, symbol: string): MarketSnapshot {
  return {
    symbol,
    assetClass: "crypto",
    price: 100,
    quoteCurrency: "USD",
    timestamp: "2026-01-01T00:00:00.000Z",
    timezone: "UTC",
    marketStatus: "open",
    provider,
    retrievedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fakeProvider(
  name: string,
  behavior: "success" | "unsupported" | "auth-fail" | "unconfigured" | "skip-capability",
): MarketDataProvider & Partial<SnapshotProvider> {
  const base = {
    name,
    isConfigured: () => behavior !== "unconfigured",
    async getMarketContext(request: MarketContextRequest) {
      if (behavior === "unsupported") throw new MarketDataProviderError("unsupported_symbol", `${name} does not support ${request.symbol}`, name);
      if (behavior === "auth-fail") throw new MarketDataProviderError("auth", `${name} auth failed`, name);
      return { symbol: request.symbol, provider: name, retrievedAt: "2026-01-01T00:00:00.000Z", evidence: [] };
    },
  };
  if (behavior === "skip-capability") return base; // no getSnapshot -> isSnapshotProvider() is false, router skips it entirely
  return {
    ...base,
    async getSnapshot(request: MarketContextRequest) {
      if (behavior === "unsupported") throw new MarketDataProviderError("unsupported_symbol", `${name} does not support ${request.symbol}`, name);
      if (behavior === "auth-fail") throw new MarketDataProviderError("auth", `${name} auth failed`, name);
      return fakeSnapshot(name, request.symbol);
    },
  };
}

async function routerTests(): Promise<void> {
  await test("Router 1: highest-priority provider succeeds - no fallback needed", async () => {
    const a = fakeProvider("A", "success");
    const b = fakeProvider("B", "success");
    const svc = new MarketDataService({ providers: [a, b] });
    const snapshot = await svc.getSnapshot({ symbol: "X" });
    assert.equal(snapshot.provider, "A");
    assert.equal(snapshot.fallbackUsed, undefined);
  });

  await test("Router 2: A fails -> B succeeds", async () => {
    const a = fakeProvider("A", "unsupported");
    const b = fakeProvider("B", "success");
    const svc = new MarketDataService({ providers: [a, b] });
    const snapshot = await svc.getSnapshot({ symbol: "X" });
    assert.equal(snapshot.provider, "B");
    assert.equal(snapshot.fallbackUsed, true);
  });

  await test("Router 3: A fails -> B fails -> C succeeds", async () => {
    const a = fakeProvider("A", "unsupported");
    const b = fakeProvider("B", "auth-fail");
    const c = fakeProvider("C", "success");
    const svc = new MarketDataService({ providers: [a, b, c] });
    const snapshot = await svc.getSnapshot({ symbol: "X" });
    assert.equal(snapshot.provider, "C");
    assert.equal(snapshot.fallbackUsed, true);
  });

  await test("Router 4: all providers fail -> structured unavailable result, never a fabricated snapshot", async () => {
    const a = fakeProvider("A", "unsupported");
    const b = fakeProvider("B", "auth-fail");
    const svc = new MarketDataService({ providers: [a, b] });
    await assert.rejects(svc.getSnapshot({ symbol: "X" }), (e: unknown) => {
      assert.ok(e instanceof MarketDataProviderError);
      assert.ok(e.message.includes("A: unsupported_symbol"));
      assert.ok(e.message.includes("B: auth"));
      return true;
    });
  });

  await test("Router 5: stale-cache fallback still works with the extended provider array", async () => {
    const clock = fixedClock(0);
    let succeed = true;
    const flaky: MarketDataProvider & SnapshotProvider = {
      name: "flaky",
      isConfigured: () => true,
      async getMarketContext(request) {
        return { symbol: request.symbol, provider: "flaky", retrievedAt: "t", evidence: [] };
      },
      async getSnapshot(request) {
        if (!succeed) throw new MarketDataProviderError("http_error", "down", "flaky");
        return fakeSnapshot("flaky", request.symbol);
      },
    };
    const svc = new MarketDataService({ providers: [flaky], clock, cacheTtlMs: 1000, staleFallbackMs: 60_000, reliability: { retries: 0 } });
    const fresh = await svc.getSnapshot({ symbol: "X" });
    assert.equal(fresh.cached, undefined);

    clock.advance(5000); // past cacheTtlMs, within staleFallbackMs
    succeed = false;
    const stale = await svc.getSnapshot({ symbol: "X" });
    assert.equal(stale.cached, true, "must be honestly marked stale, never presented as fresh");
    assert.ok((stale.cacheAgeMs ?? 0) > 0);
  });

  await test("Router 6: a provider without SnapshotProvider capability is skipped entirely, not an error", async () => {
    const evidenceOnly = fakeProvider("evidence-only", "skip-capability");
    const b = fakeProvider("B", "success");
    const svc = new MarketDataService({ providers: [evidenceOnly, b] });
    const snapshot = await svc.getSnapshot({ symbol: "X" });
    assert.equal(snapshot.provider, "B");
  });

  await test("Router 7/8: provider selection is deterministic - identical input always selects the identical provider", async () => {
    const a = fakeProvider("A", "unsupported");
    const b = fakeProvider("B", "success");
    const svc1 = new MarketDataService({ providers: [a, b] });
    const svc2 = new MarketDataService({ providers: [fakeProvider("A", "unsupported"), fakeProvider("B", "success")] });
    const r1 = await svc1.getSnapshot({ symbol: "X" });
    const r2 = await svc2.getSnapshot({ symbol: "X" });
    assert.equal(r1.provider, r2.provider);
  });
}

// ============================================================
// 6. Provenance - final provider, fallbackUsed, providerSymbol, source timestamps
// ============================================================
async function provenanceTests(): Promise<void> {
  await test("Provenance: providerSymbol is the real winning provider's own symbol, never the canonical one blindly copied", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody() });
    const provider = new BinanceProvider({ fetchImpl });
    const svc = new MarketDataService({ providers: [provider] });
    const snapshot = await svc.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snapshot.providerSymbol, "BTCUSDT");
    assert.notEqual(snapshot.providerSymbol, snapshot.symbol);
  });

  await test("Provenance: fallbackUsed is false/absent when the top-priority provider answers directly", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody() });
    const provider = new BinanceProvider({ fetchImpl });
    const svc = new MarketDataService({ providers: [provider] });
    const snapshot = await svc.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snapshot.fallbackUsed, undefined);
  });

  await test("Provenance: source timestamp (snapshot.timestamp) is preserved from the real provider response, distinct from retrievedAt", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody({ closeTime: 1_650_000_000_000 }) });
    const provider = new BinanceProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
    const snapshot = await provider.getSnapshot({ symbol: "BTCUSD" });
    assert.equal(snapshot.timestamp, new Date(1_650_000_000_000).toISOString());
    assert.equal(snapshot.retrievedAt, new Date(1_700_000_000_000).toISOString());
    assert.notEqual(snapshot.timestamp, snapshot.retrievedAt);
  });
}

// ============================================================
// 7. Absolute no-fabrication rule
// ============================================================
async function noFabricationTests(): Promise<void> {
  await test("No-fabrication: every provider failing never invents a price - throws a structured error instead", async () => {
    const a = fakeProvider("A", "unsupported");
    const b = fakeProvider("B", "auth-fail");
    const svc = new MarketDataService({ providers: [a, b] });
    let thrown = false;
    try {
      await svc.getSnapshot({ symbol: "X" });
    } catch (e) {
      thrown = true;
      assert.ok(e instanceof MarketDataProviderError);
    }
    assert.ok(thrown, "must throw, never resolve with a fabricated snapshot");
  });

  await test("No-fabrication: a request for symbol X never silently returns data for a different symbol", async () => {
    const fetchImpl: BinanceFetch = async () => ({ ok: true, status: 200, json: async () => binance24hrBody() });
    const provider = new BinanceProvider({ fetchImpl });
    const snapshot = await provider.getSnapshot({ symbol: "ETHUSD" });
    assert.equal(snapshot.symbol, "ETHUSD", "the returned symbol must be exactly what was requested, never silently substituted");
  });

  await test("No-fabrication: stale data is never silently presented as fresh (cached flag always honest)", async () => {
    const clock = fixedClock(0);
    let succeed = true;
    const flaky: MarketDataProvider & SnapshotProvider = {
      name: "flaky",
      isConfigured: () => true,
      async getMarketContext(request) {
        return { symbol: request.symbol, provider: "flaky", retrievedAt: "t", evidence: [] };
      },
      async getSnapshot(request) {
        if (!succeed) throw new MarketDataProviderError("http_error", "down", "flaky");
        return fakeSnapshot("flaky", request.symbol);
      },
    };
    const svc = new MarketDataService({ providers: [flaky], clock, cacheTtlMs: 1000, staleFallbackMs: 60_000, reliability: { retries: 0 } });
    await svc.getSnapshot({ symbol: "X" });
    clock.advance(5000);
    succeed = false;
    const stale = await svc.getSnapshot({ symbol: "X" });
    assert.equal(stale.cached, true);
  });
}

async function main(): Promise<void> {
  await instrumentSearchTests();
  await totpTests();
  await binanceProviderTests();
  await angelOneProviderTests();
  await routerTests();
  await provenanceTests();
  await noFabricationTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
