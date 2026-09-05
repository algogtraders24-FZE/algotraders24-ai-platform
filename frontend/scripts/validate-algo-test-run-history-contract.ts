// scripts/validate-algo-test-run-history-contract.ts
// P4.7-T1 - Run History Contract + Data Wiring (docs/P4.7-RUN-HISTORY.md).
// Pure offline tests (no live LLM, no live network, no live Postgres - the
// same fake-Prisma-at-the-boundary technique established since P4.5)
// proving the LOCKED T1 acceptance criteria directly against the real,
// unmodified `algoTestService.listAlgoTestRuns()` and the new
// `fetchAlgoTestRuns()` client wrapper - never a hand-built fixture
// standing in for the real projection:
//   1. A completed run's `completedAt` survives into the list view.
//   2. A run that never reached a terminal state has `completedAt`
//      genuinely ABSENT (the key itself, not `null`, not `undefined`-
//      but-present) - proven via a JSON round-trip, matching the real
//      HTTP/JSONB serialization boundary.
//   3. The list view still excludes every heavy field (trades,
//      equityCurve, lifecycle, compiledStrategy, analytics, assumptions,
//      candles) - a negative assertion, not just "the light fields are
//      there."
//   4. `take: 50` / `orderBy: createdAt desc` are unchanged - proven by
//      re-reading this phase's own diff-relevant source line, not by
//      behavioral inference (50 real rows would be slow/wasteful to
//      construct here just to prove a constant nobody touched).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).algoTestRun = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("run"), createdAt: new Date(), completedAt: null, strategyHash: null, lifecycle: null, compiledStrategy: null, ...data };
      runs.set(row.id, row);
      return row;
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = runs.get(where.id);
      if (!existing) throw new Error(`no row ${where.id}`);
      const updated = { ...existing, ...data };
      runs.set(where.id, updated);
      return updated;
    },
    async findMany({ where }: { where: { userId: string } }) {
      return [...runs.values()].filter((r) => r.userId === where.userId).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
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
  return { name: "claude", async complete(): Promise<AICompletionResponse> { return { content: json, model: "fake-model", provider: "claude" }; } };
}

function compileResponse(): string {
  return JSON.stringify({
    intent: "EMA 9 crosses above EMA 21 on gold",
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    indicators: [{ family: "EMA", params: [9] }, { family: "EMA", params: [21] }],
    entryConditions: [{ direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [9] } }, right: { kind: "indicator", ref: { name: "EMA", params: [21] } } } }],
    exitConditions: [],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, takeProfit: { type: "fixed-distance", distance: 15 }, stopLoss: { type: "fixed-distance", distance: 5 } },
  });
}

function fakeBars(warmup: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const instrument = { symbol: "XAUUSD" };
  let t = 0;
  for (let i = 0; i < warmup; i++) { bars.push({ timestamp: t, instrument, timeframe: "M15", open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 }); t += 900_000; }
  for (let i = 0; i < 25; i++) { const close = 100 + (i + 1) * 2.4; bars.push({ timestamp: t, instrument, timeframe: "M15", open: close - 2, high: close + 5, low: close - 3, close, volume: 1000 }); t += 900_000; }
  return bars;
}

function fakeHistoricalDataProvider(bars: readonly OHLCVBar[]): HistoricalDataProvider {
  return { id: "fake", async getBars() { return { bars, rejected: [], source: "fake" }; } };
}

async function main(): Promise<void> {
  installFakePrisma();
  const user = await prisma.user.create({ data: { email: `p47t1test${Date.now()}@internal.test`, name: "P4.7-T1 Test User" } });

  await test("a real completed run's completedAt survives into listAlgoTestRuns(), as a real ISO timestamp string", async () => {
    const bars = fakeBars(25);
    const run = await algoTestService.compileAndRunAiStrategy(
      user.id,
      { intent: "EMA 9 crosses above EMA 21 on gold", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
      { provider: fakeProvider(compileResponse()), historicalDataProvider: fakeHistoricalDataProvider(bars) },
    );
    assert.equal(run.status, "completed", `expected completed, got ${run.status}: ${run.errorMessage}`);

    const list = await algoTestService.listAlgoTestRuns(user.id);
    const row = list.find((r) => r.testId === run.testId);
    assert.ok(row, "the run must appear in the list");
    assert.equal(typeof row!.completedAt, "string", "completedAt must be a real string, not null/0/a boolean");
    assert.ok(!Number.isNaN(Date.parse(row!.completedAt!)), "completedAt must be a genuinely parseable ISO timestamp");
  });

  await test("a manually-inserted row with NO completedAt (simulating a pending/never-terminal run) has the completedAt KEY genuinely absent after a JSON round-trip - never null, never a fabricated value", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).algoTestRun.create({
      data: {
        userId: user.id,
        strategyId: "golden",
        strategyVersion: "1.0.0",
        symbol: "XAUUSD",
        timeframe: "5m",
        startTime: new Date("2026-01-01T00:00:00Z"),
        endTime: new Date("2026-01-02T00:00:00Z"),
        initialBalance: 10_000,
        status: "pending",
        // completedAt deliberately omitted - the fake create() defaults it to null, exactly matching a real never-terminal row.
      },
    });
    const list = await algoTestService.listAlgoTestRuns(user.id);
    const pendingRow = list.find((r) => r.status === ("pending" as unknown as typeof r.status));
    assert.ok(pendingRow, "the pending row must appear in the list");
    // Real HTTP/JSONB round-trip - JSON.stringify drops undefined keys entirely, exactly matching what a real API response would do.
    const roundTripped = JSON.parse(JSON.stringify(pendingRow)) as typeof pendingRow;
    assert.equal("completedAt" in roundTripped!, false, "completedAt must be a genuinely ABSENT key after serialization, not present-as-null or present-as-undefined");
  });

  await test("the list view still excludes every heavy field - trades/equityCurve/lifecycle/compiledStrategy/analytics/assumptions/candles - unaffected by this phase", async () => {
    const list = await algoTestService.listAlgoTestRuns(user.id);
    assert.ok(list.length > 0);
    for (const row of list) {
      assert.equal("trades" in row, false);
      assert.equal("equityCurve" in row, false);
      assert.equal("lifecycle" in row, false);
      assert.equal("compiledStrategy" in row, false);
      assert.equal("analytics" in row, false);
      assert.equal("assumptions" in row, false);
      assert.equal("candles" in row, false);
    }
  });

  await test("take: 50 and orderBy: createdAt desc are unchanged (read directly from source, not inferred behaviorally)", () => {
    const source = readFileSync(new URL("../services/algo-test/algo-test.service.ts", import.meta.url), "utf-8");
    assert.ok(source.includes('orderBy: { createdAt: "desc" }, take: 50'), "the exact pre-existing query shape must be unchanged");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
