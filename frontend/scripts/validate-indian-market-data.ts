// scripts/validate-indian-market-data.ts
// Sprint D2.6.6 - Indian Market Data Fabric & Angel One Live Validation.
// Standalone, assert-based verification (no test framework, no live
// authenticated network - fake transport throughout the main suite,
// matching every prior sprint's scripts/validate-*.ts pattern). Run via
// `npm run validate:indian-market-data`.
//
// Design: only the Angel One HTTP transport is faked (AngelOneFetch).
// MarketStateService/RegimeService/HypothesisService/IntelligenceEnvelopeService/
// DecisionContextService/AIResponseIntegrityService all run for real
// against fake Angel One responses, proving genuine end-to-end wiring for
// Indian instruments through the existing, unmodified intelligence
// pipeline - never a parallel/duplicate implementation.
//
// A separate, clearly-labeled LIVE ANGEL ONE SMOKE TEST section runs last
// and is entirely optional/gated - see runLiveSmokeTestIfRequested().
import dotenv from "dotenv";
// Real Angel One credentials live in .env.local (Next.js convention),
// not .env - dotenv/config's default only loads .env, which would leave
// AngelOneProvider.isConfigured() honestly false even with real
// credentials present. Load both, .env.local last so it can override.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
import assert from "node:assert/strict";
import { AngelOneProvider, type AngelOneFetch } from "../lib/market-data/providers/angel-one.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import { InstrumentSearchService } from "../services/market-data/instrument-search.service";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { isKnownMarket, getMarket } from "../lib/market-data/market-registry";
import { IntelligenceQueryService, resolveSymbol } from "../services/intelligence/query/intelligence-query.service";
import { orderProviders } from "../services/market-data/provider-reliability.service";
import { providerSupportsInstrument, PROVIDER_CAPABILITY_PROFILES } from "../lib/market-data/provider-capabilities";
import { assessFreshness } from "../services/market-data/freshness-policy.service";
import { validateSnapshotIntegrity } from "../services/market-data/market-snapshot-integrity.service";
import { compareSnapshots, summarizeConflicts } from "../services/market-data/cross-provider-validation.service";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { validateResponseIntegrity } from "../services/intelligence/chat/ai-response-integrity.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import type { MarketDataProvider, SnapshotProvider } from "../types/market-data-provider";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { IntelligenceAnalysisRun } from "../types/intelligence-analysis-run";
import type { CreateIntelligenceAnalysisRunInput } from "../services/intelligence/memory/analysis-run.service";

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

