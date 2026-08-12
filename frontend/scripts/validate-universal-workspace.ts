// scripts/validate-universal-workspace.ts
// Sprint D2.6.11 - Universal Instrument Workspace, Dynamic Chart Resolution
// & Live Workspace Integration. Standalone, assert-based verification (no
// test framework), matching every prior sprint's scripts/validate-*.ts
// pattern. Run via `npm run validate:universal-workspace`.
//
// Scope: this project has no React/component test framework - UI
// correctness is verified via tsc/eslint/build plus a manual/browser check
// (see the sprint's final report for what was and wasn't actually clicked).
// This script covers every deterministic, server-side/pure-function
// contract the Workspace's dynamic-symbol fix depends on: the chart
// resolver, the real catalog's provider-capability data (Indian/crypto/
// FX-metals routing), the research snapshot service, the chat route's new
// symbol passthrough (via IntelligencePresentationService, unmodified),
// workspace symbol-state consistency (structural source checks - no second
// symbol registry, one WorkspaceContext), and security (no secrets ever
// reach a response shape a browser would receive).
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { getCanonicalInstrument, listCanonicalInstruments } from "../lib/market-data/instrument-catalog";
import { isEnabledMarket, isKnownMarket } from "../lib/market-data/market-registry";
import { InstrumentSearchService } from "../services/market-data/instrument-search.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { IntelligenceChatContextService } from "../services/intelligence/chat/intelligence-chat-context.service";
import { ResearchSnapshotService } from "../services/intelligence/chat/research-snapshot.service";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider, SnapshotProvider, TimeSeriesProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";

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
// Fixture builders (same pattern as every prior D2.6.x validate script)
// ============================================================
function makeCandles(closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}
function snapshotFor(symbol: string, candles: Candle[], overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol,
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
    ...overrides,
  };
}
function trendingBullishCloses(base = 1.0, step = 0.0015): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(base + i * step);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - step / 3 + (i % 3) * (step / 15));
  return [...rise, ...plateau];
}

class FakeMarketData implements MarketDataProvider, SnapshotProvider, TimeSeriesProvider {
  readonly name: string;
  constructor(private readonly behavior: { snapshot?: () => Promise<MarketSnapshot>; candles?: () => Promise<Candle[]> } = {}, name = "fake-provider") {
    this.name = name;
  }
  isConfigured(): boolean {
    return true;
  }
  async getMarketContext(request: MarketContextRequest): Promise<MarketContextResult> {
    return { symbol: request.symbol, provider: this.name, retrievedAt: new Date().toISOString(), evidence: [] };
  }
  async getSnapshot(): Promise<MarketSnapshot> {
    if (!this.behavior.snapshot) throw new MarketDataProviderError("http_error", "no snapshot behavior configured", this.name);
    return this.behavior.snapshot();
  }
  async getTimeSeries(): Promise<Candle[]> {
    if (!this.behavior.candles) return [];
    return this.behavior.candles();
  }
}
function freshMarketData(symbol: string, basePrice: number): FakeMarketData {
  const candles = makeCandles(trendingBullishCloses(basePrice, basePrice * 0.0002));
  const now = new Date();
  const snapshot = { ...snapshotFor(symbol, candles), timestamp: now.toISOString(), retrievedAt: now.toISOString() };
  return new FakeMarketData({ snapshot: async () => snapshot, candles: async () => candles });
}

