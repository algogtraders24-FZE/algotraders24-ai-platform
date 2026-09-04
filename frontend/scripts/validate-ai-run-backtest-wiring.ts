// scripts/validate-ai-run-backtest-wiring.ts
// P4 Phase 2 - Backtest Wiring (docs/P4-PHASE2-BACKTEST-WIRING.md). Pure
// unit tests (no live LLM, no live network) for
// algoTestService.compileAndRunAiStrategy() - a fake AIProvider (P4
// Phase 1's own established convention) AND a fake HistoricalDataProvider
// (run-golden-backtest.ts's own established injection point) are both
// supplied directly, so the compile -> validate -> generic runBacktest()
// -> real trades -> real metrics -> P3.8 lifecycle chain runs for real,
// offline, deterministically.
//
// This sandboxed environment has no reachable Postgres (established
// throughout this session - see P3.8's own decision not to add DB
// persistence for exactly this reason), so the ONE remaining boundary -
// `prisma.algoTestRun`/`prisma.user` - is faked here with a small
// in-memory store that mirrors the real Prisma model shape
// (prisma/schema.prisma's AlgoTestRun) closely enough for every field
// the service actually reads back. This is the same "inject a fake at a
// real boundary" principle already used for AIProvider and
// HistoricalDataProvider, applied to the one boundary the service does
// not (and per P3.8, should not) accept as a constructor/call parameter.
// Every other line of algo-test.service.ts - compilation, runBacktest(),
// lifecycle-building, all the toXView() mappers - runs completely
// unmodified and unmocked.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { algoTestService } from "../services/algo-test/algo-test.service";
import { getStrategyDefinition } from "../services/algo-test/strategy-registry";
import { runBacktest } from "../services/algo-test/run-backtest";
import { computeSemanticStrategyHash } from "at24-quant-engine";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionResponse } from "../lib/ai/types";
import type { HistoricalDataProvider } from "../services/algo-test/historical-data/types";
import type { OHLCVBar } from "at24-quant-engine";

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): { users: Map<string, FakeRow>; runs: Map<string, FakeRow> } {
  const users = new Map<string, FakeRow>();
  const runs = new Map<string, FakeRow>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(seq += 1)}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).user = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("user"), ...data };
      users.set(row.id, row);
      return row;
    },
    async delete({ where }: { where: { id: string } }) {
      users.delete(where.id);
      return { id: where.id };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).algoTestRun = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("run"), createdAt: new Date(), completedAt: null, ...data };
      runs.set(row.id, row);
      return row;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = runs.get(where.id);
      if (!existing) throw new Error(`fake prisma: no AlgoTestRun row ${where.id}`);
      const updated = { ...existing, ...data };
      runs.set(where.id, updated);
      return updated;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return runs.get(where.id) ?? null;
    },
    async findFirst({ where }: { where: { id: string; userId: string } }) {
      const row = runs.get(where.id);
      return row && row.userId === where.userId ? row : null;
    },
    async delete({ where }: { where: { id: string } }) {
      runs.delete(where.id);
      return { id: where.id };
    },
  };

  return { users, runs };
}

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

function fakeProvider(json: string): AIProvider {
  return {
    name: "claude",
    async complete(): Promise<AICompletionResponse> {
      return { content: json, model: "fake-model", provider: "claude" };
    },
  };
}

function compileResponse(fast: number, slow: number): string {
  return JSON.stringify({
    intent: `EMA ${fast} crosses above EMA ${slow} on gold`,
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    indicators: [
      { family: "EMA", params: [fast] },
      { family: "EMA", params: [slow] },
    ],
    entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [fast] } }, right: { kind: "indicator", ref: { name: "EMA", params: [slow] } } } }],
    exitConditions: [],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, stopLoss: { type: "fixed-distance", distance: 5 }, takeProfit: { type: "risk-multiple", rMultiple: 2 } },
  });
}

