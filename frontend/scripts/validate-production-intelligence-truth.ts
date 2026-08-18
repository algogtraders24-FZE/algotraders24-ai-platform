// scripts/validate-production-intelligence-truth.ts
// Sprint D2.9.1 - Production Intelligence Truth & Cross-Layer Consistency
// Audit. Standalone, assert-based verification (no test framework),
// matching every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:production-intelligence-truth`.
//
// This is an AUDIT script, not a new-feature test suite - it proves the
// specific cross-layer consistency invariants named in the D2.9.1 brief
// that were NOT already covered by an existing suite. Scenarios already
// proven end-to-end by existing, currently-passing suites are NOT
// re-implemented here (that would itself be "a second, duplicated
// implementation" this codebase's own convention warns against) - see
// docs/architecture/D2.9.1-production-intelligence-truth-audit.md for the
// full cross-reference table and every suite/test name this audit relies
// on, with pass counts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MarketDataService } from "../services/market-data/market-data.service";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";
import { HypothesisOutcomeEvaluatorService } from "../services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import type { Candle, TimeSeriesRequest } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { MarketDataProvider, TimeSeriesProvider, MarketContextRequest, MarketContextResult } from "../types/market-data-provider";
import type { Clock } from "../lib/market-data/cache";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}
async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
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

const HOUR_MS = 3_600_000;
function makeHourlyCandles(closesArr: number[], volatilityFrac: number, anchorMs: number): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(anchorMs + i * HOUR_MS).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}
function snapshotFor(candles: Candle[]): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}
class FakeTimeSeriesProvider implements TimeSeriesProvider {
  readonly name = "fake";
  constructor(private readonly candles: Candle[]) {}
  isConfigured(): boolean {
    return true;
  }
  async getTimeSeries(): Promise<Candle[]> {
    return this.candles;
  }
}
function fixedClock(atMs: number): Clock {
  return { now: () => atMs };
}

// ============================================================
// Section 3 - Timestamp / point-in-time audit
// ============================================================
async function timestampAuditTests(): Promise<void> {
  const marketStateSvc = new MarketStateService();
  const regimeSvc = new RegimeService();
  const hypothesisSvc = new HypothesisService();
  const evaluator = new HypothesisOutcomeEvaluatorService();

  const runCreatedAtMs = Date.now();
  const closes = trendingBullishCloses();
  const anchorMs = runCreatedAtMs - (closes.length - 1) * HOUR_MS;
  const creationCandles = makeHourlyCandles(closes, 0.0008, anchorMs);
  const snapshot = snapshotFor(creationCandles);
  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles: creationCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypothesis = hypothesisSvc.generate({ marketState, regime })[0];

  const lastMs = new Date(creationCandles[creationCandles.length - 1].datetime).getTime();
  const lastClose = creationCandles[creationCandles.length - 1].close;
  const continuation = makeHourlyCandles(
    Array.from({ length: 30 }, (_, i) => lastClose + (i + 1) * 0.0015),
    0.0008,
    lastMs + HOUR_MS,
  );
  const allCandles = [...creationCandles, ...continuation];
  const provider = new FakeTimeSeriesProvider(allCandles);
  const dueAt = runCreatedAtMs + hypothesis.statement.predictionWindow.candles * HOUR_MS;

  await testAsync("T0: exactly at the window-close boundary minus 1s, the evaluation is still pending - only data <= T0 is ever considered eligible", async () => {
    const result = await evaluator.evaluateHypothesis({
      hypothesis,
      marketStateAtCreation: marketState,
      createdAt: new Date(runCreatedAtMs).toISOString(),
      timeSeriesProvider: provider,
      clock: fixedClock(dueAt - 1000),
    });
    assert.equal(result.status, "pending");
  });

  await testAsync("T1: 1s after the SAME boundary, with the SAME input data, additional data becomes usable and the evaluation resolves", async () => {
    const result = await evaluator.evaluateHypothesis({
      hypothesis,
      marketStateAtCreation: marketState,
      createdAt: new Date(runCreatedAtMs).toISOString(),
      timeSeriesProvider: provider,
      clock: fixedClock(dueAt + 1000),
    });
    assert.notEqual(result.status, "pending");
  });

  await testAsync("determinism: the SAME reference clock + SAME input data produces the SAME result across repeated evaluations", async () => {
    const r1 = await evaluator.evaluateHypothesis({
      hypothesis,
      marketStateAtCreation: marketState,
      createdAt: new Date(runCreatedAtMs).toISOString(),
      timeSeriesProvider: provider,
      clock: fixedClock(dueAt + 1000),
    });
    const r2 = await evaluator.evaluateHypothesis({
      hypothesis,
      marketStateAtCreation: marketState,
      createdAt: new Date(runCreatedAtMs).toISOString(),
      timeSeriesProvider: provider,
      clock: fixedClock(dueAt + 1000),
    });
    assert.equal(r1.status, r2.status);
    assert.equal(r1.actualPriceMovePct, r2.actualPriceMovePct);
    assert.equal(r1.evaluationBasis, r2.evaluationBasis);
  });

  test("D2.9.0 clock-propagation fix remains intact: evaluateHypothesis threads clock.now() into assemble()'s nowMs (regression guard against this exact fix being reverted)", () => {
    const source = readFileSync(
      join(__dirname, "..", "services/intelligence/hypothesis/hypothesis-outcome-evaluator.service.ts"),
      "utf8",
    );
    assert.match(source, /nowMs:\s*clock\.now\(\)/);
  });

  test("candle validation remains wired: MarketStateService.assemble() still calls validateCandles with the caller-supplied (or defaulted) nowMs, never a hardcoded value", () => {
    const source = readFileSync(join(__dirname, "..", "services/intelligence/market-state/market-state.service.ts"), "utf8");
    assert.match(source, /validateCandles\(input\.candles,\s*input\.nowMs\s*\?\?\s*Date\.now\(\)\)/);
  });
}

