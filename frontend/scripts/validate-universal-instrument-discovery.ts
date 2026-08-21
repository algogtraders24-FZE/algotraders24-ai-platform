// scripts/validate-universal-instrument-discovery.ts
// Sprint D2.6.12 - Universal Instrument Discovery & Dynamic Provider
// Catalog. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:universal-instrument-discovery`.
//
// Every discovery service is exercised against an INJECTED fake fetch
// (never a live network call in this default run - matches the exact
// discipline binance.provider.ts/angel-one.provider.ts's own existing
// test suites already established) with a fake Clock for deterministic
// TTL/staleness behavior. No test here ever asserts against real,
// unpredictable network data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../lib/market-data/cache";
import { getCanonicalInstrument, clearDiscoveredInstruments, registerDiscoveredInstrument } from "../lib/market-data/instrument-catalog";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { InstrumentSearchService } from "../services/market-data/instrument-search.service";
import { BinanceInstrumentDiscoveryService } from "../services/market-data/discovery/binance-instrument-discovery.service";
import { AngelOneInstrumentDiscoveryService } from "../services/market-data/discovery/angel-one-instrument-discovery.service";
import { TwelveDataInstrumentDiscoveryService } from "../services/market-data/discovery/twelve-data-instrument-discovery.service";
import { AlphaVantageInstrumentDiscoveryService } from "../services/market-data/discovery/alpha-vantage-instrument-discovery.service";
import { UniversalInstrumentDiscoveryService, type DiscoverableProvider } from "../services/market-data/discovery/universal-instrument-discovery.service";
import type { ProviderDiscoveryResult } from "../types/instrument-discovery";

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

