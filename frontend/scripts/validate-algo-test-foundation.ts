// scripts/validate-algo-test-foundation.ts
// P3.2A - closes the three P3.1 blockers. Covers exactly what the sprint
// brief requires and nothing more (Hard Scope Boundary: no chart UI, no
// new engine, no strategy generation - see docs/P3.2A-*.md):
//   Package:         public import works
//   Historical Data: date-range query works; valid bars accepted;
//                     invalid bars rejected; ordering verified;
//                     duplicate timestamps handled
//   Engine:           historical bars -> existing deterministic engine -> result
//   Result:           ledger <-> metrics <-> equity curve internally consistent
//   Golden Run:       run #1 === run #2 (full determinism)
import assert from "node:assert/strict";
import type { OHLCVBar, SimulationTrade } from "at24-quant-engine";
import { runSimulation, buildGoldenStrategySpec } from "at24-quant-engine";
import { marketDbHistoricalDataProvider, resolveMarketDbPath } from "../services/algo-test/historical-data/market-db-provider";
import { validateBars } from "../services/algo-test/historical-data/validate-bars";
import { runGoldenBacktest } from "../services/algo-test/run-golden-backtest";

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

const XAUUSD_M5_RANGE = { symbol: "XAUUSD", timeframe: "M5" as const, startTime: "2024-01-08T00:00:00Z", endTime: "2024-01-13T00:00:00Z" };

async function packageTests(): Promise<void> {
  await test("Blocker 1 - public import works: at24-quant-engine's package.json resolves main/types/exports", async () => {
    // If this file's own top-level `import { runSimulation, buildGoldenStrategySpec } from "at24-quant-engine"`
    // hadn't resolved, the process would already have crashed before main() ran - proving the
    // package boundary is real, not just declared. Re-assert the functions are actually callable.
    assert.equal(typeof runSimulation, "function");
    assert.equal(typeof buildGoldenStrategySpec, "function");
    const spec = buildGoldenStrategySpec();
    assert.equal(spec.identity.strategyId, "sim-golden", "must be the ONE existing Golden Strategy, not a second one");
  });
}

