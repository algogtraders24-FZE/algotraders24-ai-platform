// scripts/validate-algo-test-analytics.ts
// P4.4 (docs/P4.4-ADVANCED-ANALYTICS-FOUNDATION.md). Two layers:
// (1) pure, offline unit tests of the Tier 1 projection functions
//     (algo-test-analytics.ts) against hand-verified trade arrays - no
//     network, no DB, no engine build needed;
// (2) end-to-end proof, through the REAL algoTestService.compileAndRunAiStrategy()
//     and getAlgoTestRun(), that `analytics` is genuinely wired into
//     both a fresh run AND a reopened one - unlike lifecycle/
//     compiledStrategy/strategyHash (P4.3), which are NOT reconstructed
//     on reopen. Uses the same fake AIProvider/HistoricalDataProvider/
//     Prisma pattern validate-ai-run-backtest-wiring.ts already
//     established.
import assert from "node:assert/strict";
import { buildCalendar, buildDurationVsPnl, buildPnlDistribution, buildSideBreakdown } from "../services/algo-test/algo-test-analytics";
import { algoTestService, maxRangeDaysFor } from "../services/algo-test/algo-test.service";
import { prisma } from "../lib/prisma";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionResponse } from "../lib/ai/types";
import type { HistoricalDataProvider } from "../services/algo-test/historical-data/types";
import type { AlgoTestTradeView } from "../types/algo-test";
import type { OHLCVBar } from "at24-quant-engine";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const done = (ok: boolean, err?: unknown) => {
    if (ok) {
      passed += 1;
      console.log(`  ok - ${name}`);
    } else {
      failed += 1;
      console.error(`  FAIL - ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) return r.then(() => done(true)).catch((e) => done(false, e));
    done(true);
  } catch (e) {
    done(false, e);
  }
}

function trade(overrides: Partial<AlgoTestTradeView>): AlgoTestTradeView {
  return {
    tradeId: "t", symbol: "XAUUSD", side: "BUY", quantity: 1,
    entryTime: 0, entryPrice: 100, exitTime: 0, exitPrice: 100,
    pnl: 0, grossPnl: 0, fees: 0, rMultiple: null,
    ...overrides,
  };
}

async function main() {
  console.log("=== Tier 1: pure projection unit tests ===");

  test("P&L distribution: empty trades -> zero counts, null averages/medians, no buckets", () => {
    const d = buildPnlDistribution([]);
    assert.equal(d.winCount, 0);
    assert.equal(d.lossCount, 0);
    assert.equal(d.winAverage, null);
    assert.equal(d.lossAverage, null);
    assert.equal(d.winMedian, null);
    assert.equal(d.lossMedian, null);
    assert.deepEqual(d.buckets, []);
  });

  test("P&L distribution: hand-verified wins/losses, sums, averages, medians", () => {
    // wins: 10, 20, 30 (median 20, avg 20); losses: -5, -15 (median -10, avg -10)
    const trades = [trade({ pnl: 10 }), trade({ pnl: 20 }), trade({ pnl: 30 }), trade({ pnl: -5 }), trade({ pnl: -15 })];
    const d = buildPnlDistribution(trades);
    assert.equal(d.winCount, 3);
    assert.equal(d.lossCount, 2);
    assert.equal(d.winSum, 60);
    assert.equal(d.lossSum, -20);
    assert.equal(d.winAverage, 20);
    assert.equal(d.lossAverage, -10);
    assert.equal(d.winMedian, 20);
    assert.equal(d.lossMedian, -10);
  });

  test("P&L distribution: every trade sharing the same P&L produces exactly ONE bucket, never a divide-by-zero-width crash", () => {
    const trades = [trade({ pnl: 50 }), trade({ pnl: 50 }), trade({ pnl: 50 })];
    const d = buildPnlDistribution(trades);
    assert.equal(d.buckets.length, 1);
    assert.equal(d.buckets[0]?.count, 3);
    assert.equal(d.buckets[0]?.rangeStart, 50);
    assert.equal(d.buckets[0]?.rangeEnd, 50);
  });

  test("P&L distribution: buckets never exceed 10, and every trade is accounted for exactly once (including the max-value edge case)", () => {
    const pnls = Array.from({ length: 37 }, (_, i) => i - 18); // -18..18, 37 distinct values
    const trades = pnls.map((pnl) => trade({ pnl }));
    const d = buildPnlDistribution(trades);
    assert.ok(d.buckets.length <= 10);
    const totalCounted = d.buckets.reduce((s, b) => s + b.count, 0);
    assert.equal(totalCounted, trades.length, "every trade must land in exactly one bucket - none dropped, none double-counted");
    assert.equal(d.buckets[d.buckets.length - 1]?.rangeEnd, 18, "the maximum value must be included in the last bucket's inclusive upper bound");
  });

  test("Side breakdown: BUY/SELL counted independently, winRate/netPnl/averagePnl all real, 0 (not null/NaN) for a side with zero trades", () => {
    const trades = [
      trade({ side: "BUY", pnl: 100 }),
      trade({ side: "BUY", pnl: -40 }),
      trade({ side: "SELL", pnl: 60 }),
    ];
    const b = buildSideBreakdown(trades);
    assert.equal(b.buy.tradeCount, 2);
    assert.equal(b.buy.winRate, 50);
    assert.equal(b.buy.netPnl, 60);
    assert.equal(b.buy.averagePnl, 30);
    assert.equal(b.sell.tradeCount, 1);
    assert.equal(b.sell.winRate, 100);
    assert.equal(b.sell.averagePnl, 60);
  });

  test("Side breakdown: a strategy with only BUY trades gives SELL a real, defined 0-trade entry, never undefined", () => {
    const b = buildSideBreakdown([trade({ side: "BUY", pnl: 10 })]);
    assert.equal(b.sell.tradeCount, 0);
    assert.equal(b.sell.winRate, 0);
    assert.equal(b.sell.netPnl, 0);
    assert.equal(b.sell.averagePnl, null);
  });

  test("Duration vs P&L: real per-trade duration derived from entry/exit, never persisted elsewhere", () => {
    const trades = [trade({ tradeId: "a", entryTime: 1000, exitTime: 5000, pnl: 25, side: "BUY" })];
    const points = buildDurationVsPnl(trades);
    assert.equal(points.length, 1);
    assert.equal(points[0]?.durationMs, 4000);
    assert.equal(points[0]?.pnl, 25);
    assert.equal(points[0]?.tradeId, "a");
  });

  test("Calendar: groups by UTC exit date, real winning/losing/breakeven classification, zero-trade days simply absent (never fabricated)", () => {
    const day1 = Date.UTC(2026, 0, 1, 10, 0, 0);
    const day1Later = Date.UTC(2026, 0, 1, 18, 0, 0);
    const day3 = Date.UTC(2026, 0, 3, 12, 0, 0);
    const trades = [
      trade({ exitTime: day1, pnl: 10 }),
      trade({ exitTime: day1Later, pnl: -30 }), // same UTC day as above -> one entry, netPnl -20
      trade({ exitTime: day3, pnl: 0 }),
    ];
    const cal = buildCalendar(trades);
    assert.equal(cal.length, 2, "day 2 had zero trades and must be genuinely absent, not a fabricated zero entry");
    assert.equal(cal[0]?.date, "2026-01-01");
    assert.equal(cal[0]?.tradeCount, 2);
    assert.equal(cal[0]?.netPnl, -20);
    assert.equal(cal[0]?.outcome, "losing");
    assert.equal(cal[1]?.date, "2026-01-03");
    assert.equal(cal[1]?.outcome, "breakeven");
  });

  console.log("\n=== Phase C: timeframe-aware range policy ===");

  test("maxRangeDaysFor: every real, provider-supported timeframe's cap is the SAME 4,032-bar budget divided by its own bars/day - not per-timeframe invented numbers", () => {
    assert.equal(maxRangeDaysFor("M5"), 14, "the original, live-verified value must be unchanged");
    assert.equal(maxRangeDaysFor("M1"), 2);
    assert.equal(maxRangeDaysFor("M15"), 42);
    assert.equal(maxRangeDaysFor("M30"), 84);
    assert.equal(maxRangeDaysFor("H1"), 168);
    assert.equal(maxRangeDaysFor("H4"), 672);
    assert.equal(maxRangeDaysFor("D1"), 4032);
  });

  test("maxRangeDaysFor: a Timeframe this program has no real provider coverage for (W1) throws loudly rather than returning a meaningless number", () => {
    assert.throws(() => maxRangeDaysFor("W1"));
  });

  console.log("\n=== Phase D: service integration, end to end ===");

  const users = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const nextId = (p: string) => `${p}_${++seq}`;
  (prisma as unknown as { user: unknown }).user = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { id: nextId("user"), ...data };
      users.set(row.id, row);
      return row;
    },
  };
  (prisma as unknown as { algoTestRun: unknown }).algoTestRun = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row = { id: nextId("run"), createdAt: new Date(), completedAt: null, ...data };
      runs.set(row.id as string, row);
      return row;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = runs.get(where.id);
      if (!existing) throw new Error(`no row ${where.id}`);
      const updated = { ...existing, ...data };
      runs.set(where.id, updated);
      return updated;
    },
    async findFirst({ where }: { where: { id: string; userId: string } }) {
      const row = runs.get(where.id);
      return row && row.userId === where.userId ? row : null;
    },
  };
  const user = await prisma.user.create({ data: { email: `p44${Date.now()}@internal.test`, name: "P4.4 Test" } });

  function fakeProvider(json: string): AIProvider {
    return { name: "claude", async complete(): Promise<AICompletionResponse> { return { content: json, model: "fake-model", provider: "claude" }; } };
  }
  function compileResponse(fast: number, slow: number, timeframe: string): string {
    return JSON.stringify({
      intent: `EMA ${fast} crosses above EMA ${slow}`,
      instruments: [{ symbol: "XAUUSD" }], timeframes: [timeframe],
      indicators: [{ family: "EMA", params: [fast] }, { family: "EMA", params: [slow] }],
      entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [fast] } }, right: { kind: "indicator", ref: { name: "EMA", params: [slow] } } } }],
      exitConditions: [],
      risk: { sizing: { method: "fixed-quantity", quantity: 1 }, stopLoss: { type: "fixed-distance", distance: 5 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
    });
  }
  function fakeBars(warmup: number, timeframe: OHLCVBar["timeframe"]): OHLCVBar[] {
    const bars: OHLCVBar[] = []; const instrument = { symbol: "XAUUSD" }; let t = 0;
    for (let i = 0; i < warmup; i++) { bars.push({ timestamp: t, instrument, timeframe, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 }); t += 900_000; }
    for (let i = 0; i < 25; i++) { const close = 100 + (i + 1) * 2.4; bars.push({ timestamp: t, instrument, timeframe, open: close - 2, high: close + 1, low: close - 3, close, volume: 1000 }); t += 900_000; }
    return bars;
  }
  function fakeHistoricalDataProvider(bars: readonly OHLCVBar[]): HistoricalDataProvider {
    return { id: "fake", async getBars() { return { bars, rejected: [], source: "fake" }; } };
  }

  let freshRun: Awaited<ReturnType<typeof algoTestService.compileAndRunAiStrategy>> | undefined;
  await test("a real AI-compiled run's response carries real, non-fabricated analytics consistent with its own trades", async () => {
    const bars = fakeBars(25, "M15");
    const run = await algoTestService.compileAndRunAiStrategy(
      user.id,
      { intent: "EMA 9 crosses above EMA 21 on gold", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
      { provider: fakeProvider(compileResponse(9, 21, "M15")), historicalDataProvider: fakeHistoricalDataProvider(bars) },
    );
    freshRun = run;
    assert.equal(run.status, "completed", run.errorMessage);
    assert.ok(run.analytics, "a completed run must carry analytics");
    assert.ok(run.trades && run.trades.length > 0);
    // Cross-check: analytics' own side breakdown must sum to the SAME
    // trade count the top-level `trades` array carries - proof this
    // isn't a second, independently-fabricated data source.
    const totalFromAnalytics = run.analytics!.sideBreakdown.buy.tradeCount + run.analytics!.sideBreakdown.sell.tradeCount;
    assert.equal(totalFromAnalytics, run.trades!.length);
    assert.equal(run.analytics!.pnlDistribution.winCount + run.analytics!.pnlDistribution.lossCount <= run.trades!.length, true);
  });

  await test("reopening the SAME run recomputes analytics from persisted trades/equity/metrics - unlike lifecycle/compiledStrategy/strategyHash, which stay absent on reopen (the P4.3-established gap)", async () => {
    const reopened = await algoTestService.getAlgoTestRun(user.id, freshRun!.testId);
    assert.ok(reopened);
    assert.ok(reopened!.analytics, "analytics must survive a reopen - all its inputs (trades/equityCurve/metrics) are already persisted columns");
    assert.deepEqual(reopened!.analytics, freshRun!.analytics, "recomputing from the same persisted inputs must be deterministic - byte-identical to the original response");
    assert.equal(reopened!.lifecycle, undefined, "lifecycle is still genuinely NOT reconstructed on reopen (P4.3's own disclosed gap) - P4.4 must not have silently changed that");
    assert.equal(reopened!.compiledStrategy, undefined);
  });

  await test("Phase C proof: a 60-day range is REJECTED for a fast timeframe's flat old cap but ACCEPTED once the AI compiles to a slower timeframe (H1, real cap 168 days) - the exact behavior change this phase makes", async () => {
    const bars = fakeBars(25, "H1");
    const run = await algoTestService.compileAndRunAiStrategy(
      user.id,
      { intent: "EMA 9 crosses above EMA 21 on gold, hourly", startTime: "2026-01-01T00:00:00Z", endTime: "2026-03-02T00:00:00Z" /* 60 days */ },
      { provider: fakeProvider(compileResponse(9, 21, "H1")), historicalDataProvider: fakeHistoricalDataProvider(bars) },
    );
    assert.equal(run.status, "completed", run.errorMessage);
    assert.equal(run.timeframe, "H1");
  });

  await test("Phase C proof, the rejection side: the SAME 60-day range is genuinely rejected once compiled to a fast timeframe (M15, real cap 42 days) - AFTER compilation, with the real compiled strategy still attached", async () => {
    const bars = fakeBars(25, "M15");
    const run = await algoTestService.compileAndRunAiStrategy(
      user.id,
      { intent: "EMA 9 crosses above EMA 21 on gold, 15 minute", startTime: "2026-01-01T00:00:00Z", endTime: "2026-03-02T00:00:00Z" /* 60 days */ },
      { provider: fakeProvider(compileResponse(9, 21, "M15")), historicalDataProvider: fakeHistoricalDataProvider(bars) },
    );
    assert.equal(run.status, "failed");
    assert.equal(run.errorCode, "RANGE_TOO_LARGE");
    assert.ok(run.errorMessage?.includes("M15"), "the real, resolved timeframe must be named in the error, not a generic message");
    assert.ok(run.compiledStrategy, "compilation genuinely succeeded before the range check ran - the compiled strategy must still be shown, proving this is a DATA_VALID-style failure, not a fabricated EXECUTION_VALID one");
    assert.equal(run.lifecycle?.reachedStage, "EXECUTION_VALID", "the lifecycle must show real compilation progress, not stop at IMPORTED as if compilation never ran");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