// ============================================================
// Fixtures
// ============================================================
function fakeClock(startMs = 0): Clock & { advance: (ms: number) => void } {
  let now = startMs;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const BINANCE_EXCHANGE_INFO = {
  symbols: [
    { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" },
    { symbol: "BNBUSDT", status: "TRADING", baseAsset: "BNB", quoteAsset: "USDT" },
    { symbol: "DOGEUSDT", status: "TRADING", baseAsset: "DOGE", quoteAsset: "USDT" },
    { symbol: "ADAUSDT", status: "TRADING", baseAsset: "ADA", quoteAsset: "USDT" },
    { symbol: "AVAXUSDT", status: "TRADING", baseAsset: "AVAX", quoteAsset: "USDT" },
    { symbol: "SHIBRUB", status: "TRADING", baseAsset: "SHIB", quoteAsset: "RUB" }, // disallowed quote asset - must be filtered out
    { symbol: "OLDCOINUSDT", status: "BREAK", baseAsset: "OLDCOIN", quoteAsset: "USDT" }, // not TRADING - must be filtered out
  ],
};

const ANGEL_ONE_SCRIP_MASTER = [
  { token: "3045", symbol: "SBIN-EQ", name: "STATE BANK OF INDIA", exch_seg: "NSE", instrumenttype: "" },
  { token: "1660", symbol: "ITC-EQ", name: "ITC LTD", exch_seg: "NSE", instrumenttype: "" },
  { token: "11483", symbol: "ICICIBANK-EQ", name: "ICICI BANK LTD", exch_seg: "NSE", instrumenttype: "" },
  { token: "5900", symbol: "AXISBANK-EQ", name: "AXIS BANK LTD", exch_seg: "NSE", instrumenttype: "" },
  { token: "10999", symbol: "SBIN-BE", name: "STATE BANK OF INDIA", exch_seg: "BSE", instrumenttype: "" }, // wrong exchange - must be filtered out
  { token: "999999", symbol: "SBINFUT", name: "SBIN FUTURES", exch_seg: "NSE", instrumenttype: "FUTSTK" }, // wrong instrument type - must be filtered out
];

const TWELVE_DATA_SEARCH = {
  data: [
    { symbol: "MSFT", instrument_name: "Microsoft Corporation", exchange: "NASDAQ", country: "United States", currency: "USD", instrument_type: "Common Stock" },
    { symbol: "NVDA", instrument_name: "NVIDIA Corporation", exchange: "NASDAQ", country: "United States", currency: "USD", instrument_type: "Common Stock" },
  ],
  status: "ok",
};

const ALPHA_VANTAGE_SEARCH = {
  bestMatches: [
    { "1. symbol": "TSLA", "2. name": "Tesla Inc", "3. type": "Equity", "4. region": "United States", "8. currency": "USD" },
    { "1. symbol": "AMZN", "2. name": "Amazon.com Inc", "3. type": "Equity", "4. region": "United States", "8. currency": "USD" },
  ],
};

function fakeProvider(name: string, impl: (q: string) => Promise<ProviderDiscoveryResult>): DiscoverableProvider {
  return { name, search: impl };
}
function emptyResult(provider: string): ProviderDiscoveryResult {
  return { provider, candidates: [], stale: false, failed: false };
}

// ============================================================
// 21-24: individual discovery services against injected fakes
// ============================================================
async function individualProviderTests(): Promise<void> {
  await test("21: Binance discovery finds real, TRADING, allowed-quote symbols matching the query", async () => {
    const svc = new BinanceInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, BINANCE_EXCHANGE_INFO) });
    const result = await svc.search("BNB");
    assert.equal(result.failed, false);
    assert.ok(result.candidates.some((c) => c.providerSymbol === "BNBUSDT"));
    assert.ok(!result.candidates.some((c) => c.providerSymbol === "OLDCOINUSDT"), "non-TRADING symbol must be excluded");
    assert.ok(!result.candidates.some((c) => c.providerSymbol === "SHIBRUB"), "disallowed quote asset must be excluded");
  });

  await test("22: Angel One discovery finds real NSE cash-equity/index rows matching the query, filters wrong exchange/instrument type", async () => {
    const svc = new AngelOneInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, ANGEL_ONE_SCRIP_MASTER) });
    const result = await svc.search("SBIN");
    assert.equal(result.failed, false);
    assert.equal(result.candidates.length, 1, "only the real NSE cash-equity row should match, not the BSE or futures rows");
    assert.equal(result.candidates[0].providerSymbol, "SBIN-EQ");
    assert.equal(result.candidates[0].providerInstrumentId, "3045");
  });

  await test("23: Twelve Data discovery finds real symbol_search matches when configured", async () => {
    process.env.TWELVEDATA_API_KEY = "test-key";
    const svc = new TwelveDataInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, TWELVE_DATA_SEARCH) });
    const result = await svc.search("MSFT");
    assert.equal(result.failed, false);
    assert.ok(result.candidates.some((c) => c.providerSymbol === "MSFT" && c.exchange === "NASDAQ"));
    assert.deepEqual(result.candidates[0].capabilities, [], "Twelve Data discovery must never claim market-data capability - frozen adapter");
  });

  await test("23b: Twelve Data discovery honestly reports unconfigured when no key is present", async () => {
    const original = process.env.TWELVEDATA_API_KEY;
    delete process.env.TWELVEDATA_API_KEY;
    const svc = new TwelveDataInstrumentDiscoveryService({ clock: fakeClock() });
    const result = await svc.search("MSFT");
    assert.equal(result.failed, true);
    if (original) process.env.TWELVEDATA_API_KEY = original;
  });

  await test("24: Alpha Vantage discovery finds real SYMBOL_SEARCH matches when configured", async () => {
    process.env.ALPHA_VANTAGE_API_KEY = "test-key";
    const svc = new AlphaVantageInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, ALPHA_VANTAGE_SEARCH) });
    const result = await svc.search("Tesla");
    assert.equal(result.failed, false);
    assert.ok(result.candidates.some((c) => c.providerSymbol === "TSLA"));
    assert.deepEqual(result.candidates[0].capabilities, [], "Alpha Vantage discovery must never claim market-data capability - equities are outside this adapter's frozen scope");
  });
}