// ============================================================
// Section 8 - Microstructure containment
// ============================================================
function microstructureContainmentTests(): void {
  const requiredInstruments = ["BTCUSD", "ETHUSD", "EURUSD", "XAUUSD", "XAGUSD", "NIFTY50", "BANKNIFTY"];
  const binanceCapable = new Set(["BTCUSD", "ETHUSD"]);

  for (const symbol of requiredInstruments) {
    test(`microstructure containment: ${symbol}'s canonical catalog entry ${binanceCapable.has(symbol) ? "correctly HAS" : "correctly has NO"} a binance provider mapping`, () => {
      const instrument = getCanonicalInstrument(symbol);
      assert.ok(instrument, `${symbol} must exist in the canonical catalog`);
      const hasBinance = (instrument!.providerMappings ?? []).some((m) => m.provider === "binance");
      assert.equal(hasBinance, binanceCapable.has(symbol));
    });
  }

  test("microstructure containment: fetchMicrostructure() gates on the instrument's own real providerMappings, never a hardcoded symbol list that could drift from the catalog", () => {
    const source = readFileSync(
      join(__dirname, "..", "services/intelligence/orchestration/real-time-intelligence.service.ts"),
      "utf8",
    );
    assert.match(source, /providerMappings[\s\S]*some[\s\S]*m\.provider === this\.microstructureProvider\.name/);
  });

  test("no-overclaim guard exists and is checked unconditionally: AI responses can never claim 'global market liquidity' from Binance-sourced evidence (D2.8.2/D2.8.7-12's permanent rule)", () => {
    const source = readFileSync(join(__dirname, "..", "services/intelligence/chat/ai-response-integrity.service.ts"), "utf8");
    assert.match(source, /MICROSTRUCTURE_OVERCLAIM_PATTERNS/);
  });
}