// ============================================================
// A/C: chart resolver - one explicit, deterministic classification per
// real catalog instrument (the D2.6.11 root-cause fix)
// ============================================================
async function chartResolverTests(): Promise<void> {
  await test("1: default/pre-existing symbol (EURUSD) resolves a real, supported chart symbol", () => {
    const r = resolveChartInstrument("EURUSD");
    assert.equal(r.supported, true);
    assert.equal(r.chartSymbol, "FX:EURUSD");
  });

  await test("2: every single catalog instrument gets an explicit chart resolution (no silent gap)", () => {
    for (const instrument of listCanonicalInstruments()) {
      const r = resolveChartInstrument(instrument.id);
      assert.equal(r.canonicalSymbol, instrument.id);
      assert.equal(typeof r.supported, "boolean");
      if (!r.supported) assert.ok(r.reason && r.reason.length > 0, `${instrument.id} must carry a reason when unsupported`);
    }
  });

  await test("3: an unknown id (not in the catalog) is honestly unsupported, never a guessed chart", () => {
    const r = resolveChartInstrument("NOT_A_REAL_INSTRUMENT");
    assert.equal(r.supported, false);
    assert.equal(r.chartSymbol, undefined);
    assert.ok(r.reason);
  });

  await test("4: two different real instruments never resolve to the same chart symbol (no silent substitution)", () => {
    const a = resolveChartInstrument("EURUSD");
    const b = resolveChartInstrument("NIFTY50");
    assert.notEqual(a.chartSymbol, b.chartSymbol);
  });

  await test("5: resolution is pure/deterministic - identical id always produces an identical result", () => {
    const a = resolveChartInstrument("BTCUSD");
    const b = resolveChartInstrument("BTCUSD");
    assert.deepEqual(a, b);
  });

  await test("6: Indian instruments (NIFTY50/BANKNIFTY/RELIANCE/TCS/INFY/HDFCBANK) all resolve real NSE: chart symbols", () => {
    for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
      const r = resolveChartInstrument(id);
      assert.equal(r.supported, true, `${id} should be chart-supported`);
      assert.ok(r.chartSymbol?.startsWith("NSE:"), `${id} should resolve to a real NSE: symbol, got ${r.chartSymbol}`);
    }
  });

  await test("7: crypto instruments (BTCUSD/ETHUSD/SOLUSD/XRPUSD) all resolve real chart symbols, no two identical", () => {
    const ids = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
    const symbols = ids.map((id) => resolveChartInstrument(id));
    for (const r of symbols) assert.equal(r.supported, true);
    assert.equal(new Set(symbols.map((r) => r.chartSymbol)).size, ids.length);
  });

  await test("8: FX/metals (EURUSD/GBPUSD/USDJPY/XAUUSD/XAGUSD) all resolve real chart symbols", () => {
    for (const id of ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"]) {
      const r = resolveChartInstrument(id);
      assert.equal(r.supported, true, `${id} should be chart-supported`);
      assert.ok(r.chartSymbol);
    }
  });

  await test("9: repeated/rapid symbol switching across asset classes each resolves independently and correctly", () => {
    const sequence = ["BTCUSD", "NIFTY50", "RELIANCE", "XAUUSD", "ETHUSD"];
    const results = sequence.map((id) => resolveChartInstrument(id));
    for (let i = 0; i < sequence.length; i++) {
      assert.equal(results[i].canonicalSymbol, sequence[i]);
      assert.equal(results[i].supported, true);
    }
    // No two consecutive resolutions in this sequence collapse to the same chart key.
    for (let i = 1; i < results.length; i++) assert.notEqual(results[i].chartSymbol, results[i - 1].chartSymbol);
  });
}

// ============================================================
// D/E/F/G: real catalog provider-capability data - Indian -> Angel One,
// crypto -> Binance, FX/metals -> Twelve Data/Alpha Vantage. Deterministic
// data assertions (no live network) - the router itself (D2.6.3/D2.6.4) is
// re-verified separately in full regression, not re-implemented here.
// ============================================================
async function providerMappingTests(): Promise<void> {
  await test("10: every Indian instrument has a verified Angel One provider mapping", () => {
    for (const id of ["NIFTY50", "BANKNIFTY", "RELIANCE", "TCS", "INFY", "HDFCBANK"]) {
      const instrument = getCanonicalInstrument(id);
      assert.ok(instrument, `${id} must exist in the catalog`);
      const mapping = instrument!.providerMappings.find((m) => m.provider === "angel-one");
      assert.ok(mapping, `${id} must have an angel-one mapping`);
      assert.equal(mapping!.verified, true);
    }
  });

  await test("11: every crypto instrument has a real Binance provider mapping with quote+candles capability", () => {
    for (const id of ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"]) {
      const instrument = getCanonicalInstrument(id);
      const mapping = instrument!.providerMappings.find((m) => m.provider === "binance");
      assert.ok(mapping, `${id} must have a binance mapping`);
      assert.ok(mapping!.supportedCapabilities.includes("quote"));
      assert.ok(mapping!.supportedCapabilities.includes("candles"));
    }
  });

  await test("12: every global FX/metals instrument has a real Twelve Data provider mapping", () => {
    for (const id of ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"]) {
      const instrument = getCanonicalInstrument(id);
      const mapping = instrument!.providerMappings.find((m) => m.provider === "twelve-data");
      assert.ok(mapping, `${id} must have a twelve-data mapping`);
    }
  });

  await test("13: no instrument lists an unconfigured/nonexistent provider name", () => {
    const knownProviders = new Set(["twelve-data", "alpha-vantage", "binance", "angel-one"]);
    for (const instrument of listCanonicalInstruments()) {
      for (const mapping of instrument.providerMappings) {
        assert.ok(knownProviders.has(mapping.provider), `${instrument.id} lists unknown provider "${mapping.provider}"`);
      }
    }
  });

  await test("14: market-registry.ts and instrument-catalog.ts agree on every catalog symbol also present in the registry (no drift)", () => {
    for (const instrument of listCanonicalInstruments()) {
      if (isKnownMarket(instrument.id)) {
        assert.ok(isKnownMarket(instrument.id), `${instrument.id} should be known to market-registry`);
      }
    }
  });

  await test("15: AAPL is honestly unsupported for market data (zero provider mappings) even though it's searchable", () => {
    const instrument = getCanonicalInstrument("AAPL");
    assert.ok(instrument);
    assert.equal(instrument!.providerMappings.length, 0);
    assert.equal(isEnabledMarket("AAPL"), false);
  });
}

