// scripts/validate-algo-test-production-data.ts
// P3.2A.1 Gates 8/9 - proves the Golden Strategy runs deterministically
// through the PRODUCTION-COMPATIBLE historical-data boundary (Twelve Data,
// a pure HTTPS call, zero filesystem dependency - see
// docs/P3.2A.1-HISTORICAL-DATA-DECISION.md). This is deliberately separate
// from scripts/validate-algo-test-foundation.ts (which uses the local-only
// market-db-provider.ts, still real and still useful for offline dev, but
// NOT the production path) - this file makes real network calls against
// the live Twelve Data API and costs real API credits, so it is not part
// of the always-on validate suite; run explicitly:
//   npm run validate:algo-test-production-data
import assert from "node:assert/strict";
import type { SimulationTrade } from "at24-quant-engine";
import { twelveDataHistoricalDataProvider } from "../services/algo-test/historical-data/twelve-data-provider";
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

// Same fixed week as the P3.2A market.db Golden Run, for direct comparability.
const XAUUSD_M5_RANGE = { symbol: "XAUUSD", timeframe: "M5" as const, startTime: "2024-01-08T00:00:00Z", endTime: "2024-01-13T00:00:00Z" };

let firstOutcome: Awaited<ReturnType<typeof runGoldenBacktest>> | undefined;

async function main(): Promise<void> {
  console.log("=== Gate 8: XAUUSD M5 through the production-compatible (Twelve Data) boundary ===");

  await test("bars exist, ordering correct, OHLC validation passes, expected date range available", async () => {
    const { bars, rejected, source } = await twelveDataHistoricalDataProvider.getBars(XAUUSD_M5_RANGE);
    assert.ok(bars.length > 1000, `expected >1000 real M5 bars for a full week from Twelve Data, got ${bars.length}`);
    assert.equal(rejected.length, 0, "the real Twelve Data XAUUSD M5 series must not contain rejected bars");
    assert.equal(source, "twelve-data (XAU/USD/5min)");
    assert.ok(bars[0]!.timestamp < bars[bars.length - 1]!.timestamp, "must be ordered oldest-first");
    assert.equal(new Date(bars[0]!.timestamp).toISOString().slice(0, 10), "2024-01-08", "must start within the requested date range");
  });

  await test("engine accepts the bars; Golden Strategy executes", async () => {
    firstOutcome = await runGoldenBacktest({ ...XAUUSD_M5_RANGE, initialBalance: 10_000 }, twelveDataHistoricalDataProvider);
    assert.ok(firstOutcome.barsUsed > 1000);
    assert.equal(firstOutcome.barsRejected, 0);
    assert.ok(firstOutcome.result.tradeLedger.length > 0, "must produce real trades, not a no-op run");
    assert.equal(firstOutcome.result.resultHash.length, 64);
  });

  console.log("\n=== Gate 9: RUN #1 === RUN #2 through the production-compatible data path ===");
  await test("determinism against live Twelve Data (real network call, twice)", async () => {
    assert.ok(firstOutcome, "Gate 8's engine run must have already executed");
    const run2 = await runGoldenBacktest({ ...XAUUSD_M5_RANGE, initialBalance: 10_000 }, twelveDataHistoricalDataProvider);

    assert.equal(run2.result.resultHash, firstOutcome!.result.resultHash, "resultHash must be byte-identical across independent runs and independent network calls");
    assert.equal(run2.result.tradeLedger.length, firstOutcome!.result.tradeLedger.length, "trade count must match");
    for (let i = 0; i < run2.result.tradeLedger.length; i++) {
      const a: SimulationTrade = firstOutcome!.result.tradeLedger[i]!;
      const b: SimulationTrade = run2.result.tradeLedger[i]!;
      assert.equal(a.tradeId, b.tradeId, `trade #${i} id must match`);
      assert.equal(a.entryPrice, b.entryPrice, `trade #${i} entry price must match`);
      assert.equal(a.exitPrice, b.exitPrice, `trade #${i} exit price must match`);
      assert.equal(a.netPnl, b.netPnl, `trade #${i} P&L must match`);
    }
    assert.deepEqual(run2.result.metrics, firstOutcome!.result.metrics, "metrics must be byte-identical");
    assert.deepEqual(run2.equityCurve, firstOutcome!.equityCurve, "the derived equity curve must be byte-identical");

    console.log(`    resultHash: ${run2.result.resultHash}`);
    console.log(`    trades: ${run2.result.tradeLedger.length}, winRate: ${run2.result.metrics.winRate}%`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