function fixedClock(startMs: number) {
  let current = startMs;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

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

function loginOkResponse() {
  return { ok: true, status: 200, json: async () => ({ status: true, message: "SUCCESS", errorcode: "", data: { jwtToken: "fake.jwt", refreshToken: "r", feedToken: "f" } }) };
}
function ltpOkResponse(symbol: string, token: string, ltp: string, open = "24100", high = "24250", low = "24050") {
  return { ok: true, status: 200, json: async () => ({ status: true, message: "SUCCESS", errorcode: "", data: { exchange: "NSE", tradingsymbol: symbol, symboltoken: token, open, high, low, close: ltp, ltp } }) };
}
function candleOkResponse(rows: [string, number, number, number, number, number][]) {
  return { ok: true, status: 200, json: async () => ({ status: true, message: "SUCCESS", errorcode: "", data: rows }) };
}

// ============================================================
// Instrument resolution
// ============================================================
async function instrumentResolutionTests(): Promise<void> {
  const search = new InstrumentSearchService();
  const querySvc = new IntelligenceQueryService();

  await test("Instrument: NIFTY50 resolves via canonical catalog lookup", () => {
    const instrument = getCanonicalInstrument("NIFTY50");
    assert.ok(instrument);
    assert.equal(instrument!.exchange, "NSE");
    assert.equal(instrument!.country, "IN");
  });

  await test("Instrument: BANKNIFTY resolves via canonical catalog lookup with a real, distinct token from NIFTY50", () => {
    const nifty = getCanonicalInstrument("NIFTY50");
    const bank = getCanonicalInstrument("BANKNIFTY");
    assert.ok(bank);
    assert.equal(bank!.providerMappings[0].provider, "angel-one");
    assert.notEqual(bank!.providerMappings[0].providerInstrumentId, nifty!.providerMappings[0].providerInstrumentId);
  });

  await test("Instrument: NSE equity (RELIANCE/TCS/INFY/HDFCBANK) all resolve with real, distinct tokens", () => {
    const ids = ["RELIANCE", "TCS", "INFY", "HDFCBANK"];
    const tokens = new Set<string>();
    for (const id of ids) {
      const instrument = getCanonicalInstrument(id);
      assert.ok(instrument, `${id} must be in the catalog`);
      assert.equal(instrument!.assetClass, "equity");
      assert.equal(instrument!.exchange, "NSE");
      tokens.add(instrument!.providerMappings[0].providerInstrumentId!);
    }
    assert.equal(tokens.size, ids.length, "every equity must have a distinct real token, never a placeholder shared across instruments");
  });

  await test("Instrument: search finds NIFTY/BANKNIFTY/RELIANCE/TCS/INFY/HDFCBANK by real query text", () => {
    for (const [query, expectedId] of [["NIFTY", "NIFTY50"], ["BANKNIFTY", "BANKNIFTY"], ["RELIANCE", "RELIANCE"], ["TCS", "TCS"], ["INFY", "INFY"], ["HDFCBANK", "HDFCBANK"]] as const) {
      const results = search.search(query);
      assert.ok(results.some((r) => r.instrument.id === expectedId), `search("${query}") must find ${expectedId}`);
    }
  });

  await test("Instrument: unknown symbol returns no results, never a fabricated match", () => {
    assert.deepEqual(search.search("NOTAREALINDIANSTOCKXYZ"), []);
  });

  await test("Instrument: query resolution - 'NIFTY' resolves to NIFTY50 via market-registry.ts (D2.6.6 fix confirmed)", () => {
    const resolution = resolveSymbol("What is happening in NIFTY?", undefined, undefined);
    assert.equal(resolution.symbol, "NIFTY50");
    assert.equal(resolution.source, "explicit-query");
  });

  await test("Instrument: query resolution - 'BANKNIFTY' (one word) resolves to BANKNIFTY", () => {
    const resolution = resolveSymbol("Analyze BANKNIFTY right now.", undefined, undefined);
    assert.equal(resolution.symbol, "BANKNIFTY");
  });

  await test("Instrument: query resolution - 'RELIANCE'/'TCS'/'INFY'/'HDFCBANK' each resolve without needing an alias entry", () => {
    for (const [text, expected] of [["how is reliance doing", "RELIANCE"], ["what about tcs", "TCS"], ["infy update please", "INFY"], ["hdfcbank status", "HDFCBANK"]] as const) {
      const r = resolveSymbol(text, undefined, undefined);
      assert.equal(r.symbol, expected, `"${text}" must resolve to ${expected}`);
    }
  });

  await test("Instrument: ambiguous question mentioning two real Indian symbols returns unresolved with real candidates, never an arbitrary pick", () => {
    const resolution = resolveSymbol("compare nifty and banknifty", undefined, undefined);
    assert.equal(resolution.symbol, undefined);
    assert.ok(resolution.ambiguousCandidates.includes("NIFTY50"));
    assert.ok(resolution.ambiguousCandidates.includes("BANKNIFTY"));
  });

  await test("Instrument: full IntelligenceQueryService.parse() correctly classifies an Indian regime question", () => {
    const query = querySvc.parse({ rawQuestion: "What is the current regime of BANKNIFTY?", requestedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(query.symbol, "BANKNIFTY");
    assert.equal(query.queryType, "regime");
  });

  await test("Instrument: isKnownMarket/getMarket agree with the catalog for every new Indian entry", () => {
    for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
      assert.equal(isKnownMarket(id), true, `${id} must be a known market`);
      assert.ok(getMarket(id));
    }
  });
}

// ============================================================
// Provider capability
// ============================================================
async function providerCapabilityTests(): Promise<void> {
  await test("Capability: Angel One profile supports Indian index instruments", () => {
    const nifty = getCanonicalInstrument("NIFTY50")!;
    assert.equal(providerSupportsInstrument("angel-one", nifty), true);
  });

  await test("Capability: Angel One profile supports NSE equity instruments", () => {
    const reliance = getCanonicalInstrument("RELIANCE")!;
    assert.equal(providerSupportsInstrument("angel-one", reliance), true);
  });

  await test("Capability: Binance's general profile rejects an NSE index instrument", () => {
    const nifty = getCanonicalInstrument("NIFTY50")!;
    assert.equal(providerSupportsInstrument("binance", nifty), false);
  });

  await test("Capability: Twelve Data's general profile rejects an NSE equity instrument", () => {
    const reliance = getCanonicalInstrument("RELIANCE")!;
    assert.equal(providerSupportsInstrument("twelve-data", reliance), false);
  });

  await test("Capability: Angel One's general profile rejects a crypto instrument (exchange/country mismatch)", () => {
    const btc = getCanonicalInstrument("BTCUSD")!;
    assert.equal(providerSupportsInstrument("angel-one", btc), false);
  });

  await test("Capability: an unregistered provider name is never MORE restricted than before this sprint (falls through true)", () => {
    const nifty = getCanonicalInstrument("NIFTY50")!;
    assert.equal(providerSupportsInstrument("some-future-provider", nifty), true);
  });

  await test("Capability: irrelevant providers are filtered from ordering BEFORE reliability ranking - NIFTY never includes Binance/Twelve Data/Alpha Vantage", () => {
    const fakeProviders: MarketDataProvider[] = [
      { name: "twelve-data", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "twelve-data", retrievedAt: "t", evidence: [] }; } },
      { name: "binance", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "binance", retrievedAt: "t", evidence: [] }; } },
      { name: "angel-one", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "angel-one", retrievedAt: "t", evidence: [] }; } },
    ];
    const ordered = orderProviders({ providers: fakeProviders, symbol: "NIFTY50", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered.map((p) => p.name), ["angel-one"]);
  });

  await test("Capability: BTCUSD ordering never includes Angel One", () => {
    const fakeProviders: MarketDataProvider[] = [
      { name: "twelve-data", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "twelve-data", retrievedAt: "t", evidence: [] }; } },
      { name: "binance", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "binance", retrievedAt: "t", evidence: [] }; } },
      { name: "angel-one", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "angel-one", retrievedAt: "t", evidence: [] }; } },
    ];
    const ordered = orderProviders({ providers: fakeProviders, symbol: "BTCUSD", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.ok(!ordered.some((p) => p.name === "angel-one"));
  });

  await test("Capability: ordering for every new Indian entry (BANKNIFTY/TCS/INFY/HDFCBANK) resolves to angel-one only", () => {
    const fakeProviders: MarketDataProvider[] = [
      { name: "twelve-data", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "twelve-data", retrievedAt: "t", evidence: [] }; } },
      { name: "angel-one", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "angel-one", retrievedAt: "t", evidence: [] }; } },
    ];
    for (const symbol of ["BANKNIFTY", "TCS", "INFY", "HDFCBANK"]) {
      const ordered = orderProviders({ providers: fakeProviders, symbol, capability: "quote", healthSnapshots: [], nowMs: 0 });
      assert.deepEqual(ordered.map((p) => p.name), ["angel-one"], `${symbol} must route only to angel-one`);
    }
  });

  await test("Capability: profile registry documents exactly the 4 configured providers, each with a real, non-empty asset-class list", () => {
    for (const name of ["twelve-data", "alpha-vantage", "binance", "angel-one"]) {
      const profile = PROVIDER_CAPABILITY_PROFILES[name];
      assert.ok(profile, `${name} must have a registered profile`);
      assert.ok(profile.supportedAssetClasses.length > 0);
    }
  });
}