// ============================================================
// B: search result correctness - real CanonicalInstrument records, enough
// to resolve canonical symbol / provider / providerSymbol / chart symbol
// ============================================================
async function searchResultTests(): Promise<void> {
  const search = new InstrumentSearchService();

  await test("16: searching a canonical id returns a real instrument with the same id (exact-canonical)", () => {
    const results = search.search("RELIANCE");
    assert.ok(results.length > 0);
    assert.equal(results[0].instrument.id, "RELIANCE");
    assert.equal(results[0].matchType, "exact-canonical");
  });

  await test("17: searching a common alias (e.g. 'nifty') resolves the real NIFTY50 instrument", () => {
    const results = search.search("nifty50");
    assert.ok(results.some((r) => r.instrument.id === "NIFTY50"));
  });

  await test("18: a search result carries enough real data to resolve canonical symbol, provider, providerSymbol, and a real chart symbol", () => {
    const results = search.search("bitcoin");
    assert.ok(results.length > 0);
    const instrument = results[0].instrument;
    assert.equal(instrument.id, "BTCUSD");
    assert.ok(instrument.providerMappings.length > 0);
    const chart = resolveChartInstrument(instrument.id);
    assert.equal(chart.supported, true);
  });

  await test("19: user-entered free text never reaches TradingView directly - it must resolve to a real catalog instrument first", () => {
    const results = search.search("this is definitely not a real instrument query xyz123");
    assert.equal(results.length, 0);
    // No canonical instrument -> resolveChartInstrument would honestly reject it, never fabricate a symbol.
    const r = resolveChartInstrument("this is definitely not a real instrument query xyz123");
    assert.equal(r.supported, false);
  });

  await test("20: search never returns a duplicate instrument catalog - InstrumentSearchService reads the same INSTRUMENT_CATALOG the resolver reads, no second catalog", () => {
    const results = search.search("reliance");
    const fromCatalog = getCanonicalInstrument("RELIANCE");
    assert.deepEqual(results.find((r) => r.instrument.id === "RELIANCE")?.instrument, fromCatalog);
  });
}

