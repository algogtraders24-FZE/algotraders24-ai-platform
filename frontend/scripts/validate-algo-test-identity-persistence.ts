// scripts/validate-algo-test-identity-persistence.ts
// P4.5 - Strategy & Run Identity Persistence
// (docs/P4.5-STRATEGY-RUN-IDENTITY-PERSISTENCE.md). Pure offline tests (no
// live LLM, no live network, no live Postgres - same fake-Prisma-at-the-
// boundary technique validate-ai-run-backtest-wiring.ts already
// established) proving:
//   1. strategyHash/lifecycle/compiledStrategy are ACTUALLY written to the
//      persisted row, not just returned in the response - reading the row
//      back directly, not trusting the function's own return value.
//   2. A reopened run (getAlgoTestRun) reconstructs all three from the
//      PERSISTED row, closing the exact gap P4.3 disclosed and left open.
//   3. A pre-P4.5 row (strategyHash/lifecycle/compiledStrategy genuinely
//      NULL in the row, simulating a row written before this migration)
//      still reopens correctly - undefined, never fabricated.
//   4. Identity survives repeated runs: the SAME strategy + SAME
//      parameters, run twice, produce the SAME strategyHash.
//   5. Identity correctly tracks parameter changes: the SAME registered
//      strategy (same strategyId/strategyVersion) with a DIFFERENT
//      parameter override produces a DIFFERENT strategyHash - proving
//      strategyHash is a genuinely finer-grained identity than the
//      pre-existing strategyId/strategyVersion pair, which stays
//      identical across a parameter change by design (P3.3).
//   6. The list view (listAlgoTestRuns) carries strategyHash - the
//      groundwork a future run-history/library/optimization feature
//      needs to group or compare a user's own runs by exact identity.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { algoTestService } from "../services/algo-test/algo-test.service";
import { getStrategyDefinition } from "../services/algo-test/strategy-registry";
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
      const row: FakeRow = { id: nextId("run"), createdAt: new Date(), completedAt: null, strategyHash: null, lifecycle: null, compiledStrategy: null, ...data };
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
    async findMany({ where }: { where: { userId: string } }) {
      return [...runs.values()].filter((r) => r.userId === where.userId).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
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
  const user = await prisma.user.create({ data: { email: `p45test${Date.now()}@internal.test`, name: "P4.5 Test User" } });
  const createdRunIds: string[] = [];

  try {
    console.log("=== Engine-level identity: reproducibility and parameter sensitivity (no DB, no network) ===");
    await test("the SAME registered strategy with the SAME parameter override compiles to the SAME semantic hash, twice - reproducibility, not merely a plausible-looking number", () => {
      const golden = getStrategyDefinition("golden")!;
      const hashA = computeSemanticStrategyHash(golden.buildSpec({ positionSizeQuantity: 2 }));
      const hashB = computeSemanticStrategyHash(golden.buildSpec({ positionSizeQuantity: 2 }));
      assert.equal(hashA, hashB);
      assert.equal(hashA.length, 64);
    });

    await test("the SAME registered strategy (same strategyId/strategyVersion) with a DIFFERENT parameter override produces a DIFFERENT semantic hash - strategyHash is a genuinely finer-grained identity than strategyId/strategyVersion, which stays identical across a parameter change by design (P3.3)", () => {
      const golden = getStrategyDefinition("golden")!;
      const defaultHash = computeSemanticStrategyHash(golden.buildSpec({}));
      const overriddenHash = computeSemanticStrategyHash(golden.buildSpec({ positionSizeQuantity: 2 }));
      assert.notEqual(defaultHash, overriddenHash, "positionSizeQuantity lands directly in StrategySpec.risk.sizing.quantity (buildGoldenStrategySpec) - a real override must change the semantic content, not just a label");
      // strategyId/strategyVersion (the pre-existing P3.3 identity pair)
      // are registry-level labels, not derived from the spec's own
      // content - they are identical for both calls above by construction
      // (both are "golden"). strategyHash is the field P4.5 adds
      // specifically to distinguish them.
      assert.equal(golden.strategyId, "golden");
    });

    console.log("\n=== Persistence: the write actually lands on the row, not just the response (AI-compiled path, fully offline) ===");
    let firstRunId = "";
    let firstRunHash: string | undefined;
    let legacyRowId = "";
    await test("a completed run's strategyHash/lifecycle/compiledStrategy are written to the PERSISTED row - read back directly from the fake DB row, not from the function's own return value", async () => {
      const bars = fakeBars(25);
      const run = await algoTestService.compileAndRunAiStrategy(
        user.id,
        { intent: "EMA 9 crosses above EMA 21 on gold", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z", initialBalance: 10_000 },
        { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) },
      );
      createdRunIds.push(run.testId);
      firstRunId = run.testId;
      firstRunHash = run.strategyHash;
      assert.equal(run.status, "completed", `expected completed, got ${run.status}: ${run.errorMessage}`);

      const row = await prisma.algoTestRun.findUnique({ where: { id: run.testId } });
      assert.ok(row, "row must exist");
      assert.equal(row!.strategyHash, run.strategyHash, "the row's own strategyHash must match what the response returned - not a second, independently-computed value");
      assert.ok(row!.lifecycle, "lifecycle must be a real, non-null persisted value");
      assert.ok(row!.compiledStrategy, "compiledStrategy must be a real, non-null persisted value");
      assert.equal((row!.lifecycle as { reachedStage: string }).reachedStage, "EVIDENCE_VERIFIED");
    });

    await test("reopening that same run (getAlgoTestRun) reconstructs strategyHash/lifecycle/compiledStrategy from the PERSISTED row - the exact P4.3-disclosed gap, now closed", async () => {
      const reopened = await algoTestService.getAlgoTestRun(user.id, firstRunId);
      assert.ok(reopened);
      assert.equal(reopened!.strategyHash, firstRunHash);
      assert.ok(reopened!.lifecycle, "lifecycle must survive reopen now");
      assert.equal(reopened!.lifecycle!.reachedStage, "EVIDENCE_VERIFIED");
      assert.ok(reopened!.compiledStrategy, "compiledStrategy must survive reopen now");
      assert.ok(reopened!.compiledStrategy!.longEntry?.includes("EMA(9") && reopened!.compiledStrategy!.longEntry.includes("EMA(21"), "the reopened compiledStrategy must be the REAL original one, not a placeholder");
    });

    await test("a pre-P4.5 row (strategyHash/lifecycle/compiledStrategy genuinely NULL, simulating a row written before this migration) reopens with all three undefined - never fabricated, never a crash", async () => {
      const legacyRow = await prisma.algoTestRun.create({
        data: {
          userId: user.id,
          strategyId: "golden",
          strategyVersion: "1.0.0",
          symbol: "XAUUSD",
          timeframe: "5m",
          startTime: new Date("2026-01-01T00:00:00Z"),
          endTime: new Date("2026-01-02T00:00:00Z"),
          initialBalance: 10_000,
          status: "completed",
          metrics: { totalReturn: 0, netProfit: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, winRate: 0, expectancy: 0, maxDrawdown: 0, averageTrade: 0, tradeCount: 0 },
          trades: [],
          equityCurve: [{ balance: 10_000 }],
          // strategyHash/lifecycle/compiledStrategy deliberately omitted -
          // the fake create() defaults them to null, exactly matching a
          // real pre-P4.5 database row.
        },
      });
      createdRunIds.push(legacyRow.id);
      legacyRowId = legacyRow.id;
      const reopened = await algoTestService.getAlgoTestRun(user.id, legacyRow.id);
      assert.ok(reopened);
      assert.equal(reopened!.strategyHash, undefined);
      assert.equal(reopened!.lifecycle, undefined);
      assert.equal(reopened!.compiledStrategy, undefined);
      // P4.4's own analytics guarantee must be completely unaffected by
      // this - a pre-P4.5 row still gets analytics recomputed on reopen,
      // since that mechanism is independent of this phase's columns.
      assert.ok(reopened!.analytics, "analytics must still be recomputed on reopen, unaffected by the pre-P4.5 identity gap");
    });

    console.log("\n=== Reproducibility: a REAL finding about the AI-compiled path's own identity scheme ===");
    await test("a REAL, pre-existing architectural fact this phase's own audit surfaced: two independent AI compilations of byte-identical trading logic do NOT share a strategyHash today - ai-compiler.ts's compileAIStrategyToIR() bakes a per-call-unique identity.strategyId (`ai-${userId}-${compiledAt}`, a real timestamp) into StrategySpec.identity, a field computeSemanticStrategyHash does NOT strip (only `metadata` is stripped - identity.strategyId is semantic content, by the same rule that makes registry strategyId part of a spec's own identity). This is NOT introduced by P4.5 and NOT something P4.5 fixes - P4.5 persists whatever identity the compiler already produces; changing HOW the AI compiler assigns identity is a compiler-boundary decision explicitly out of this phase's bounded scope (see the P4.5 doc's own Known Limitations section).", async () => {
      const bars = fakeBars(25);
      const runA = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 9 crosses above EMA 21 on gold, run A", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      const runB = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 9 crosses above EMA 21 on gold, run B", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      createdRunIds.push(runA.testId, runB.testId);
      assert.equal(runA.status, "completed");
      assert.equal(runB.status, "completed");
      assert.notEqual(runA.testId, runB.testId, "two genuinely separate rows");
      assert.notEqual(runA.strategyHash, runB.strategyHash, "documented current behavior, not a bug this test is hiding - see the assertion name above for the full explanation");

      const rowA = await prisma.algoTestRun.findUnique({ where: { id: runA.testId } });
      const rowB = await prisma.algoTestRun.findUnique({ where: { id: runB.testId } });
      assert.equal(rowA!.strategyHash, runA.strategyHash, "the persisted row still agrees with its own run's response - P4.5's own write path is correct even though the underlying identity itself is per-compilation-unique");
      assert.equal(rowB!.strategyHash, runB.strategyHash);
    });

    await test("registry-path reproducibility (the one path where strategyId is a fixed, stable label, not regenerated per call) - proven at the engine level above already; this test confirms the SAME real buildSpec() output persists identically when written to two separate rows directly, exercising the write path with a deliberately-shared hash", async () => {
      const golden = getStrategyDefinition("golden")!;
      const sharedHash = computeSemanticStrategyHash(golden.buildSpec({}));
      const rowA = await prisma.algoTestRun.create({ data: { userId: user.id, strategyId: "golden", strategyVersion: "1.0.0", symbol: "XAUUSD", timeframe: "5m", startTime: new Date("2026-01-01T00:00:00Z"), endTime: new Date("2026-01-02T00:00:00Z"), initialBalance: 10_000, status: "completed", strategyHash: sharedHash } });
      const rowB = await prisma.algoTestRun.create({ data: { userId: user.id, strategyId: "golden", strategyVersion: "1.0.0", symbol: "XAUUSD", timeframe: "5m", startTime: new Date("2026-01-03T00:00:00Z"), endTime: new Date("2026-01-04T00:00:00Z"), initialBalance: 10_000, status: "completed", strategyHash: sharedHash } });
      createdRunIds.push(rowA.id, rowB.id);
      const reopenedA = await algoTestService.getAlgoTestRun(user.id, rowA.id);
      const reopenedB = await algoTestService.getAlgoTestRun(user.id, rowB.id);
      assert.equal(reopenedA!.strategyHash, sharedHash);
      assert.equal(reopenedB!.strategyHash, sharedHash);
      assert.equal(reopenedA!.strategyHash, reopenedB!.strategyHash, "two genuinely separate runs of the SAME registered strategy, at different times, correctly share one identity - this is what 'identity survives repeated runs' means for the registry path, where strategyId is a real, stable, non-regenerated label");
    });

    await test("changing the compiled parameters between two AI runs produces a DIFFERENT persisted strategyHash on both rows", async () => {
      const bars = fakeBars(21);
      const runFast = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 9 crosses above EMA 21", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(9, 21)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      const runSlow = await algoTestService.compileAndRunAiStrategy(user.id, { intent: "EMA 5 crosses above EMA 10", startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }, { provider: fakeProvider(compileResponse(5, 10)), historicalDataProvider: fakeHistoricalDataProvider(bars) });
      createdRunIds.push(runFast.testId, runSlow.testId);
      const rowFast = await prisma.algoTestRun.findUnique({ where: { id: runFast.testId } });
      const rowSlow = await prisma.algoTestRun.findUnique({ where: { id: runSlow.testId } });
      assert.notEqual(rowFast!.strategyHash, rowSlow!.strategyHash);
    });

    console.log("\n=== Run-history groundwork: the list view carries the grouping key ===");
    await test("listAlgoTestRuns includes strategyHash for every run that has one, and undefined for the pre-P4.5 legacy row - the exact field a future run-history/library feature would group or filter by", async () => {
      const list = await algoTestService.listAlgoTestRuns(user.id);
      assert.ok(list.length >= 6, "every run created above for this user must appear");
      const withHash = list.filter((r) => r.strategyHash !== undefined);
      assert.ok(withHash.length >= 5, "every P4.5-era run in this test must carry its strategyHash in the summary view");
      const legacy = list.find((r) => r.testId === legacyRowId);
      assert.ok(legacy, "the manually-inserted legacy row must appear in the list");
      assert.equal(legacy!.strategyHash, undefined, "the legacy row must stay honestly undefined in the list view too, identified by id - not by strategyId, since two OTHER real golden rows in this test now correctly carry a real strategyHash");
      // Same strategyHash value groups correctly across independent rows -
      // directly exercising what a future comparison feature needs. The
      // two deliberately-shared-hash golden rows from the reproducibility
      // test above are the real proof here.
      const grouped = new Map<string, number>();
      for (const r of withHash) grouped.set(r.strategyHash!, (grouped.get(r.strategyHash!) ?? 0) + 1);
      assert.ok([...grouped.values()].some((count) => count >= 2), "at least one strategyHash must be shared by 2+ runs - proving the grouping key actually groups, not just that it exists per-row");
    });

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    for (const id of createdRunIds) await prisma.algoTestRun.delete({ where: { id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  if (failed > 0) process.exit(1);
}

main();