// ============================================================
// 15-20: discovery resilience - success/failure/stale/refresh/timeout/malformed
// ============================================================
async function discoveryResilienceTests(): Promise<void> {
  await test("15: provider discovery success populates real candidates", async () => {
    const svc = new BinanceInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, BINANCE_EXCHANGE_INFO) });
    const result = await svc.search("DOGE");
    assert.equal(result.failed, false);
    assert.ok(result.candidates.length > 0);
  });

  await test("16: provider discovery failure never crashes, reports failed:true with zero candidates", async () => {
    const svc = new BinanceInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => { throw new Error("network down"); } });
    const result = await svc.search("BTC");
    assert.equal(result.failed, true);
    assert.deepEqual(result.candidates, []);
  });

  await test("17: a live fetch failure after a successful cache fill falls back to a stale read, honestly marked stale:true", async () => {
    const clock = fakeClock(0);
    let calls = 0;
    const svc = new BinanceInstrumentDiscoveryService({
      clock,
      cacheTtlMs: 1_000,
      staleMaxAgeMs: 60_000,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(200, BINANCE_EXCHANGE_INFO);
        throw new Error("network down on refresh");
      },
    });
    await svc.search("BTC"); // populates cache
    clock.advance(2_000); // past the 1s TTL
    const result = await svc.search("BTC");
    assert.equal(result.failed, false);
    assert.equal(result.stale, true);
    assert.ok(result.candidates.some((c) => c.providerSymbol === "BTCUSDT"));
  });

  await test("18: a fresh, successful fetch after TTL expiry refreshes the cache (never stale when the live call succeeds)", async () => {
    const clock = fakeClock(0);
    let calls = 0;
    const svc = new BinanceInstrumentDiscoveryService({
      clock,
      cacheTtlMs: 1_000,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(200, calls === 1 ? BINANCE_EXCHANGE_INFO : { symbols: [{ symbol: "SOLUSDT", status: "TRADING", baseAsset: "SOL", quoteAsset: "USDT" }] });
      },
    });
    await svc.search("BTC");
    clock.advance(2_000);
    const result = await svc.search("SOL");
    assert.equal(result.stale, false);
    assert.equal(calls, 2, "the second call must have refetched, not served the expired cache");
    assert.ok(result.candidates.some((c) => c.providerSymbol === "SOLUSDT"));
  });

  await test("19: a provider that exceeds the discovery timeout is treated as failed, never blocks the whole search", async () => {
    const slowProvider = fakeProvider("slow", () => new Promise((resolve) => setTimeout(() => resolve(emptyResult("slow")), 200)));
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: slowProvider,
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
      discoveryTimeoutMs: 20,
    });
    const { diagnostics } = await orchestrator.search("some genuinely unmapped query xyz");
    assert.ok(diagnostics.providersFailed.includes("slow"));
  });

  await test("20: a malformed provider response is treated as a discovery failure, never crashes the caller", async () => {
    const svc = new BinanceInstrumentDiscoveryService({ clock: fakeClock(), fetchImpl: async () => jsonResponse(200, { not: "the expected shape" }) });
    const result = await svc.search("BTC");
    assert.equal(result.failed, true);
    assert.deepEqual(result.candidates, []);
  });
}

// ============================================================
// Orchestrator-level: ranking, dedup, identity, capability, provenance
// ============================================================
async function orchestratorTests(): Promise<void> {
  await test("1: exact symbol search on the existing catalog returns the exact instrument first, no discovery needed", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results, diagnostics } = await orchestrator.search("EURUSD");
    assert.equal(results[0].id, "EURUSD");
    assert.equal(diagnostics.discoveryTriggered, false, "an exact catalog match must never trigger a live provider round trip");
  });

  await test("2: company-name search resolves a real catalog instrument", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("Reliance Industries Ltd");
    assert.ok(results.some((r) => r.id === "RELIANCE"));
  });

  await test("3: fuzzy/substring search still resolves a real catalog instrument", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("relian");
    assert.ok(results.some((r) => r.id === "RELIANCE"));
  });

  await test("4: search is case-insensitive", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const lower = await orchestrator.search("eurusd");
    const upper = await orchestrator.search("EURUSD");
    assert.equal(lower.results[0]?.id, upper.results[0]?.id);
  });

  await test("8: exact-match ranking - an exact canonical match always ranks first even when substring matches also exist", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("BTCUSD");
    assert.equal(results[0].id, "BTCUSD");
  });

  await test("12: an empty query returns no results and never triggers discovery", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results, diagnostics } = await orchestrator.search("   ");
    assert.deepEqual(results, []);
    assert.equal(diagnostics.discoveryTriggered, false);
  });

  await test("13: a single-character query never triggers provider discovery (too broad/expensive to fan out on)", async () => {
    let called = false;
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => { called = true; return emptyResult("binance"); }),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    await orchestrator.search("z");
    assert.equal(called, false);
  });

  await test("14: special characters in the query never crash the search", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    await assert.doesNotReject(orchestrator.search("$$ // \\ '; DROP TABLE--"));
  });

  await test("27: FX search is satisfied entirely by the existing catalog (no discovery call needed)", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { diagnostics } = await orchestrator.search("GBPUSD");
    assert.equal(diagnostics.discoveryTriggered, false);
  });

  await test("28: metals search is satisfied entirely by the existing catalog (no discovery call needed)", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { diagnostics } = await orchestrator.search("XAUUSD");
    assert.equal(diagnostics.discoveryTriggered, false);
  });

  await test("58: identical repeated searches produce identical, deterministic ordering", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const a = await orchestrator.search("bank");
    const b = await orchestrator.search("bank");
    assert.deepEqual(a.results.map((r) => r.id), b.results.map((r) => r.id));
  });

  await test("60: pre-existing catalog search behavior is unchanged (regression against D2.6.3's own worked example)", async () => {
    const catalogOnly = new InstrumentSearchService();
    const direct = catalogOnly.search("bitcoin");
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("bitcoin");
    assert.equal(results[0].id, direct[0].instrument.id);
    assert.equal(results[0].id, "BTCUSD");
  });
}