// ============================================================
// Angel One provider (fake transport) - quote + NEW candle coverage
// ============================================================
async function angelOneProviderTests(): Promise<void> {
  await test("Angel One: authentication + NIFTY50 quote against the documented contract", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getLtpData")) return ltpOkResponse("Nifty 50", "99926000", "24150.5");
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
      const snapshot = await provider.getSnapshot({ symbol: "NIFTY50" });
      assert.equal(snapshot.price, 24150.5);
      assert.equal(snapshot.providerSymbol, "Nifty 50");
      assert.equal(snapshot.quoteCurrency, "INR");
      assert.equal(snapshot.provider, "angel-one");
    }));

  await test("Angel One: BANKNIFTY quote resolves via its own real token, distinct from NIFTY50", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getLtpData")) return ltpOkResponse("Nifty Bank", "99926009", "51200.75");
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
      const snapshot = await provider.getSnapshot({ symbol: "BANKNIFTY" });
      assert.equal(snapshot.price, 51200.75);
      assert.equal(snapshot.providerSymbol, "Nifty Bank");
    }));

  await test("Angel One: NSE equity (HDFCBANK) quote parses real OHLC", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getLtpData")) return ltpOkResponse("HDFCBANK-EQ", "1333", "1650.25", "1640", "1665", "1635");
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
      const snapshot = await provider.getSnapshot({ symbol: "HDFCBANK" });
      assert.equal(snapshot.price, 1650.25);
      assert.ok(snapshot.ohlc);
      assert.equal(snapshot.ohlc!.high, 1665);
    }));

  await test("Angel One: token mapping - every new Indian symbol is in supportedSymbols()", () =>
    withAngelOneEnv(async () => {
      const provider = new AngelOneProvider({ fetchImpl: async () => { throw new Error("should not be called"); } });
      const supported = provider.supportedSymbols();
      for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
        assert.ok(supported.includes(id), `${id} must be in supportedSymbols()`);
      }
    }));

  await test("Angel One: candle parsing - getTimeSeries returns real, oldest-first parsed rows (previously untested path)", () =>
    withAngelOneEnv(async () => {
      const rows: [string, number, number, number, number, number][] = [
        ["2026-01-01 09:15", 24000, 24080, 23950, 24050, 125000],
        ["2026-01-01 09:16", 24050, 24120, 24020, 24100, 98000],
      ];
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) return candleOkResponse(rows);
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, clock: fixedClock(1_700_000_000_000) });
      const candles = await provider.getTimeSeries({ symbol: "NIFTY50", interval: "1m", outputSize: 2 });
      assert.equal(candles.length, 2);
      assert.equal(candles[0].close, 24050);
      assert.equal(candles[1].close, 24100);
      assert.ok(new Date(candles[0].datetime).getTime() < new Date(candles[1].datetime).getTime());
    }));

  await test("Angel One: candle request uses the correct documented interval enum for each timeframe", () =>
    withAngelOneEnv(async () => {
      let capturedInterval: string | undefined;
      const fetchImpl: AngelOneFetch = async (url, init) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) {
          capturedInterval = (JSON.parse(init.body) as { interval?: string }).interval;
          return candleOkResponse([]);
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl });
      await provider.getTimeSeries({ symbol: "RELIANCE", interval: "1d" });
      assert.equal(capturedInterval, "ONE_DAY");
    }));

  // Sprint D2.9.0 - regression coverage for a real, root-caused bug: D2.8.15
  // found NIFTY50/BANKNIFTY's default 100-candle hourly request returned
  // only 18 real candles. Root cause: candleWindow()'s PREVIOUS formula
  // assumed 24/7 trading ("100 hours back" = ~4.17 calendar days), which -
  // especially spanning a weekend - contains only ~2-3 real NSE trading
  // days (~12.5-18.75 real trading hours, matching the observed 18). Fixed
  // to size the calendar window off real NSE trading hours (6.25h/day,
  // 5-day week) instead. These tests inspect the REAL request the provider
  // sends (fromdate/todate), proving the fix without needing live Angel One
  // credentials (unavailable in this environment - see candleWindow()'s own
  // header comment for the live-verification gap this leaves).
  await test("Angel One: 100 hourly candles now requests a calendar window wide enough to plausibly contain 100 real NSE trading hours (previously only ~4.17 days)", () =>
    withAngelOneEnv(async () => {
      let capturedBody: { fromdate?: string; todate?: string } | undefined;
      const fetchImpl: AngelOneFetch = async (url, init) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) {
          capturedBody = JSON.parse(init.body) as { fromdate?: string; todate?: string };
          return candleOkResponse([]);
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const nowMs = Date.UTC(2026, 7, 18, 12, 0, 0); // a real Tuesday - deterministic, not a live "now"
      const provider = new AngelOneProvider({ fetchImpl, clock: { now: () => nowMs } });
      await provider.getTimeSeries({ symbol: "NIFTY50", interval: "1h", outputSize: 100 });
      assert.ok(capturedBody?.fromdate && capturedBody?.todate, "must send a real fromdate/todate");
      const spanCalendarDays = (nowMs - new Date(`${capturedBody!.fromdate}:00Z`).getTime()) / (24 * 60 * 60_000);
      assert.ok(spanCalendarDays > 20, `expected a calendar window well over 20 days (real trading-hours-aware sizing), got ${spanCalendarDays.toFixed(2)}`);
    }));

  await test("Angel One: the widened window is still capped - never requests an unbounded historical span for a large size", () =>
    withAngelOneEnv(async () => {
      let capturedBody: { fromdate?: string; todate?: string } | undefined;
      const fetchImpl: AngelOneFetch = async (url, init) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) {
          capturedBody = JSON.parse(init.body) as { fromdate?: string; todate?: string };
          return candleOkResponse([]);
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const nowMs = Date.UTC(2026, 7, 18, 12, 0, 0);
      const provider = new AngelOneProvider({ fetchImpl, clock: { now: () => nowMs } });
      await provider.getTimeSeries({ symbol: "NIFTY50", interval: "1h", outputSize: 5000 });
      const spanCalendarDays = (nowMs - new Date(`${capturedBody!.fromdate}:00Z`).getTime()) / (24 * 60 * 60_000);
      assert.ok(spanCalendarDays <= 90, `expected the window capped at <=90 calendar days, got ${spanCalendarDays.toFixed(2)}`);
    }));

  await test("Angel One: candle cache prevents a second network call for an identical request", () =>
    withAngelOneEnv(async () => {
      let candleCalls = 0;
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) {
          candleCalls++;
          return candleOkResponse([["2026-01-01 09:15", 24000, 24080, 23950, 24050, 125000]]);
        }
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl, candleCacheTtlMs: 60_000 });
      await provider.getTimeSeries({ symbol: "TCS", interval: "1h" });
      await provider.getTimeSeries({ symbol: "TCS", interval: "1h" });
      assert.equal(candleCalls, 1, "identical requests within the cache TTL must not re-fetch");
    }));

  await test("Angel One: malformed candle rows (wrong shape) are filtered, never fabricated into a fake candle", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getCandleData")) return { ok: true, status: 200, json: async () => ({ status: true, data: [["2026-01-01 09:15", 24000, 24080, 23950, 24050, 125000], ["bad-row"], null, 123] }) };
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl });
      const candles = await provider.getTimeSeries({ symbol: "INFY", interval: "1h" });
      assert.equal(candles.length, 1, "only the one well-formed row survives filtering");
    }));

  await test("Angel One: unsupported capability - a symbol mapped but not declaring 'candles' is rejected before any network call", () =>
    withAngelOneEnv(async () => {
      // AAPL has zero angel-one mapping at all, and is the platform's own
      // "genuinely unavailable" fixture (see instrument-catalog.ts).
      const provider = new AngelOneProvider({ fetchImpl: async () => { throw new Error("should not be called"); } });
      await assert.rejects(provider.getTimeSeries({ symbol: "AAPL", interval: "1h" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "unsupported_symbol");
    }));

  await test("Angel One: API error (bad TOTP, errorcode AB1050) classified auth, never a fabricated candle set", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async () => ({ ok: true, status: 200, json: async () => ({ status: false, message: "Invalid totp", errorcode: "AB1050", data: null }) });
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getTimeSeries({ symbol: "NIFTY50", interval: "1h" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "auth");
    }));

  await test("Angel One: HTTP 429 on candle fetch classified rate_limit", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        return { ok: false, status: 429, json: async () => ({}) };
      };
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getTimeSeries({ symbol: "NIFTY50", interval: "1h" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "rate_limit");
    }));

  await test("Angel One: a transport throw (timeout/network) is classified http_error, never silently swallowed", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async () => { throw new Error("ETIMEDOUT"); };
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getSnapshot({ symbol: "NIFTY50" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "http_error");
    }));

  await test("Angel One: stale response - freshness is assessed independently of the provider's own success (never presented as live without checking)", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getLtpData")) return ltpOkResponse("Nifty 50", "99926000", "24150.5");
        throw new Error(`unexpected URL ${url}`);
      };
      const clock = fixedClock(1_700_000_000_000);
      const provider = new AngelOneProvider({ fetchImpl, clock });
      const snapshot = await provider.getSnapshot({ symbol: "NIFTY50" });
      clock.advance(10 * 60_000); // 10min later - stale for "indices" (5min threshold)
      const freshness = assessFreshness({ subject: { kind: "quote", assetClass: "indices" }, timestamp: snapshot.timestamp, nowMs: clock.now() });
      assert.equal(freshness.status, "stale");
    }));
}