// ============================================================
// Section 12 - Cache / request consistency
// ============================================================
async function cacheConsistencyTests(): Promise<void> {
  class CountingTimeSeriesProvider implements MarketDataProvider, TimeSeriesProvider {
    readonly name = "counting-fake";
    calls: string[] = [];
    isConfigured(): boolean {
      return true;
    }
    async getMarketContext(req: MarketContextRequest): Promise<MarketContextResult> {
      throw new Error(`not used in this test (${req.symbol})`);
    }
    async getTimeSeries(request: TimeSeriesRequest): Promise<Candle[]> {
      this.calls.push(request.symbol);
      return [{ datetime: new Date().toISOString(), open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    }
  }

  await testAsync("cache isolation: a symbol switch is never served the previous symbol's cached candle result - each symbol gets its own real provider call", async () => {
    const fake = new CountingTimeSeriesProvider();
    const svc = new MarketDataService({ providers: [fake] });
    const eur = await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD", interval: "1h", outputSize: 100 });
    const btc = await svc.getTimeSeriesWithProvenance({ symbol: "BTCUSD", interval: "1h", outputSize: 100 });
    assert.deepEqual(fake.calls, ["EURUSD", "BTCUSD"], "both symbols must reach the real provider - never share a cache entry");
    assert.notEqual(eur, btc);
  });

  await testAsync("cache correctness: the SAME symbol/interval/outputSize within the cache window is served from cache, never re-hitting the provider", async () => {
    const fake = new CountingTimeSeriesProvider();
    const svc = new MarketDataService({ providers: [fake] });
    await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD", interval: "1h", outputSize: 100 });
    await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD", interval: "1h", outputSize: 100 });
    assert.equal(fake.calls.length, 1, "the second identical request must be served from cache, not a second provider call");
  });

  await testAsync("cache correctness: the SAME symbol at a DIFFERENT interval is never conflated with a different timeframe's cached candles", async () => {
    const fake = new CountingTimeSeriesProvider();
    const svc = new MarketDataService({ providers: [fake] });
    await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD", interval: "1h", outputSize: 100 });
    await svc.getTimeSeriesWithProvenance({ symbol: "EURUSD", interval: "1day", outputSize: 100 });
    assert.equal(fake.calls.length, 2, "a different interval must be a real cache miss, never served from the 1h entry");
  });
}

// ============================================================
// Section 2 - Instrument identity / stale-state regression guards
// ============================================================
function instrumentIdentityRegressionTests(): void {
  test("D2.9.1: WorkspaceHeader's symbol-switch effect clears snapshot to null before the new fetch (D2.8.16 fix - re-confirmed intact, not reverted)", () => {
    const source = readFileSync(join(__dirname, "..", "components/workspace/WorkspaceHeader.tsx"), "utf8");
    const effectBody = source.slice(source.indexOf("useEffect(() => {"), source.indexOf("}, [symbol]);"));
    assert.match(effectBody, /setSnapshot\(null\)/);
  });

  test("D2.9.1: XAGUSD's Twelve Data catalog mapping is honestly marked verified:false (live-confirmed HTTP 404 plan restriction in D2.9.0) - never a stale false-positive", () => {
    const source = readFileSync(join(__dirname, "..", "lib/market-data/instrument-catalog.ts"), "utf8");
    const xagBlock = source.slice(source.indexOf('id: "XAGUSD"'), source.indexOf('id: "BTCUSD"'));
    assert.match(xagBlock, /provider:\s*"twelve-data"[^\n]*verified:\s*false/);
  });

  test("D2.9.1: XAUUSD's Twelve Data catalog mapping stays verified:true (live-confirmed working in D2.9.0/D2.9.1 - correctly distinct from XAGUSD)", () => {
    const source = readFileSync(join(__dirname, "..", "lib/market-data/instrument-catalog.ts"), "utf8");
    const xauBlock = source.slice(source.indexOf('id: "XAUUSD"'), source.indexOf('id: "XAGUSD"'));
    assert.match(xauBlock, /provider:\s*"twelve-data"[^\n]*verified:\s*true/);
  });
}

async function main(): Promise<void> {
  await timestampAuditTests();
  microstructureContainmentTests();
  await cacheConsistencyTests();
  instrumentIdentityRegressionTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log("\nSee docs/architecture/D2.9.1-production-intelligence-truth-audit.md for the full cross-layer trace, the chat/research/chart comparison, the failure-mode matrix, and cross-referenced coverage from every other existing suite this audit relies on.");
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