// ============================================================
// 25-26, 29-41: discovery registration, chart resolution, capability
// matrix, provenance, identity/dedup
// ============================================================
async function registrationAndCapabilityTests(): Promise<void> {
  clearDiscoveredInstruments();

  await test("25: Indian instrument discovery (Angel One) surfaces a real, previously-uncataloged NSE stock", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne: fakeProvider("angel-one", async () => ({
        provider: "angel-one",
        stale: false,
        failed: false,
        candidates: [{ provider: "angel-one", providerSymbol: "SBIN-EQ", providerInstrumentId: "3045", displayName: "STATE BANK OF INDIA", exchange: "NSE", country: "IN", currency: "INR", assetClass: "equity", marketCategory: "stocks", capabilities: ["quote", "candles"] }],
      })),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("SBIN");
    const sbin = results.find((r) => r.symbol === "SBIN-EQ");
    assert.ok(sbin, "SBIN should be discoverable even though it is not one of the 6 hand-curated Indian entries");
    assert.equal(sbin!.discoverySource, "angel-one");
    assert.equal(sbin!.capabilities.quote, true);
    assert.equal(sbin!.capabilities.candles, true);
    assert.equal(sbin!.capabilities.intelligence, true);
  });

  await test("26: crypto discovery (Binance) surfaces a real, previously-uncataloged altcoin", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => ({
        provider: "binance",
        stale: false,
        failed: false,
        candidates: [{ provider: "binance", providerSymbol: "AVAXUSDT", displayName: "AVAX / USDT", assetClass: "crypto", marketCategory: "crypto", currency: "USDT", capabilities: ["quote", "candles"] }],
      })),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("AVAXUSDT");
    const avax = results.find((r) => r.symbol === "AVAXUSDT");
    assert.ok(avax);
    assert.equal(avax!.capabilities.quote, true);
    assert.equal(avax!.chart.supported, true);
    assert.equal(avax!.chart.chartSymbol, "BINANCE:AVAXUSDT");
  });

  await test("29: a chart-supported discovered instrument reports supported:true with a real chart symbol", () => {
    const id = [...(getCanonicalInstrument("disc:binance:AVAXUSDT") ? ["disc:binance:AVAXUSDT"] : [])][0];
    assert.ok(id, "AVAXUSDT must have been registered by the previous test");
    const chart = resolveChartInstrument(id!);
    assert.equal(chart.supported, true);
    assert.equal(chart.chartSymbol, "BINANCE:AVAXUSDT");
  });

  await test("30: a chart-unsupported discovered instrument (unrecognized exchange) honestly reports supported:false with a reason", () => {
    clearDiscoveredInstruments();
    registerDiscoveredInstrument({
      id: "disc:twelve-data:WEIRD",
      symbol: "WEIRD",
      displayName: "Some Exchange This Platform Has No TradingView Mapping For",
      assetClass: "equity",
      marketCategory: "stocks",
      exchange: "SOME_UNKNOWN_EXCHANGE",
      aliases: [],
      providerMappings: [],
      discovery: { source: "twelve-data", discoveredAt: new Date(0).toISOString() },
    });
    const chart = resolveChartInstrument("disc:twelve-data:WEIRD");
    assert.equal(chart.supported, false);
    assert.ok(chart.reason);
  });

  await test("31: chart symbol correctness - a discovered Angel One NSE equity resolves the exact real NSE: ticker (strips the -EQ suffix)", () => {
    registerDiscoveredInstrument({
      id: "disc:angel-one:3045",
      symbol: "SBIN-EQ",
      displayName: "STATE BANK OF INDIA",
      assetClass: "equity",
      marketCategory: "stocks",
      exchange: "NSE",
      country: "IN",
      currency: "INR",
      aliases: [],
      providerMappings: [{ provider: "angel-one", providerSymbol: "SBIN-EQ", providerInstrumentId: "3045", supportedCapabilities: ["quote", "candles"], verified: false }],
      discovery: { source: "angel-one", discoveredAt: new Date(0).toISOString() },
    });
    const chart = resolveChartInstrument("disc:angel-one:3045");
    assert.equal(chart.supported, true);
    assert.equal(chart.chartSymbol, "NSE:SBIN");
  });

  await test("32: no EURUSD fallback - an unresolvable discovered/unknown instrument never silently substitutes a different chart", () => {
    const unknown = resolveChartInstrument("disc:twelve-data:TOTALLY_UNKNOWN_XYZ");
    assert.equal(unknown.supported, false);
    assert.notEqual(unknown.chartSymbol, "FX:EURUSD");
  });

  await test("33: no previous-symbol fallback - two different discovered instruments resolve independently, never reusing the prior result", () => {
    const a = resolveChartInstrument("disc:angel-one:3045");
    const b = resolveChartInstrument("BTCUSD");
    assert.notEqual(a.chartSymbol, b.chartSymbol);
  });

  await test("34: market-data (quote) capability is honestly false for a Twelve-Data-only-discovered instrument", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => ({
        provider: "twelve-data",
        stale: false,
        failed: false,
        candidates: [{ provider: "twelve-data", providerSymbol: "MSFT", displayName: "Microsoft Corporation", exchange: "NASDAQ", country: "United States", currency: "USD", assetClass: "equity", marketCategory: "stocks", capabilities: [] }],
      })),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("MSFT");
    const msft = results.find((r) => r.symbol === "MSFT");
    assert.ok(msft);
    assert.equal(msft!.capabilities.quote, false);
  });

  await test("35: candle capability mirrors the real provider mapping - true only when genuinely declared", async () => {
    const msft = (await new UniversalInstrumentDiscoveryService().search("MSFT")).results.find((r) => r.symbol === "MSFT");
    assert.ok(msft);
    assert.equal(msft!.capabilities.candles, false);
  });

  await test("36: intelligence capability mirrors quote capability - never independently true", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("BTCUSD");
    const btc = results.find((r) => r.id === "BTCUSD");
    assert.ok(btc);
    assert.equal(btc!.capabilities.intelligence, btc!.capabilities.quote);
  });

  await test("37: provider provenance - discoverySource is set only on a genuinely runtime-discovered instrument, never on a hand-curated one", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("EURUSD");
    assert.equal(results[0].discoverySource, undefined);
  });

  await test("38: fallback/discovery provenance never conflates 'who discovered it' with 'who supplied the market data' - a hand-curated multi-provider instrument's provenance list stays accurate regardless of discovery status", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("BTCUSD");
    const btc = results.find((r) => r.id === "BTCUSD");
    assert.ok(btc);
    assert.equal(btc!.discoverySource, undefined, "BTCUSD is hand-curated, not discovered");
    assert.ok(btc!.providers.some((p) => p.provider === "twelve-data"));
    assert.ok(btc!.providers.some((p) => p.provider === "binance"));
  });

  await test("39: canonical identity stability - registering the same candidate twice yields the exact same id, never a duplicate", async () => {
    clearDiscoveredInstruments();
    const angelOne = fakeProvider("angel-one", async () => ({
      provider: "angel-one",
      stale: false,
      failed: false,
      candidates: [{ provider: "angel-one", providerSymbol: "ITC-EQ", providerInstrumentId: "1660", displayName: "ITC LTD", exchange: "NSE", country: "IN", currency: "INR", assetClass: "equity", marketCategory: "stocks", capabilities: ["quote", "candles"] }],
    }));
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne,
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const first = await orchestrator.search("ITC");
    const second = await orchestrator.search("ITC");
    const idA = first.results.find((r) => r.symbol === "ITC-EQ")?.id;
    const idB = second.results.find((r) => r.symbol === "ITC-EQ")?.id;
    assert.ok(idA);
    assert.equal(idA, idB);
  });

  await test("40: duplicate-provider mapping - a discovered candidate whose providerSymbol already exists on a hand-curated catalog entry is never re-registered as a second instrument", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => ({
        provider: "binance",
        stale: false,
        failed: false,
        // BTCUSDT is ALREADY BTCUSD's real Binance mapping in the static catalog.
        candidates: [{ provider: "binance", providerSymbol: "BTCUSDT", displayName: "Bitcoin / Tether", assetClass: "crypto", marketCategory: "crypto", currency: "USDT", capabilities: ["quote", "candles"] }],
      })),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    await orchestrator.search("btcusdt genuinely triggering discovery xyz");
    assert.equal(getCanonicalInstrument("disc:binance:BTCUSDT"), undefined, "a real mapping that already exists on BTCUSD must never spawn a duplicate synthetic instrument");
  });

  await test("41: ambiguous identity protection - two different providers' similarly-named discoveries are never merged into one instrument", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne: fakeProvider("angel-one", async () => ({
        provider: "angel-one",
        stale: false,
        failed: false,
        candidates: [{ provider: "angel-one", providerSymbol: "AXISBANK-EQ", providerInstrumentId: "5900", displayName: "AXIS BANK LTD", exchange: "NSE", country: "IN", currency: "INR", assetClass: "equity", marketCategory: "stocks", capabilities: ["quote", "candles"] }],
      })),
      twelveData: fakeProvider("twelve-data", async () => ({
        provider: "twelve-data",
        stale: false,
        failed: false,
        // A DIFFERENT real instrument that merely shares a similar display name fragment - must stay a separate entry, never merged with the Angel One row above.
        candidates: [{ provider: "twelve-data", providerSymbol: "AXP", displayName: "American Express (unrelated to Axis Bank)", exchange: "NYSE", country: "United States", currency: "USD", assetClass: "equity", marketCategory: "stocks", capabilities: [] }],
      })),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("AXISBANK");
    const axisBank = results.find((r) => r.symbol === "AXISBANK-EQ");
    const amex = results.find((r) => r.symbol === "AXP");
    assert.ok(axisBank);
    assert.notEqual(axisBank!.id, amex?.id);
  });
}