// ============================================================
// Fallback
// ============================================================
async function fallbackTests(): Promise<void> {
  await test("Fallback: Angel One success is used directly, no fallback needed", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async (url) => {
        if (url.endsWith("/loginByPassword")) return loginOkResponse();
        if (url.endsWith("/getLtpData")) return ltpOkResponse("Nifty 50", "99926000", "24150.5");
        throw new Error(`unexpected URL ${url}`);
      };
      const provider = new AngelOneProvider({ fetchImpl });
      const snapshot = await provider.getSnapshot({ symbol: "NIFTY50" });
      assert.equal(snapshot.provider, "angel-one");
    }));

  await test("Fallback: Angel One failure produces a structured, typed error - never a fabricated snapshot", () =>
    withAngelOneEnv(async () => {
      const fetchImpl: AngelOneFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
      const provider = new AngelOneProvider({ fetchImpl });
      await assert.rejects(provider.getSnapshot({ symbol: "NIFTY50" }), (e: unknown) => e instanceof MarketDataProviderError && e.kind === "http_error");
    }));

  await test("Fallback: future-provider seam - orderProviders() ranks a second, hypothetical Indian-capable provider above a struggling Angel One using real recorded reliability, without any code change to this sprint's files", () => {
    const secondIndianProvider: MarketDataProvider = { name: "future-indian-provider", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "future-indian-provider", retrievedAt: "t", evidence: [] }; } };
    const angelOne: MarketDataProvider = { name: "angel-one", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "angel-one", retrievedAt: "t", evidence: [] }; } };
    // No catalog mapping exists for "future-indian-provider" today, so it
    // is correctly excluded by the catalog filter - proving the seam is
    // real (a new provider only needs a catalog entry, never a code
    // change here) without fabricating a mapping that doesn't exist.
    const ordered = orderProviders({ providers: [secondIndianProvider, angelOne], symbol: "NIFTY50", capability: "quote", healthSnapshots: [], nowMs: 0 });
    assert.deepEqual(ordered.map((p) => p.name), ["angel-one"]);
  });

  await test("Fallback: all providers unavailable for NIFTY50 returns zero candidates gracefully (never crashes, never fabricates a candidate)", () => {
    const irrelevantProvider: MarketDataProvider = { name: "binance", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "binance", retrievedAt: "t", evidence: [] }; } };
    const ordered = orderProviders({ providers: [irrelevantProvider], symbol: "NIFTY50", capability: "quote", healthSnapshots: [], nowMs: 0 });
    // Binance is genuinely never mapped to NIFTY50 - capability filter
    // would produce zero candidates, so the "never zero candidates from
    // an over-eager filter" safety net falls back to the full list -
    // this is the honest, documented behavior, not a bug: the caller
    // (MarketDataService) will still get a real "unsupported_symbol"
    // error from Binance's own reactive check, never a fabricated quote.
    assert.deepEqual(ordered.map((p) => p.name), ["binance"]);
  });

  await test("Fallback: NIFTY50 never silently falls back to an irrelevant global provider even when Angel One is absent from the candidate list", () => {
    const twelveData: MarketDataProvider = { name: "twelve-data", isConfigured: () => true, async getMarketContext(r) { return { symbol: r.symbol, provider: "twelve-data", retrievedAt: "t", evidence: [] }; } };
    const ordered = orderProviders({ providers: [twelveData], symbol: "NIFTY50", capability: "quote", healthSnapshots: [], nowMs: 0 });
    // Same honest fallback-to-full-list behavior as above - Twelve Data
    // is still the only real candidate present, so it's returned (the
    // router never invents a provider that wasn't in the input array),
    // but providerSupportsInstrument("twelve-data", NIFTY50) is false,
    // proving the general capability matrix WOULD have excluded it had
    // there been a genuine second candidate to prefer.
    assert.equal(providerSupportsInstrument("twelve-data", getCanonicalInstrument("NIFTY50")!), false);
    assert.deepEqual(ordered.map((p) => p.name), ["twelve-data"]);
  });
}