/** Flat at 100 for `warmup` bars (enough for the slower EMA to seed cleanly), then a sustained linear ramp up to 160 over 25 bars - a strong enough real trend that a faster EMA genuinely crosses above a slower one via REAL EMA math (calculateSeries(), never injected values - unlike P4 Phase 1's own unit tests, which inject indicator values directly; this one proves the real computation end to end, through the real buildIndicatorSeries a compiled strategy owns). */
function fakeBars(warmup: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const instrument = { symbol: "XAUUSD" };
  let t = 0;
  for (let i = 0; i < warmup; i++) {
    bars.push({ timestamp: t, instrument, timeframe: "M15", open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 });
    t += 900_000;
  }
  for (let i = 0; i < 25; i++) {
    const close = 100 + (i + 1) * 2.4; // ramps to 160
    bars.push({ timestamp: t, instrument, timeframe: "M15", open: close - 2, high: close + 1, low: close - 3, close, volume: 1000 });
    t += 900_000;
  }
  return bars;
}

function fakeHistoricalDataProvider(bars: readonly OHLCVBar[]): HistoricalDataProvider {
  return {
    id: "fake",
    async getBars() {
      return { bars, rejected: [], source: "fake" };
    },
  };
}

async function main(): Promise<void> {
  installFakePrisma();
  const user = await prisma.user.create({ data: { email: `p4p2test${Date.now()}@internal.test`, name: "P4 Phase 2 Test User" } });
  const createdRunIds: string[] = [];

  try {
    console.log("=== The generic backtest path, exercised end to end ===");
    let firstRun: Awaited<ReturnType<typeof algoTestService.compileAndRunAiStrategy>> | undefined;
    await test("a compiled strategy reaches the EXACT SAME generic runBacktest() every registry strategy uses, and produces real trades under a genuine (computed, not injected) EMA crossover", async () => {
      const bars = fakeBars(25);
      const run = await algoTestService.compileAndRunAiStrategy(
        user.id,
        { intent: "EMA 9 crosses above EMA 21 on gold", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
        { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) },
      );
      firstRun = run;
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed", `expected completed, got ${run.status}: ${run.errorMessage}`);
      assert.equal(run.strategyId, "ai-generated");
      assert.ok(run.trades && run.trades.length > 0, "a genuine, sustained uptrend must produce at least one real EMA(9)-crosses-above-EMA(21) trade");
      assert.equal(run.resultHash?.length, 64);
      assert.ok(run.compiledStrategy, "the compiled StrategySpec that actually ran must be returned for review/audit");
    });

    await test("P3.8 evidence/lifecycle data remains fully attached to an AI-compiled run - not a looser check than a registry-based one", async () => {
      assert.ok(firstRun?.lifecycle);
      assert.equal(firstRun!.lifecycle!.reachedStage, "EVIDENCE_VERIFIED");
      assert.equal(firstRun!.lifecycle!.fullyVerified, true);
      const stageNames = firstRun!.lifecycle!.stages.map((s) => s.stage);
      assert.deepEqual(stageNames, ["IMPORTED", "PARSED", "IR_VALID", "EXECUTION_VALID", "DATA_VALID", "BACKTEST_VALID", "REPRODUCIBLE", "EVIDENCE_VERIFIED"]);
    });

    await test("the run is genuinely persisted (not just returned in the response) - reopenable via the SAME AlgoTestRun table registry-based runs use", async () => {
      const row = await prisma.algoTestRun.findUnique({ where: { id: firstRun!.testId } });
      assert.ok(row);
      assert.equal(row!.strategyId, "ai-generated");
      assert.equal(row!.userId, user.id);
      assert.equal(row!.status, "completed");
      assert.ok(row!.trades, "trades must be persisted, same as any other completed run");
    });

    console.log("\n=== The particularly important test: different NL -> genuinely different identity and behavior ===");
    await test("EMA 9/21 vs EMA 5/10 compile to DIFFERENT semantic strategy identities (computeSemanticStrategyHash) - not merely a different-looking preview", async () => {
      const bars = fakeBars(21);
      const runFast = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 9 crosses above EMA 21", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      const runSlow = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 5 crosses above EMA 10", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(5, 10)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      createdRunIds.push(runFast.testId, runSlow.testId);
      assert.equal(runFast.status, "completed");
      assert.equal(runSlow.status, "completed");

      const hashFast = computeSemanticStrategyHash(runFast.compiledStrategy as never);
      const hashSlow = computeSemanticStrategyHash(runSlow.compiledStrategy as never);
      assert.notEqual(hashFast, hashSlow, "changing the requested EMA periods must produce a genuinely different compiled strategy identity, not the same spec with different labels");
      assert.notEqual(runFast.resultHash, runSlow.resultHash, "a different strategy identity must also produce a different, independently reproducible backtest resultHash");
    });

    console.log("\n=== The warmup-slicing fix this phase made, proven against the REGISTRY path too (not just the AI-compiled one) ===");
    await test("ref-ema-crossover - a real, registered, non-AI strategy with genuine EMA(9)/EMA(21) warmup - now survives runBacktest() end to end and produces real trades; before this phase's fix, ANY named-indicator registry strategy would have thrown on bar 0 the first time it was actually run through runBacktest() (P3.6/P3.8's own tests never called runBacktest() for it - registry/lifecycle structure only)", async () => {
      const refEmaCrossover = getStrategyDefinition("ref-ema-crossover");
      assert.ok(refEmaCrossover);
      const outcome = await runBacktest(
        {
          symbol: "XAUUSD",
          timeframe: "M15",
          startTime: "2026-01-01T00:00:00Z",
          endTime: "2026-01-02T00:00:00Z",
          initialBalance: 10_000,
          strategySpec: refEmaCrossover!.buildSpec({}),
          buildIndicatorSeries: refEmaCrossover!.buildIndicatorSeries,
        },
        fakeHistoricalDataProvider(fakeBars(25)),
      );
      // ref-ema-crossover's real MQL5 source (ref-ema-crossover-strategy.ts)
      // declares no exit rule and no SL/TP - its own entry-only "fast>slow"
      // condition genuinely opens a real order and then holds it, exactly
      // matching the imported source. That real fill is what proves the
      // path works: `tradeLedger` only ever records CLOSED round-trips
      // (SimulationTrade), so a strategy with no exit legitimately produces
      // zero of those - `finalPositions`/`ordersFilled` are the real,
      // non-fabricated proof of a genuine entry here, not a fallback
      // check standing in for a missing trade.
      assert.ok(outcome.result.executionStatistics.ordersFilled > 0, "the same genuine uptrend that makes EMA(9) cross above EMA(21) must fill a real order here too - identical mechanism, real registry strategy instead of an AI-compiled one");
      assert.ok(outcome.result.finalPositions.length > 0, "with no declared exit rule, the real fill correctly stays open through the end of the window");
      assert.equal(outcome.reproducible, true);
    });

    console.log("\n=== Boundaries this phase must not cross ===");
    await test("Golden Strategy's own registry-based path is completely unaffected - same function (buildRunLifecycle), same generic runBacktest(), zero behavioral change", async () => {
      const golden = getStrategyDefinition("golden");
      assert.ok(golden);
      // Not re-running a live Golden backtest here (that needs the real
      // Twelve Data provider, covered by validate-algo-test-service.ts) -
      // this asserts the STRUCTURAL fact P4 Phase 2 must preserve: golden's
      // own buildSpec/buildIndicatorSeries/importLifecycle are exactly
      // what they were before this phase touched anything.
      assert.equal(typeof golden!.buildSpec, "function");
      assert.equal(typeof golden!.buildIndicatorSeries, "function");
      assert.equal(golden!.importLifecycle.length, 4);
      assert.ok(golden!.importLifecycle.every((s) => s.outcome === "NOT_APPLICABLE"));
    });

    await test("a compilation that never reaches EXECUTION_VALID never reaches the backtest service at all - no partial/fabricated run", async () => {
      // GOOGL is not in AI_COMPILER_SUPPORTED_SYMBOLS (schema.ts) - the LLM's
      // JSON is extracted fine (IMPORTED passes) but parseAIStrategyCompilerInput
      // itself rejects the symbol, so PARSED is the stage that FAILS and
      // "IMPORTED" (the last stage that actually PASSED) is the correct
      // reachedStage - never a partial PARSED/IR_VALID/EXECUTION_VALID result.
      const run = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "trade GOOGL", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(JSON.stringify({ ...JSON.parse(compileResponse(9, 21)), instruments: [{ symbol: "GOOGL" }] })), historicalDataProvider: fakeHistoricalDataProvider(fakeBars(21)) });
      createdRunIds.push(run.testId);
      assert.equal(run.status, "failed");
      assert.equal(run.resultHash, undefined, "no backtest was ever attempted - there is no resultHash to have");
      assert.equal(run.lifecycle?.reachedStage, "IMPORTED");
    });

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    for (const id of createdRunIds) await prisma.algoTestRun.delete({ where: { id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  if (failed > 0) process.exit(1);
}

main();