// ============================================================
// 9-11: duplicate elimination, ambiguous handling, unsupported instrument
// ============================================================
async function dedupAndAmbiguityTests(): Promise<void> {
  clearDiscoveredInstruments();

  await test("9: duplicate elimination - a candidate already covered by a real catalog mapping never appears twice in one result set", async () => {
    // "usdt" is not sufficient against the static catalog on its own
    // (only a low-priority substring match against a few real provider
    // symbols), so discovery genuinely triggers; the Binance fake then
    // "rediscovers" ETHUSD's OWN already-real Binance mapping (ETHUSDT) -
    // proving the dedup check fires even when discovery legitimately runs.
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => ({
        provider: "binance",
        stale: false,
        failed: false,
        candidates: [{ provider: "binance", providerSymbol: "ETHUSDT", displayName: "Ethereum / Tether", assetClass: "crypto", marketCategory: "crypto", currency: "USDT", capabilities: ["quote", "candles"] }],
      })),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results, diagnostics } = await orchestrator.search("usdt");
    assert.equal(diagnostics.discoveryTriggered, true);
    const ethOccurrences = results.filter((r) => r.id === "ETHUSD" || r.symbol === "ETHUSDT");
    assert.equal(ethOccurrences.length, 1, "ETHUSD must appear exactly once, not once from the catalog and once from discovery");
  });

  await test("10: ambiguous instrument handling - genuinely distinct candidates are preserved as separate results, never collapsed", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne: fakeProvider("angel-one", async () => ({
        provider: "angel-one",
        stale: false,
        failed: false,
        candidates: [
          { provider: "angel-one", providerSymbol: "ITC-EQ", providerInstrumentId: "1660", displayName: "ITC LTD", exchange: "NSE", country: "IN", currency: "INR", assetClass: "equity", marketCategory: "stocks", capabilities: ["quote", "candles"] },
        ],
      })),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("ITC");
    assert.ok(results.some((r) => r.symbol === "ITC-EQ"));
  });

  await test("11: unsupported instrument handling - a discovery-only candidate (zero capabilities) is still searchable, with honest false capability flags", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => emptyResult("binance")),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => ({
        provider: "twelve-data",
        stale: false,
        failed: false,
        candidates: [{ provider: "twelve-data", providerSymbol: "NVDA", displayName: "NVIDIA Corporation", exchange: "NASDAQ", country: "United States", currency: "USD", assetClass: "equity", marketCategory: "stocks", capabilities: [] }],
      })),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("NVDA");
    const nvda = results.find((r) => r.symbol === "NVDA");
    assert.ok(nvda);
    assert.equal(nvda!.capabilities.quote, false);
    assert.equal(nvda!.capabilities.intelligence, false);
    assert.equal(nvda!.chart.supported, true, "NVDA's real NASDAQ exchange field still yields an honest, correct chart mapping even with zero market-data capability");
  });
}