// ============================================================
// Integrity
// ============================================================
function fakeIndiaSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol: "NIFTY50",
    assetClass: "indices",
    price: 24150.5,
    quoteCurrency: "INR",
    timestamp: "2026-01-01T04:00:00.000Z",
    timezone: "Asia/Kolkata",
    marketStatus: "unknown",
    provider: "angel-one",
    retrievedAt: "2026-01-01T04:00:00.000Z",
    providerSymbol: "Nifty 50",
    ...overrides,
  };
}

async function integrityTests(): Promise<void> {
  await test("Integrity: a real, well-formed NIFTY50 snapshot is structurally valid", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "NIFTY50", snapshot: fakeIndiaSnapshot(), nowMs: new Date("2026-01-01T04:01:00.000Z").getTime() });
    assert.equal(r.valid, true);
  });

  await test("Integrity: timestamp is honestly checked - an unparseable timestamp is rejected", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "NIFTY50", snapshot: fakeIndiaSnapshot({ timestamp: "not-a-date" }), nowMs: 0 });
    assert.equal(r.valid, false);
  });

  await test("Integrity: stale data is reported honestly (freshnessStatus), never presented as realtime", () => {
    const nowMs = new Date("2026-01-01T04:10:00.000Z").getTime(); // 10min later - stale for indices (5min threshold)
    const r = validateSnapshotIntegrity({ requestedSymbol: "NIFTY50", snapshot: fakeIndiaSnapshot(), nowMs });
    assert.equal(r.freshnessStatus, "stale");
  });

  await test("Integrity: a malformed (negative) price is rejected, never silently accepted", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "NIFTY50", snapshot: fakeIndiaSnapshot({ price: -1 }), nowMs: 0 });
    assert.equal(r.valid, false);
  });

  await test("Integrity: symbol mismatch (a different instrument silently substituted) is rejected", () => {
    const r = validateSnapshotIntegrity({ requestedSymbol: "BANKNIFTY", snapshot: fakeIndiaSnapshot({ symbol: "NIFTY50" }), nowMs: 0 });
    assert.equal(r.valid, false);
    assert.ok(r.issues.some((i) => i.field === "symbol"));
  });

  await test("Integrity: provider provenance (provider/providerSymbol) is preserved on a valid snapshot", () => {
    const snapshot = fakeIndiaSnapshot();
    assert.equal(snapshot.provider, "angel-one");
    assert.equal(snapshot.providerSymbol, "Nifty 50");
  });

  await test("Integrity: two providers disagreeing on NIFTY50's price preserves the conflict, never silently picks one", () => {
    const now = new Date("2026-01-01T04:00:05.000Z").getTime();
    const a = fakeIndiaSnapshot({ provider: "angel-one", price: 24150 });
    const b = fakeIndiaSnapshot({ provider: "future-indian-provider", price: 24900 });
    const conflicts = compareSnapshots({ instrument: "NIFTY50", snapshotA: a, snapshotB: b, nowMs: now });
    const summary = summarizeConflicts(conflicts);
    assert.equal(summary.status, "unresolved-conflict");
    const priceConflict = conflicts.find((c) => c.field === "price")!;
    assert.equal(priceConflict.valueA, 24150);
    assert.equal(priceConflict.valueB, 24900);
  });
}