async function historicalDataTests(): Promise<void> {
  await test("market.db is reachable at the resolved path", () => {
    const p = resolveMarketDbPath();
    assert.ok(p.endsWith("market.db"), `unexpected path shape: ${p}`);
  });

  await test("date-range query works: real XAUUSD M5 bars returned for a fixed historical week", async () => {
    const { bars, rejected, source } = await marketDbHistoricalDataProvider.getBars(XAUUSD_M5_RANGE);
    assert.ok(bars.length > 1000, `expected >1000 real M5 bars for a full week, got ${bars.length}`);
    assert.equal(rejected.length, 0, "the real dataset itself must not contain rejected bars");
    assert.equal(source, "market.db (XAUUSD_EXNESS/5m)");
    assert.equal(bars[0]!.instrument.symbol, "XAUUSD", "canonical symbol, never the broker-suffixed market.db key");
    assert.equal(bars[0]!.timeframe, "M5", "engine's own Timeframe token, never market.db's '5m'");
    assert.ok(bars[0]!.timestamp < bars[bars.length - 1]!.timestamp, "bars must span the requested range in order");
  });

  await test("valid bars accepted: a clean synthetic sequence passes validation with zero rejections", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [
      { timestamp: 1000, instrument, timeframe: "M5", open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: 2000, instrument, timeframe: "M5", open: 10.5, high: 12, low: 10, close: 11.5, volume: 100 },
    ];
    const { validBars, rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(validBars.length, 2);
    assert.equal(rejected.length, 0);
  });

  await test("invalid bars rejected: high < low is rejected, never silently fabricated/coerced", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [{ timestamp: 1000, instrument, timeframe: "M5", open: 10, high: 8, low: 12, close: 9, volume: 100 }];
    const { validBars, rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(validBars.length, 0);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]!.reason, "INVALID_OHLC");
  });

  await test("invalid bars rejected: high < max(open, close) is rejected", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [{ timestamp: 1000, instrument, timeframe: "M5", open: 10, high: 10.2, low: 9, close: 11, volume: 100 }];
    const { validBars, rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(validBars.length, 0);
    assert.equal(rejected[0]!.reason, "INVALID_OHLC");
  });

  await test("ordering verified: an out-of-order timestamp is rejected, not silently reordered", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [
      { timestamp: 2000, instrument, timeframe: "M5", open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: 1000, instrument, timeframe: "M5", open: 10.5, high: 12, low: 10, close: 11.5, volume: 100 },
    ];
    const { validBars, rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(validBars.length, 1, "the first (valid) bar is kept; the out-of-order second bar is rejected");
    assert.equal(rejected[0]!.reason, "OUT_OF_ORDER");
  });

  await test("duplicate timestamps handled: a repeated timestamp is rejected, first occurrence kept", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [
      { timestamp: 1000, instrument, timeframe: "M5", open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { timestamp: 1000, instrument, timeframe: "M5", open: 10.6, high: 11.2, low: 9.5, close: 10.8, volume: 100 },
    ];
    const { validBars, rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(validBars.length, 1);
    assert.equal(rejected[0]!.reason, "DUPLICATE_TIMESTAMP");
  });

  await test("symbol mismatch is rejected", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const wrongInstrument = { symbol: "OTHER", assetClass: "other" as const };
    const bars: OHLCVBar[] = [{ timestamp: 1000, instrument: wrongInstrument, timeframe: "M5", open: 10, high: 11, low: 9, close: 10.5, volume: 100 }];
    const { rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(rejected[0]!.reason, "SYMBOL_MISMATCH");
  });

  await test("timeframe mismatch is rejected", () => {
    const instrument = { symbol: "TESTSYM", assetClass: "other" as const };
    const bars: OHLCVBar[] = [{ timestamp: 1000, instrument, timeframe: "M15", open: 10, high: 11, low: 9, close: 10.5, volume: 100 }];
    const { rejected } = validateBars(bars, { instrument, timeframe: "M5" });
    assert.equal(rejected[0]!.reason, "TIMEFRAME_MISMATCH");
  });

  await test("an unmapped symbol/timeframe is refused, never silently mapped to the wrong instrument", async () => {
    await assert.rejects(() => marketDbHistoricalDataProvider.getBars({ symbol: "NOTREAL", timeframe: "M5", startTime: XAUUSD_M5_RANGE.startTime, endTime: XAUUSD_M5_RANGE.endTime }));
  });
}

let firstRunResultHash: string | undefined;
let firstRunOutcome: Awaited<ReturnType<typeof runGoldenBacktest>> | undefined;

async function engineIntegrationTests(): Promise<void> {
  await test("historical bars -> existing deterministic engine -> result (Golden Strategy, real XAUUSD M5)", async () => {
    const outcome = await runGoldenBacktest({ ...XAUUSD_M5_RANGE, initialBalance: 10_000 }, marketDbHistoricalDataProvider);
    firstRunOutcome = outcome;
    firstRunResultHash = outcome.result.resultHash;
    assert.ok(outcome.barsUsed > 1000);
    assert.equal(outcome.barsRejected, 0);
    assert.ok(outcome.result.tradeLedger.length > 0, "the Golden Strategy's PRICE>100 entry rule is trivially true for real XAUUSD prices - it must produce real trades, not a no-op run");
    assert.equal(typeof outcome.result.resultHash, "string");
    assert.equal(outcome.result.resultHash.length, 64, "sha256 hex digest, same shape as the engine's own golden-fixture test");
  });
}