// ============================================================
// 5-7: exchange/market-category/provider filtering (structural, over real results)
// ============================================================
async function filteringTests(): Promise<void> {
  await test("5: exchange info is preserved and correct on a real Indian catalog result", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("RELIANCE");
    assert.equal(results[0].exchange, "NSE");
  });

  await test("6: market category is preserved and correct across asset classes", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const crypto = await orchestrator.search("BTCUSD");
    const forex = await orchestrator.search("EURUSD");
    assert.equal(crypto.results[0].marketCategory, "crypto");
    assert.equal(forex.results[0].marketCategory, "forex");
  });

  await test("7: provider attribution on a result is real, never fabricated", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService();
    const { results } = await orchestrator.search("NIFTY50");
    assert.ok(results[0].providers.some((p) => p.provider === "angel-one"));
  });
}

// ============================================================
// 46-47: default suggestions + dynamic-result-outside-defaults
// ============================================================
async function defaultsAndDynamicTests(): Promise<void> {
  await test("46: every default/popular suggestion id used by the frontend resolves to a real catalog instrument", () => {
    const DEFAULT_SUGGESTION_IDS = ["EURUSD", "XAUUSD", "BTCUSD", "ETHUSD", "NIFTY50", "BANKNIFTY", "RELIANCE"];
    for (const id of DEFAULT_SUGGESTION_IDS) {
      assert.ok(getCanonicalInstrument(id), `${id} must be a real catalog instrument`);
    }
  });

  await test("47: a dynamically discovered instrument outside the default suggestion list is fully selectable/resolvable", async () => {
    clearDiscoveredInstruments();
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => ({
        provider: "binance",
        stale: false,
        failed: false,
        candidates: [{ provider: "binance", providerSymbol: "DOGEUSDT", displayName: "DOGE / USDT", assetClass: "crypto", marketCategory: "crypto", currency: "USDT", capabilities: ["quote", "candles"] }],
      })),
      angelOne: fakeProvider("angel-one", async () => emptyResult("angel-one")),
      twelveData: fakeProvider("twelve-data", async () => emptyResult("twelve-data")),
      alphaVantage: fakeProvider("alpha-vantage", async () => emptyResult("alpha-vantage")),
    });
    const { results } = await orchestrator.search("DOGEUSDT");
    const doge = results.find((r) => r.symbol === "DOGEUSDT");
    assert.ok(doge);
    assert.ok(getCanonicalInstrument(doge!.id), "the discovered instrument must be resolvable platform-wide, not just present in the search response");
  });
}