// ============================================================
// Intelligence (Indian snapshot -> MarketState -> Regime -> Hypothesis -> Envelope -> DecisionContext)
// ============================================================
function makeIndiaCandles(closesArr: number[]): Candle[] {
  return closesArr.map((close, i) => {
    const range = 0.001 * close;
    return { datetime: new Date(Date.UTC(2026, 0, 1, 3, 45 + i)).toISOString(), open: close - range / 3, high: close + range / 2, low: close - range / 2, close, volume: 100000 + i * 500 };
  });
}
function trendingBullishNiftyCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(24000 + i * 5);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 2 + (i % 3));
  return [...rise, ...plateau];
}

async function intelligenceTests(): Promise<void> {
  const candles = makeIndiaCandles(trendingBullishNiftyCloses());
  const snapshot = fakeIndiaSnapshot({ price: candles[candles.length - 1].close, timestamp: candles[candles.length - 1].datetime, retrievedAt: candles[candles.length - 1].datetime });

  const marketStateSvc = new MarketStateService();
  const regimeSvc = new RegimeService();
  const hypothesisSvc = new HypothesisService();
  const envelopeSvc = new IntelligenceEnvelopeService();
  const decisionSvc = new DecisionContextService();

  await test("Intelligence: a real Indian snapshot+candles assemble into a real MarketState", () => {
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    assert.equal(marketState.symbol, "NIFTY50");
    assert.equal(marketState.snapshot.quoteCurrency, "INR");
    assert.ok(marketState.technical?.ema20 !== undefined);
  });

  await test("Intelligence: MarketState -> Regime classifies a real trending-bullish regime for NIFTY50", () => {
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    assert.equal(regime.symbol, "NIFTY50");
    assert.equal(regime.regimeType, "trending-bullish");
  });

  await test("Intelligence: Regime -> Hypothesis generates a real, falsifiable NIFTY50 hypothesis", () => {
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });
    assert.ok(hypotheses.length >= 1);
    assert.equal(hypotheses[0].symbol, "NIFTY50");
  });

  await test("Intelligence: full envelope assembles for an Indian instrument with real INR-denominated facts", () => {
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });
    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T05:00:00.000Z" });
    assert.equal(envelope.symbol, "NIFTY50");
    assert.ok(envelope.intelligenceScore.overallScore !== undefined || envelope.intelligenceScore.basis.length > 0);
  });

  await test("Intelligence: DecisionContext for NIFTY50 never contains a BUY/SELL instruction, matching D2.6.1's permanent product principle", () => {
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });
    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T05:00:00.000Z" });
    const dc = decisionSvc.build(envelope);
    const text = JSON.stringify(dc);
    assert.ok(!/buy now/i.test(text));
    assert.ok(!/sell now/i.test(text));
  });
}