async function resultConsistencyTests(): Promise<void> {
  await test("ledger <-> metrics <-> equity curve are internally consistent", () => {
    assert.ok(firstRunOutcome, "engine integration test must run first");
    const { result, equityCurve } = firstRunOutcome!;

    const netProfit = result.metrics.netProfit;
    const winRate = result.metrics.winRate;
    assert.equal(typeof netProfit, "number", "computeCoreMetrics() must always populate netProfit for a real run");
    assert.equal(typeof winRate, "number", "computeCoreMetrics() must always populate winRate for a real run");

    const sumNetPnl = result.tradeLedger.reduce((acc, t) => acc + t.netPnl, 0);
    assert.ok(Math.abs(netProfit! - sumNetPnl) < 1e-9, `metrics.netProfit (${netProfit}) must equal the ledger's own summed netPnl (${sumNetPnl})`);
    assert.equal(result.metrics.tradeCount, result.tradeLedger.length, "metrics.tradeCount must equal the real ledger length");

    const wins = result.tradeLedger.filter((t) => t.netPnl > 0).length;
    const expectedWinRate = (100 * wins) / result.tradeLedger.length;
    assert.ok(Math.abs(winRate! - expectedWinRate) < 1e-9, `metrics.winRate must match a hand-computed win rate from the ledger (${expectedWinRate} vs ${winRate})`);

    assert.equal(equityCurve.length, result.tradeLedger.length + 1, "one starting point plus one point per closed trade");
    assert.equal(equityCurve[0]!.balance, 10_000, "the equity curve must start at the requested initialBalance");
    const lastPoint = equityCurve[equityCurve.length - 1]!;
    assert.ok(Math.abs(lastPoint.balance - result.finalAccount.balance) < 1e-9, `the equity curve's final point (${lastPoint.balance}) must equal finalAccount.balance (${result.finalAccount.balance}) - same number, never a second calculation path`);
    assert.ok(
      Math.abs(result.finalAccount.balance - (10_000 + result.finalAccount.realizedPnl)) < 1e-6,
      `balance = initialBalance + realizedPnl, the same identity verified in the P3.1 Backtest Truth Audit (${result.finalAccount.balance} vs ${10_000 + result.finalAccount.realizedPnl})`,
    );
  });
}

async function goldenRunDeterminismTests(): Promise<void> {
  await test("RUN #1 === RUN #2: full determinism against real historical data", async () => {
    assert.ok(firstRunOutcome && firstRunResultHash, "run #1 must have already executed");
    const run2 = await runGoldenBacktest({ ...XAUUSD_M5_RANGE, initialBalance: 10_000 }, marketDbHistoricalDataProvider);

    assert.equal(run2.result.resultHash, firstRunResultHash, "resultHash must be byte-identical across independent runs");
    assert.equal(run2.result.tradeLedger.length, firstRunOutcome!.result.tradeLedger.length, "trade count must match");

    for (let i = 0; i < run2.result.tradeLedger.length; i++) {
      const a: SimulationTrade = firstRunOutcome!.result.tradeLedger[i]!;
      const b: SimulationTrade = run2.result.tradeLedger[i]!;
      assert.equal(a.tradeId, b.tradeId, `trade #${i} id must match (trade sequence)`);
      assert.equal(a.entryPrice, b.entryPrice, `trade #${i} entry price must match`);
      assert.equal(a.exitPrice, b.exitPrice, `trade #${i} exit price must match`);
      assert.equal(a.netPnl, b.netPnl, `trade #${i} P&L must match`);
    }

    assert.deepEqual(run2.result.metrics, firstRunOutcome!.result.metrics, "metrics must be byte-identical");
    assert.deepEqual(run2.equityCurve, firstRunOutcome!.equityCurve, "the derived equity curve must be byte-identical (it is a pure function of the identical ledger)");
  });
}

async function main(): Promise<void> {
  console.log("=== Blocker 1: Package export ===");
  await packageTests();
  console.log("\n=== Blocker 2: Historical Data Provider ===");
  await historicalDataTests();
  console.log("\n=== Engine integration ===");
  await engineIntegrationTests();
  console.log("\n=== Result consistency ===");
  await resultConsistencyTests();
  console.log("\n=== Golden Run determinism (Run #1 === Run #2) ===");
  await goldenRunDeterminismTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