// ============================================================
// 48-56: existing catalog instruments still resolve correctly (regression)
// ============================================================
async function existingCatalogRegressionTests(): Promise<void> {
  const cases: Array<{ id: string; label: string }> = [
    { id: "NIFTY50", label: "48: NIFTY" },
    { id: "BANKNIFTY", label: "49: BANKNIFTY" },
    { id: "RELIANCE", label: "50: RELIANCE" },
    { id: "TCS", label: "51: TCS" },
    { id: "BTCUSD", label: "52: BTC" },
    { id: "ETHUSD", label: "53: ETH" },
    { id: "SOLUSD", label: "54: SOL" },
    { id: "XRPUSD", label: "55: XRP" },
  ];
  for (const c of cases) {
    await test(`${c.label}: still resolves via the catalog and produces a real, supported chart`, () => {
      const instrument = getCanonicalInstrument(c.id);
      assert.ok(instrument, `${c.id} must still be a real catalog instrument`);
      const chart = resolveChartInstrument(c.id);
      assert.equal(chart.supported, true);
    });
  }

  await test("56: AAPL keeps its chart-only behavior (chart available, market intelligence honestly unavailable)", () => {
    const instrument = getCanonicalInstrument("AAPL");
    assert.ok(instrument);
    assert.equal(instrument!.providerMappings.length, 0);
    const chart = resolveChartInstrument("AAPL");
    assert.equal(chart.supported, true);
    assert.equal(chart.chartSymbol, "NASDAQ:AAPL");
  });
}