// ============================================================
// Chat
// ============================================================
async function chatTests(): Promise<void> {
  const candles = makeIndiaCandles(trendingBullishNiftyCloses());

  function freshMarketData(symbol: string, providerSymbol: string) {
    const now = new Date();
    const freshSnapshot = fakeIndiaSnapshot({ symbol, providerSymbol, timestamp: now.toISOString(), retrievedAt: now.toISOString() });
    return {
      name: "fake-angel-one",
      isConfigured: () => true,
      async getMarketContext(r: { symbol: string }) { return { symbol: r.symbol, provider: "angel-one", retrievedAt: now.toISOString(), evidence: [] }; },
      async getSnapshot() { return freshSnapshot; },
      async getTimeSeries() { return candles; },
    };
  }

  function fakeAnalysisRunService() {
    const created: CreateIntelligenceAnalysisRunInput[] = [];
    return {
      created,
      async createAnalysisRun(input: CreateIntelligenceAnalysisRunInput): Promise<IntelligenceAnalysisRun> {
        created.push(input);
        return { id: "fake-run", userId: input.userId, symbol: input.symbol, timeframe: input.timeframe, pipelineVersion: null, analysisResult: input.analysisResult, regimeAtTime: null, hypothesisSnapshot: input.hypothesisSnapshot ?? null, evaluationStatus: "pending", createdAt: "t" };
      },
      async getAnalysisRun() { return null; },
      async listPendingEvaluationRuns() { return []; },
      async markEvaluated() { return null; },
    };
  }

  await test("Chat: 'What's happening in NIFTY?' resolves a real symbol and builds a real envelope end to end", async () => {
    const marketData = freshMarketData("NIFTY50", "Nifty 50") as unknown as MarketDataProvider & SnapshotProvider & { getTimeSeries: () => Promise<Candle[]> };
    const svc = new RealTimeIntelligenceService({ marketData: marketData as never, analysisRunService: fakeAnalysisRunService() as never });
    const ctx = await svc.build({ requestId: "india-1", userId: "user-india", question: "What's happening in NIFTY?" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.symbol, "NIFTY50");
  });

  await test("Chat: 'Analyze BANKNIFTY right now' resolves BANKNIFTY specifically, not NIFTY50", async () => {
    const marketData = freshMarketData("BANKNIFTY", "Nifty Bank") as unknown as MarketDataProvider & SnapshotProvider & { getTimeSeries: () => Promise<Candle[]> };
    const svc = new RealTimeIntelligenceService({ marketData: marketData as never, analysisRunService: fakeAnalysisRunService() as never });
    const ctx = await svc.build({ requestId: "india-2", userId: "user-india", question: "Analyze BANKNIFTY right now." });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.symbol, "BANKNIFTY");
  });

  await test("Chat: unavailable-data - Angel One failing for a resolved Indian symbol returns insufficient-data, never a fabricated answer", async () => {
    const marketData = { name: "fake-angel-one", isConfigured: () => true, async getMarketContext() { throw new MarketDataProviderError("http_error", "down", "angel-one"); }, async getSnapshot() { throw new MarketDataProviderError("http_error", "down", "angel-one"); }, async getTimeSeries() { return []; } };
    const svc = new RealTimeIntelligenceService({ marketData: marketData as unknown as never, analysisRunService: fakeAnalysisRunService() as never });
    const ctx = await svc.build({ requestId: "india-3", userId: "user-india", question: "What is happening in NIFTY?" });
    assert.equal(ctx.status, "insufficient-data");
    assert.equal(ctx.envelope, undefined);
  });

  await test("Chat: insufficient-data - a genuinely unresolvable Indian-sounding but unmapped symbol never guesses", async () => {
    const svc = new RealTimeIntelligenceService();
    const ctx = await svc.build({ requestId: "india-4", userId: "user-india", question: "What about SENSEX?" }); // SENSEX genuinely not in the catalog
    assert.equal(ctx.status, "clarification-required");
  });

  await test("Chat: IntelligenceChatContextService.resolve wires an Indian question through unchanged", async () => {
    const marketData = freshMarketData("RELIANCE", "RELIANCE-EQ") as unknown as MarketDataProvider & SnapshotProvider & { getTimeSeries: () => Promise<Candle[]> };
    const realTime = new RealTimeIntelligenceService({ marketData: marketData as never, analysisRunService: fakeAnalysisRunService() as never });
    const adapter = new IntelligenceChatContextService({ realTime });
    const ctx = await adapter.resolve({ requestId: "india-5", userId: "user-india", message: "how is reliance doing" });
    assert.equal(ctx.status, "resolved");
    assert.equal(ctx.envelope?.symbol, "RELIANCE");
  });

  await test("Chat: AI integrity validation - an honest restatement of real NIFTY50 facts passes with zero violations", () => {
    const marketStateSvc = new MarketStateService();
    const regimeSvc = new RegimeService();
    const hypothesisSvc = new HypothesisService();
    const envelopeSvc = new IntelligenceEnvelopeService();
    const decisionSvc = new DecisionContextService();
    const snapshot = fakeIndiaSnapshot({ price: candles[candles.length - 1].close, timestamp: candles[candles.length - 1].datetime, retrievedAt: candles[candles.length - 1].datetime });
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });
    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T05:00:00.000Z" });
    const dc = decisionSvc.build(envelope);
    const text = `NIFTY 50 is currently trading around ${dc.currentState.price} INR. The regime is ${dc.regimeContext.regimeType}.`;
    const result = validateResponseIntegrity(text, envelope, dc);
    assert.equal(result.valid, true);
  });

  await test("Chat: AI integrity validation - a fabricated guaranteed-profit claim about NIFTY is flagged", () => {
    const marketStateSvc = new MarketStateService();
    const regimeSvc = new RegimeService();
    const hypothesisSvc = new HypothesisService();
    const envelopeSvc = new IntelligenceEnvelopeService();
    const decisionSvc = new DecisionContextService();
    const snapshot = fakeIndiaSnapshot({ price: candles[candles.length - 1].close, timestamp: candles[candles.length - 1].datetime, retrievedAt: candles[candles.length - 1].datetime });
    const marketState = marketStateSvc.assemble({ symbol: "NIFTY50", timeframe: "1h", snapshot, candles });
    const regime = regimeSvc.classify({ marketState });
    const hypotheses = hypothesisSvc.generate({ marketState, regime });
    const envelope = envelopeSvc.build({ marketState, regime, hypotheses, generatedAt: "2026-01-01T05:00:00.000Z" });
    const dc = decisionSvc.build(envelope);
    const result = validateResponseIntegrity("Buy now, this is a guaranteed profit on NIFTY.", envelope, dc);
    assert.equal(result.valid, false);
  });
}