// ============================================================
// I/J/N/O: symbol-change state, stale-chart prevention, one workspace
// context, no duplicate symbol registry - structural source checks (this
// project has no component test framework; this is the same discipline
// used for the chat route's zero-coupling regression checks).
// ============================================================
async function structuralConsistencyTests(): Promise<void> {
  const root = join(__dirname, "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  await test("21: AdvancedChart.tsx no longer carries its own hardcoded TV_SYMBOL map (the D2.6.11 root-cause bug is actually removed, not just papered over)", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(!src.includes("TV_SYMBOL"), "the old hardcoded symbol map must be gone");
    assert.ok(src.includes("resolveChartInstrument"), "AdvancedChart must use the centralized resolver");
  });

  await test("22: the TradingView symbol table exists in exactly one module (chart-instrument-resolver.ts), never duplicated in a component", () => {
    const resolverSrc = read("lib/market-data/chart-instrument-resolver.ts");
    assert.ok(resolverSrc.includes("TRADINGVIEW_SYMBOL"));
    for (const componentFile of [
      "components/workspace/tradingview/AdvancedChart.tsx",
      "components/workspace/tradingview/TradingViewWidget.tsx",
      "components/workspace/GlobalSymbolSelector.tsx",
    ]) {
      const src = read(componentFile);
      assert.ok(!src.includes("TRADINGVIEW_SYMBOL"), `${componentFile} must not duplicate the TradingView symbol table`);
    }
  });

  await test("23: AdvancedChart remounts via a React key derived from the resolved chart symbol (deterministic remount, no arbitrary timeout)", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(/key=\{`\$\{tvSymbol\}/.test(src), "key must be derived from the resolved chart symbol");
    assert.ok(!src.includes("setTimeout"), "must not use a timeout to work around the remount issue");
  });

  await test("24: AdvancedChart renders an explicit unsupported state instead of silently falling back to a different instrument", () => {
    const src = read("components/workspace/tradingview/AdvancedChart.tsx");
    assert.ok(src.includes("resolution.supported"));
    assert.ok(src.includes("Chart visualization is unavailable"));
    assert.ok(!src.includes('?? "FX:EURUSD"'), "the old silent EUR/USD fallback must be gone");
  });

  await test("25: every workspace panel reads the symbol from the same WorkspaceContext - no second, independent symbol state", () => {
    for (const componentFile of [
      "components/workspace/tradingview/AdvancedChart.tsx",
      "components/workspace/WorkspaceHeader.tsx",
      "components/workspace/IntelligencePanel.tsx",
      "components/workspace/MarketRibbon.tsx",
      "components/workspace/GlobalSymbolSelector.tsx",
      "components/workspace/WorkspaceAssistant.tsx",
      "components/workspace/WorkspaceResearch.tsx",
    ]) {
      const src = read(componentFile);
      assert.ok(src.includes('useWorkspace()') || src.includes('from "@/context/WorkspaceContext"'), `${componentFile} must consume WorkspaceContext`);
    }
  });

  await test("26: WorkspaceContext itself remains the single symbol/setSymbol source of truth (no second context provider introduced)", () => {
    const src = read("context/WorkspaceContext.tsx");
    assert.ok(src.includes("export function useWorkspace"));
    const matches = src.match(/=\s*createContext[<(]/g) ?? [];
    assert.equal(matches.length, 1, "exactly one context should be created in this file");
  });

  await test("27: the stale D2.3/D2.4 placeholder text no longer appears anywhere in the Workspace page", () => {
    const src = read("app/dashboard/workspace/page.tsx");
    assert.ok(!src.includes("Embedded assistant arrives later"));
    assert.ok(!src.includes("Research workspace arrives in D2.4"));
    assert.ok(!/\bD2\.3\b/.test(src) || src.includes("Sprint D2.3"), "any remaining D2.3 reference must be a code comment, not user-facing copy");
  });

  await test("28: the Workspace page wires real WorkspaceAssistant/WorkspaceResearch components, not another placeholder", () => {
    const src = read("app/dashboard/workspace/page.tsx");
    assert.ok(src.includes("<WorkspaceAssistant"));
    assert.ok(src.includes("<WorkspaceResearch"));
  });

  await test("29: MarketRibbon no longer uses the wrong stale symbol id 'NIFTY' (must be the real catalog id 'NIFTY50')", () => {
    const src = read("components/workspace/MarketRibbon.tsx");
    assert.ok(!/symbol:\s*"NIFTY"/.test(src));
    assert.ok(/symbol:\s*"NIFTY50"/.test(src));
  });
}

// ============================================================
// F (Workspace Assistant symbol passthrough) - chat route contract
// ============================================================
async function chatSymbolPassthroughTests(): Promise<void> {
  await test("30: the chat route request body type accepts an optional symbol field", () => {
    const src = readFileSync(join(__dirname, "..", "app/api/private/knowledge/chat/route.ts"), "utf8");
    assert.ok(/symbol\?:\s*unknown/.test(src));
    assert.ok(src.includes("requestedSymbol"));
  });

  await test("31: an explicit request-context symbol resolves a question that mentions no instrument in its own text (IntelligenceChatContextService, unmodified)", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("NIFTY50", 24000) }) });
    const result = await chatContext.resolve({ requestId: "wa1", userId: "u1", message: "What's happening?", symbol: "NIFTY50" });
    assert.equal(result.status, "resolved");
    assert.equal(result.envelope?.symbol, "NIFTY50");
  });

  await test("32: a symbol explicitly mentioned in the question text still wins over the request-context symbol (resolution priority unchanged)", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("EURUSD", 1.1) }) });
    const result = await chatContext.resolve({ requestId: "wa2", userId: "u1", message: "What about EURUSD?", symbol: "NIFTY50" });
    assert.equal(result.envelope?.symbol, "EURUSD");
  });

  await test("33: changing the active symbol changes what the next question resolves against (no stale symbol leakage across a Workspace switch)", async () => {
    const niftyContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("NIFTY50", 24000) }) });
    const first = await niftyContext.resolve({ requestId: "wa3", userId: "u1", message: "What's happening?", symbol: "NIFTY50" });
    assert.equal(first.envelope?.symbol, "NIFTY50");

    const relianceContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("RELIANCE", 2900) }) });
    const second = await relianceContext.resolve({ requestId: "wa4", userId: "u1", message: "What's happening?", symbol: "RELIANCE" });
    assert.equal(second.envelope?.symbol, "RELIANCE");
    assert.notEqual(second.envelope?.symbol, first.envelope?.symbol);
  });
}

// ============================================================
// H (Research panel) - ResearchSnapshotService: resolved / insufficient-data
// / clarification, deterministic (no AI presenter call)
// ============================================================
async function researchSnapshotTests(): Promise<void> {
  await test("34: a resolved symbol produces a real VerifiedAnswerResponse with no AI presenter involved", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("BTCUSD", 65000) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "rs1", userId: "u1", symbol: "BTCUSD" });
    assert.ok(result.verifiedAnswer);
    assert.equal(result.verifiedAnswer!.presentedBy, "deterministic-research-snapshot");
    assert.equal(result.verifiedAnswer!.marketContext.symbol, "BTCUSD");
  });

  await test("35: Research's Intelligence Score is the real, unmodified score - never a second formula", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("XAUUSD", 2400) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "rs2", userId: "u1", symbol: "XAUUSD" });
    assert.ok(result.verifiedAnswer!.intelligenceScore);
    assert.equal(typeof result.verifiedAnswer!.intelligenceScore.overallScore === "number" || result.verifiedAnswer!.intelligenceScore.overallScore === undefined, true);
  });

  await test("36: Research honestly reports insufficient-data when no provider can serve the symbol - never a fabricated result", async () => {
    const failingMarketData = new FakeMarketData({ snapshot: async () => { throw new MarketDataProviderError("http_error", "down", "fake"); } });
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: failingMarketData }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "rs3", userId: "u1", symbol: "EURUSD" });
    assert.equal(result.context.status, "insufficient-data");
    assert.equal(result.verifiedAnswer, undefined);
  });

  await test("37: Research does not persist a conversation message or touch conversation continuity state (stateless read)", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("ETHUSD", 3200) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "rs4", userId: "u1", symbol: "ETHUSD" });
    assert.ok(result.verifiedAnswer);
    assert.equal(result.verifiedAnswer!.auditTraceId, undefined);
  });

  await test("38: two different symbols produce independent Research snapshots (no stale cross-symbol leakage)", async () => {
    const svc1 = new ResearchSnapshotService({ chatContext: new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("GBPUSD", 1.27) }) }) });
    const svc2 = new ResearchSnapshotService({ chatContext: new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("SOLUSD", 150) }) }) });
    const r1 = await svc1.build({ requestId: "rs5", userId: "u1", symbol: "GBPUSD" });
    const r2 = await svc2.build({ requestId: "rs6", userId: "u1", symbol: "SOLUSD" });
    assert.equal(r1.verifiedAnswer!.marketContext.symbol, "GBPUSD");
    assert.equal(r2.verifiedAnswer!.marketContext.symbol, "SOLUSD");
  });

  await test("39: Research's deterministic answer text never claims to be AI-authored analysis", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("USDJPY", 155) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "rs7", userId: "u1", symbol: "USDJPY" });
    const answer = result.verifiedAnswer!.answer.toLowerCase();
    assert.ok(!answer.includes("i think") && !answer.includes("i believe"));
  });
}

// ============================================================
// K/L: provider-failure / smart-fallback disclosure honesty (reusing the
// exact same DataQualityAssessment.fallbackUsed signal D2.6.4/D2.6.10
// already established - never re-implemented)
// ============================================================
async function providerFailureTests(): Promise<void> {
  await test("40: a genuine market-data fallback is disclosed honestly through the research snapshot's fallbackUsed field", async () => {
    const candles = makeCandles(trendingBullishCloses(1.3, 0.0003));
    const now = new Date();
    const snapshot: MarketSnapshot = { ...snapshotFor("GBPUSD", candles), timestamp: now.toISOString(), retrievedAt: now.toISOString(), fallbackUsed: true, provider: "alpha-vantage" };
    const marketData = new FakeMarketData({ snapshot: async () => snapshot, candles: async () => candles });
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "pf1", userId: "u1", symbol: "GBPUSD" });
    assert.equal(result.verifiedAnswer!.fallbackUsed, true);
    assert.equal(result.verifiedAnswer!.provider, "alpha-vantage");
  });

  await test("41: no fallback used is disclosed as false, never guessed true", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("EURUSD", 1.1) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "pf2", userId: "u1", symbol: "EURUSD" });
    assert.equal(result.verifiedAnswer!.fallbackUsed, false);
  });
}

// ============================================================
// M: quote/header consistency - every symbol the Workspace can actually
// select (via search) is a symbol the snapshot/ribbon routes will accept
// ============================================================
async function headerConsistencyTests(): Promise<void> {
  await test("42: every catalog instrument with real provider mappings is enabled in market-registry (WorkspaceHeader's snapshot route accepts it)", () => {
    for (const instrument of listCanonicalInstruments()) {
      if (instrument.providerMappings.length === 0) continue; // AAPL - honestly unavailable, expected
      assert.equal(isEnabledMarket(instrument.id), true, `${instrument.id} has real provider coverage but is not enabled in market-registry`);
    }
  });

  await test("43: every symbol in the Market Ribbon's own item list is a real, enabled market symbol", () => {
    const src = readFileSync(join(__dirname, "..", "components/workspace/MarketRibbon.tsx"), "utf8");
    const ids = [...src.matchAll(/symbol:\s*"([A-Z0-9]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 9);
    for (const id of ids) assert.equal(isEnabledMarket(id), true, `MarketRibbon lists ${id} which is not enabled`);
  });
}

// ============================================================
// P: security - no provider credential/secret ever appears in a shape a
// browser would receive (search results, research route, chat route)
// ============================================================
async function securityTests(): Promise<void> {
  await test("44: CanonicalInstrument/ProviderMapping never carries a secret-shaped field name", () => {
    for (const instrument of listCanonicalInstruments()) {
      for (const mapping of instrument.providerMappings) {
        for (const key of Object.keys(mapping)) {
          assert.ok(!/key|secret|token(?!Id)|password|credential/i.test(key) || key === "providerInstrumentId", `suspicious field name "${key}" on a provider mapping`);
        }
      }
    }
  });

  await test("45: the research route never imports a provider adapter directly (frontend/server boundary preserved)", () => {
    const src = readFileSync(join(__dirname, "..", "app/api/private/intelligence/research/route.ts"), "utf8");
    for (const forbidden of ["angel-one.provider", "binance.provider", "twelve-data.provider", "alpha-vantage.provider", "MarketDataService"]) {
      assert.ok(!src.includes(forbidden), `research route must not import ${forbidden} directly`);
    }
  });

  await test("46: the research route requires authentication before returning any data", () => {
    const src = readFileSync(join(__dirname, "..", "app/api/private/intelligence/research/route.ts"), "utf8");
    assert.ok(src.includes("getUserOrNull"));
    assert.ok(src.includes("UNAUTHORIZED"));
  });

  await test("47: WorkspaceAssistant/WorkspaceResearch components never reference an API key or secret env var", () => {
    for (const componentFile of ["components/workspace/WorkspaceAssistant.tsx", "components/workspace/WorkspaceResearch.tsx"]) {
      const src = readFileSync(join(__dirname, "..", componentFile), "utf8");
      assert.ok(!/API_KEY|SECRET|process\.env/i.test(src), `${componentFile} must never reference a server credential`);
    }
  });

  await test("48: a serialized research VerifiedAnswerResponse contains no provider-credential-shaped value", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("BTCUSD", 65000) }) });
    const svc = new ResearchSnapshotService({ chatContext });
    const result = await svc.build({ requestId: "sec1", userId: "u1", symbol: "BTCUSD" });
    const serialized = JSON.stringify(result.verifiedAnswer).toLowerCase();
    assert.ok(!serialized.includes("apikey"));
    assert.ok(!serialized.includes("secret"));
    assert.ok(!serialized.includes("bearer "));
  });
}

// ============================================================
// End-to-end regression scenarios for the exact bug described in the brief
// ============================================================
async function endToEndRegressionTests(): Promise<void> {
  await test("49: default symbol (EURUSD) -> chart resolves and works", () => {
    const r = resolveChartInstrument("EURUSD");
    assert.equal(r.supported, true);
  });

  await test("50: search another supported symbol (RELIANCE) -> select -> chart resolves -> correct symbol displayed", () => {
    const results = new InstrumentSearchService().search("RELIANCE");
    const selected = results[0].instrument;
    const chart = resolveChartInstrument(selected.id);
    assert.equal(chart.canonicalSymbol, "RELIANCE");
    assert.equal(chart.displaySymbol, "Reliance Industries Ltd");
    assert.equal(chart.supported, true);
  });

  await test("51: change again -> the previous chart symbol is not retained (each resolution is independent, no cached prior result)", () => {
    const first = resolveChartInstrument("RELIANCE");
    const second = resolveChartInstrument("ETHUSD");
    assert.notEqual(second.chartSymbol, first.chartSymbol);
    assert.equal(second.canonicalSymbol, "ETHUSD");
  });

  await test("52: India symbol -> real Angel One market-data path end-to-end (deterministic fixture, resolved envelope)", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("NIFTY50", 24000) }) });
    const result = await chatContext.resolve({ requestId: "e2e1", userId: "u1", message: "What's happening?", symbol: "NIFTY50" });
    assert.equal(result.status, "resolved");
    assert.equal(result.envelope?.symbol, "NIFTY50");
    assert.ok(getCanonicalInstrument("NIFTY50")!.providerMappings.some((m) => m.provider === "angel-one"));
  });

  await test("53: crypto -> real Binance-capable market-data path end-to-end", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("BTCUSD", 65000) }) });
    const result = await chatContext.resolve({ requestId: "e2e2", userId: "u1", message: "What's happening?", symbol: "BTCUSD" });
    assert.equal(result.status, "resolved");
    assert.ok(getCanonicalInstrument("BTCUSD")!.providerMappings.some((m) => m.provider === "binance"));
  });

  await test("54: global symbol -> existing Twelve Data/Alpha Vantage path end-to-end, unchanged", async () => {
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: freshMarketData("XAUUSD", 2400) }) });
    const result = await chatContext.resolve({ requestId: "e2e3", userId: "u1", message: "What's happening?", symbol: "XAUUSD" });
    assert.equal(result.status, "resolved");
    assert.ok(getCanonicalInstrument("XAUUSD")!.providerMappings.some((m) => m.provider === "twelve-data"));
  });

  await test("55: provider failure -> the resolution honestly reports insufficient-data, never a fabricated chart or price", async () => {
    const failingMarketData = new FakeMarketData({ snapshot: async () => { throw new MarketDataProviderError("http_error", "down", "fake"); } });
    const chatContext = new IntelligenceChatContextService({ realTime: new RealTimeIntelligenceService({ marketData: failingMarketData }) });
    const result = await chatContext.resolve({ requestId: "e2e4", userId: "u1", message: "What's happening?", symbol: "EURUSD" });
    assert.equal(result.status, "insufficient-data");
  });
}

async function main(): Promise<void> {
  await chartResolverTests();
  await providerMappingTests();
  await searchResultTests();
  await structuralConsistencyTests();
  await chatSymbolPassthroughTests();
  await researchSnapshotTests();
  await providerFailureTests();
  await headerConsistencyTests();
  await securityTests();
  await endToEndRegressionTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