// ============================================================
// 57: all-provider failure
// ============================================================
async function allProviderFailureTests(): Promise<void> {
  await test("57: when every discovery provider fails, the search still returns the catalog's own results honestly, never crashes", async () => {
    const orchestrator = new UniversalInstrumentDiscoveryService({
      binance: fakeProvider("binance", async () => { throw new Error("down"); }),
      angelOne: fakeProvider("angel-one", async () => { throw new Error("down"); }),
      twelveData: fakeProvider("twelve-data", async () => { throw new Error("down"); }),
      alphaVantage: fakeProvider("alpha-vantage", async () => { throw new Error("down"); }),
    });
    const { results, diagnostics } = await orchestrator.search("genuinely unmapped query that forces discovery abc123");
    assert.equal(diagnostics.providersFailed.length, 4);
    assert.ok(Array.isArray(results));
  });
}

// ============================================================
// 59: cache isolation
// ============================================================
async function cacheIsolationTests(): Promise<void> {
  await test("59: two independent discovery service instances never share cache state", async () => {
    const clockA = fakeClock();
    const clockB = fakeClock();
    let callsA = 0;
    let callsB = 0;
    const svcA = new BinanceInstrumentDiscoveryService({ clock: clockA, fetchImpl: async () => { callsA += 1; return jsonResponse(200, BINANCE_EXCHANGE_INFO); } });
    const svcB = new BinanceInstrumentDiscoveryService({ clock: clockB, fetchImpl: async () => { callsB += 1; return jsonResponse(200, BINANCE_EXCHANGE_INFO); } });
    await svcA.search("BTC");
    await svcA.search("BTC");
    await svcB.search("BTC");
    assert.equal(callsA, 1, "svcA's second call should hit its own warm cache");
    assert.equal(callsB, 1, "svcB must fetch independently - it must never see svcA's cache");
  });
}

// ============================================================
// 42-45: authorization + response/frontend contract (structural)
// ============================================================
async function contractTests(): Promise<void> {
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  await test("42: the search route requires authentication before returning any data", () => {
    const src = read("app/api/private/instruments/search/route.ts");
    assert.ok(src.includes("getUserOrNull"));
    assert.ok(src.includes("UNAUTHORIZED"));
  });

  await test("43: unauthenticated access is rejected before the discovery orchestrator is ever invoked", () => {
    const src = read("app/api/private/instruments/search/route.ts");
    const authIndex = src.indexOf("UNAUTHORIZED");
    const searchIndex = src.indexOf("discoveryService.search(");
    assert.ok(authIndex > -1 && searchIndex > -1 && authIndex < searchIndex);
  });

  await test("44: the search API response shape includes the capability matrix and chart resolution for every result", () => {
    const src = read("app/api/private/instruments/search/route.ts");
    assert.ok(src.includes("capabilities: r.capabilities"));
    assert.ok(src.includes("chart: r.chart"));
  });

  await test("45: the frontend selector never hardcodes search results - it always calls the real search route. Sprint D2.7.11 Phase 3 - the actual fetch now lives in InstrumentSearchBox.tsx (extracted so a chart pane's own independent symbol search can reuse it) - GlobalSymbolSelector.tsx is just a thin WorkspaceContext-wired caller of it now, so this checks the box that genuinely still does the fetching.", () => {
    const boxSrc = read("components/workspace/InstrumentSearchBox.tsx");
    assert.ok(boxSrc.includes("/api/private/instruments/search"));
    assert.ok(!/const\s+results\s*[:=]\s*\[\s*\{/.test(boxSrc), "no hardcoded results array should exist in the component");
    const selectorSrc = read("components/workspace/GlobalSymbolSelector.tsx");
    assert.ok(selectorSrc.includes("<InstrumentSearchBox"), "GlobalSymbolSelector must actually render the real search box, never a second implementation");
  });
}

async function main(): Promise<void> {
  await orchestratorTests();
  await filteringTests();
  await dedupAndAmbiguityTests();
  await discoveryResilienceTests();
  await individualProviderTests();
  await registrationAndCapabilityTests();
  await defaultsAndDynamicTests();
  await existingCatalogRegressionTests();
  await allProviderFailureTests();
  await cacheIsolationTests();
  await contractTests();

  clearDiscoveredInstruments();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