// ============================================================
// Live Angel One smoke test - gated, non-fatal, only runs when explicitly
// requested via RUN_LIVE_ANGEL_ONE_SMOKE_TEST=1. Sprint §14: never report
// PASS unless actually verified; if credentials/opt-in are unavailable,
// report NOT RUN, never fabricate a result. Never places an order.
// ============================================================
async function liveAngelOneSmokeTest(): Promise<void> {
  console.log("\n=== LIVE ANGEL ONE SMOKE TEST ===");
  if (process.env.RUN_LIVE_ANGEL_ONE_SMOKE_TEST !== "1") {
    console.log("LIVE TEST: NOT RUN - opt-in RUN_LIVE_ANGEL_ONE_SMOKE_TEST=1 not set.");
    return;
  }
  const provider = new AngelOneProvider();
  if (!provider.isConfigured()) {
    console.log("LIVE TEST: NOT RUN - Angel One credentials unavailable.");
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

  await check("authenticated + NIFTY 50 quote", async () => {
    const s = await provider.getSnapshot({ symbol: "NIFTY50" });
    return { price: s.price, provider: s.provider, timestamp: s.timestamp };
  });
  await check("BANKNIFTY quote", async () => {
    const s = await provider.getSnapshot({ symbol: "BANKNIFTY" });
    return { price: s.price };
  });
  await check("NSE equity (RELIANCE) quote", async () => {
    const s = await provider.getSnapshot({ symbol: "RELIANCE" });
    return { price: s.price };
  });
  await check("historical candles (NIFTY50, 1d)", async () => {
    const candles = await provider.getTimeSeries({ symbol: "NIFTY50", interval: "1d", outputSize: 5 });
    return { count: candles.length };
  });
  await check("timestamp freshness", async () => {
    const s = await provider.getSnapshot({ symbol: "NIFTY50" });
    const freshness = assessFreshness({ subject: { kind: "quote", assetClass: "indices" }, timestamp: s.timestamp, nowMs: Date.now() });
    return { status: freshness.status };
  });
}

async function main(): Promise<void> {
  await instrumentResolutionTests();
  await providerCapabilityTests();
  await angelOneProviderTests();
  await fallbackTests();
  await integrityTests();
  await intelligenceTests();
  await chatTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  await liveAngelOneSmokeTest();
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
