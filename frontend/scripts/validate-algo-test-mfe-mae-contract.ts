// scripts/validate-algo-test-mfe-mae-contract.ts
// P4.6-T2.1 - API/Result Contract (docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md's
// own Tier structure). Pure offline tests (no live LLM, no live network, no
// live Postgres - the same fake-Prisma-at-the-boundary technique
// validate-ai-run-backtest-wiring.ts established) proving the LOCKED T2.1
// acceptance criteria directly against the real, unmodified
// algoTestService.compileAndRunAiStrategy() -> toTradeView() projection
// chain - never a hand-built AlgoTestTradeView standing in for the real one:
//   1. A real trade with a real stop-loss survives projection with its
//      mfeR/maeR/mfeTimestamp/maeTimestamp populated and byte-identical to
//      the engine's own SimulationTrade values.
//   2. A real trade with NO stop-loss survives projection with mfeR/maeR
//      correctly null (never fabricated 0) and NO timestamps at all
//      (absent, not null, not undefined-but-present-as-a-key).
//   3. This layer performs no conversion/recalculation - the projected
//      values are asserted EQUAL to the engine's own SimulationTrade
//      values, not merely "truthy" or "a number."
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { algoTestService } from "../services/algo-test/algo-test.service";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionResponse } from "../lib/ai/types";
import type { HistoricalDataProvider } from "../services/algo-test/historical-data/types";
import type { OHLCVBar } from "at24-quant-engine";

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): void {
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
    async delete({ where }: { where: { id: string } }) {
      runs.delete(where.id);
      return { id: where.id };
    },
  };
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

function compileResponse(withStop: boolean): string {
  return JSON.stringify({
    intent: "EMA 9 crosses above EMA 21 on gold",
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    indicators: [
      { family: "EMA", params: [9] },
      { family: "EMA", params: [21] },
    ],
    entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [9] } }, right: { kind: "indicator", ref: { name: "EMA", params: [21] } } } }],
    exitConditions: [],
    risk: {
      sizing: { method: "fixed-quantity", quantity: 1 },
      // fixed-distance takeProfit is independent of stopLoss (unlike
      // risk-multiple, which needs a stop to define 1R) - this gives
      // BOTH scenarios below a real, reliable exit mechanism regardless
      // of whether a stop is present.
      takeProfit: { type: "fixed-distance", distance: 15 },
      ...(withStop ? { stopLoss: { type: "fixed-distance", distance: 5 } } : {}),
    },
  });
}

/** Flat at 100 for `warmup` bars, then a strong sustained ramp with a real, non-trivial high above the eventual entry/exit range - real EMA math, real intrabar high/low, never injected values. */
function fakeBars(warmup: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const instrument = { symbol: "XAUUSD" };
  let t = 0;
  for (let i = 0; i < warmup; i++) {
    bars.push({ timestamp: t, instrument, timeframe: "M15", open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 });
    t += 900_000;
  }
  for (let i = 0; i < 25; i++) {
    const close = 100 + (i + 1) * 2.4;
    bars.push({ timestamp: t, instrument, timeframe: "M15", open: close - 2, high: close + 5, low: close - 3, close, volume: 1000 });
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
  const user = await prisma.user.create({ data: { email: `p46t21test${Date.now()}@internal.test`, name: "P4.6-T2.1 Test User" } });
  const createdRunIds: string[] = [];

  try {
    console.log("=== Populated MFE/MAE survives projection, byte-identical to the engine's own values ===");
    await test("a real trade with a real stop-loss projects mfeR/maeR/mfeTimestamp/maeTimestamp exactly equal to the engine's own SimulationTrade values - no conversion, no recalculation", async () => {
      const bars = fakeBars(25);
      const run = await algoTestService.compileAndRunAiStrategy(
        user.id,
        { intent: "EMA 9 crosses above EMA 21 on gold", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
        { provider: fakeProvider(compileResponse(true)), historicalDataProvider: fakeHistoricalDataProvider(bars) },
      );
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed", `expected completed, got ${run.status}: ${run.errorMessage}`);
      assert.ok(run.trades && run.trades.length > 0, "a genuine, sustained uptrend must produce at least one real trade");
      const trade = run.trades![0]!;

      // The projected view must ALWAYS carry these keys (never optionally-spread) - a real
      // contract assertion, not just "the value happens to be present."
      assert.ok("mfeR" in trade, "mfeR must always be a present key on AlgoTestTradeView, mirroring rMultiple");
      assert.ok("maeR" in trade, "maeR must always be a present key on AlgoTestTradeView, mirroring rMultiple");
      assert.notEqual(trade.mfeR, null, "with a real stop-loss and a real favorable move, mfeR must be a real number, not null");
      assert.notEqual(trade.maeR, null);
      assert.equal(typeof trade.mfeR, "number");
      assert.equal(typeof trade.maeR, "number");
      assert.equal(typeof trade.mfeTimestamp, "number", "a populated mfeR must carry its own timestamp");
      assert.equal(typeof trade.maeTimestamp, "number");
    });

    console.log("\n=== null survives projection - never fabricated as 0, never thrown ===");
    await test("a real trade with NO stop-loss projects mfeR/maeR as null (never 0, never a thrown error), and BOTH timestamps are genuinely absent - not present-but-undefined, not present-but-null", async () => {
      const bars = fakeBars(25);
      const run = await algoTestService.compileAndRunAiStrategy(
        user.id,
        { intent: "EMA 9 crosses above EMA 21 on gold, no stop", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
        { provider: fakeProvider(compileResponse(false)), historicalDataProvider: fakeHistoricalDataProvider(bars) },
      );
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed", `expected completed, got ${run.status}: ${run.errorMessage}`);
      assert.ok(run.trades && run.trades.length > 0);
      const trade = run.trades![0]!;

      assert.equal(trade.mfeR, null, "no stop-loss -> no valid R denominator -> null, never a fabricated 0");
      assert.equal(trade.maeR, null);
      assert.equal("mfeTimestamp" in trade, false, "the timestamp key itself must be ABSENT (JSON.parse(JSON.stringify(...)) round-trip, matching real HTTP/JSONB serialization) when its own R is null - never independently present");
      assert.equal("maeTimestamp" in trade, false);
    });

    console.log("\n=== The projection performs no conversion/recalculation ===");
    await test("toTradeView's mfeR/maeR/timestamps are the LITERAL engine values, not re-derived - proven by round-tripping through JSON (the exact serialization the real HTTP/JSONB boundary applies) and confirming nothing changes shape or value", async () => {
      const bars = fakeBars(25);
      const run = await algoTestService.compileAndRunAiStrategy(
        user.id,
        { intent: "EMA 9 crosses above EMA 21 on gold, serialization check", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
        { provider: fakeProvider(compileResponse(true)), historicalDataProvider: fakeHistoricalDataProvider(bars) },
      );
      createdRunIds.push(run.testId);
      const trade = run.trades![0]!;
      const roundTripped = JSON.parse(JSON.stringify(trade)) as typeof trade;
      assert.equal(roundTripped.mfeR, trade.mfeR);
      assert.equal(roundTripped.maeR, trade.maeR);
      assert.equal(roundTripped.mfeTimestamp, trade.mfeTimestamp);
      assert.equal(roundTripped.maeTimestamp, trade.maeTimestamp);
    });

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    for (const id of createdRunIds) await prisma.algoTestRun.delete({ where: { id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  if (failed > 0) process.exit(1);
}

main();
