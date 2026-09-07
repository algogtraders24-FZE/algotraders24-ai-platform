// scripts/validate-algo-test-strategy-persistence.ts
// P4.8-T2.2 (docs/P4.8-T2.2-STRATEGY-PERSISTENCE.md) - pure offline tests
// (no live LLM, no live network, no live Postgres - the same fake-Prisma-
// at-the-boundary technique validate-algo-test-identity-persistence.ts
// already established) proving the Strategy persistence write/read path,
// against the REAL, unmodified algoTestService.compileAndRunAiStrategy()
// and algoTestService.getStrategyArtifact() - never a mock of the
// persistence logic itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
import { algoTestService } from "../services/algo-test/algo-test.service";
import { runSimulation, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency } from "at24-quant-engine";
import type { AIProvider } from "../lib/ai/provider.interface";
import type { AICompletionResponse } from "../lib/ai/types";
import type { HistoricalDataProvider } from "../services/algo-test/historical-data/types";
import type { OHLCVBar } from "at24-quant-engine";

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): { runs: Map<string, FakeRow>; strategies: Map<string, FakeRow> } {
  const runs = new Map<string, FakeRow>();
  const strategies = new Map<string, FakeRow>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(seq += 1)}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).algoTestRun = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("run"), createdAt: new Date(), completedAt: null, strategyHash: null, strategyRefId: null, lifecycle: null, compiledStrategy: null, ...data };
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
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).strategy = {
    async upsert({ where, create, update }: { where: { userId_strategyId: { userId: string; strategyId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) {
      const key = `${where.userId_strategyId.userId}::${where.userId_strategyId.strategyId}`;
      const existing = [...strategies.values()].find((s) => `${s.userId}::${s.strategyId}` === key);
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() };
        strategies.set(existing.id, updated);
        return updated;
      }
      const row: FakeRow = { id: nextId("strat"), createdAt: new Date(), updatedAt: new Date(), ...create };
      strategies.set(row.id, row);
      return row;
    },
    async findUnique({ where }: { where: { userId_strategyId: { userId: string; strategyId: string } } }) {
      const key = `${where.userId_strategyId.userId}::${where.userId_strategyId.strategyId}`;
      return [...strategies.values()].find((s) => `${s.userId}::${s.strategyId}` === key) ?? null;
    },
  };

  return { runs, strategies };
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

function compileResponse(intent: string, fast: number, slow: number): string {
  return JSON.stringify({
    intent,
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

function fakeBars(): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const instrument = { symbol: "XAUUSD" };
  let t = 0;
  for (let i = 0; i < 60; i++) {
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

// M15's own timeframe-aware range cap (P4.4 Phase C) is 42 days per test -
// stay comfortably inside it.
const START = new Date(0).toISOString();
const END = new Date(30 * 86_400_000).toISOString();

async function main(): Promise<void> {
  const { runs, strategies } = installFakePrisma();

  console.log("=== Same logical strategy, same user -> reused Strategy row (never duplicated) ===");
  await test("recompiling byte-identical logic under different phrasing/name, same user, upserts the SAME Strategy row - not two", async () => {
    const provider = fakeProvider(compileResponse("EMA 20 crosses above EMA 50 on gold", 20, 50));
    const providerRephrased = fakeProvider(compileResponse("Enter long XAUUSD on a 20/50 EMA cross", 20, 50));
    const hist = fakeHistoricalDataProvider(fakeBars());
    const r1 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross", startTime: START, endTime: END }, { provider, historicalDataProvider: hist });
    const r2 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "Go long on EMA cross", startTime: START, endTime: END }, { provider: providerRephrased, historicalDataProvider: hist });
    assert.equal(r1.status, "completed");
    assert.equal(r2.status, "completed");
    const row1 = runs.get(r1.testId)!;
    const row2 = runs.get(r2.testId)!;
    assert.ok(row1.strategyRefId, "run 1 must reference a persisted Strategy");
    assert.equal(row1.strategyRefId, row2.strategyRefId, "the SAME logical strategy, same user, must resolve to the SAME Strategy row - the whole point of a stable identity");
    assert.equal(strategies.size, 1, "exactly one Strategy row must exist after two compiles of the identical logic - not two");
  });

  console.log("\n=== Artifact immutability: a later recompile must NEVER overwrite the original frozen artifact ===");
  await test("same user, same strategyId (same executable semantics), a DIFFERENT generated name on the second compile -> the persisted artifact stays the FIRST one, byte-for-byte, never replaced", async () => {
    strategies.clear();
    const hist = fakeHistoricalDataProvider(fakeBars());
    const r1 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross original", startTime: START, endTime: END }, { provider: fakeProvider(compileResponse("EMA 20 crosses above EMA 50 on gold, original phrasing", 20, 50)), historicalDataProvider: hist });
    assert.equal(r1.status, "completed");
    const strategyRow = [...strategies.values()][0]!;
    const artifactAfterFirst = JSON.parse(JSON.stringify(strategyRow.artifact));
    const nameAfterFirst = strategyRow.name;

    // Recompile the SAME logic under a genuinely different restated
    // intent/generated name - strategyId must match (T1), but this must
    // NOT be allowed to replace the already-persisted artifact.
    const r2 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "Enter long on a 20/50 EMA cross for gold instead", startTime: START, endTime: END }, { provider: fakeProvider(compileResponse("Enter long XAUUSD once the 20-period EMA crosses above the 50-period EMA", 20, 50)), historicalDataProvider: hist });
    assert.equal(r2.status, "completed");
    assert.equal(strategies.size, 1, "still exactly one row - the upsert key matched");

    const strategyRowAfterSecond = [...strategies.values()][0]!;
    assert.deepEqual(strategyRowAfterSecond.artifact, artifactAfterFirst, "the persisted artifact must be BYTE-IDENTICAL to what the FIRST compile produced - a later recompile must never silently replace the frozen artifact, even when its own generated name/description differ");
    assert.equal(strategyRowAfterSecond.name, nameAfterFirst, "the row's own display name must also stay the FIRST compile's - name is part of what T2.2 now deliberately freezes alongside the artifact, not re-derived from whichever compile happened most recently");
    const storedSpec = (strategyRowAfterSecond.artifact as { spec: { identity: { name: string } } }).spec;
    assert.equal(storedSpec.identity.name, nameAfterFirst, "the artifact's OWN embedded spec.identity.name must also still be the first compile's name, not the second's - proves this is genuinely the original frozen object, not a reconstructed one that merely happens to match at the row level");
  });

  console.log("\n=== Different users -> different Strategy rows, never shared ownership ===");
  await test("the identical logical strategy compiled by two DIFFERENT users produces two DIFFERENT, isolated Strategy rows", async () => {
    strategies.clear();
    const provider = fakeProvider(compileResponse("EMA 20 crosses above EMA 50 on gold", 20, 50));
    const hist = fakeHistoricalDataProvider(fakeBars());
    const rA = await algoTestService.compileAndRunAiStrategy("user-A", { intent: "EMA cross", startTime: START, endTime: END }, { provider, historicalDataProvider: hist });
    const rB = await algoTestService.compileAndRunAiStrategy("user-B", { intent: "EMA cross", startTime: START, endTime: END }, { provider, historicalDataProvider: hist });
    const rowA = runs.get(rA.testId)!;
    const rowB = runs.get(rB.testId)!;
    assert.notEqual(rowA.strategyRefId, rowB.strategyRefId, "two different users must never share one Strategy row, even for identical logic");
    assert.equal(strategies.size, 2);
  });

  console.log("\n=== Genuinely different semantic strategies -> never collapsed ===");
  await test("two structurally different strategies (different EMA period), same user, produce two different Strategy rows", async () => {
    strategies.clear();
    const hist = fakeHistoricalDataProvider(fakeBars());
    const r1 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross A", startTime: START, endTime: END }, { provider: fakeProvider(compileResponse("EMA A", 20, 50)), historicalDataProvider: hist });
    const r2 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross B", startTime: START, endTime: END }, { provider: fakeProvider(compileResponse("EMA B", 10, 50)), historicalDataProvider: hist });
    const row1 = runs.get(r1.testId)!;
    const row2 = runs.get(r2.testId)!;
    assert.notEqual(row1.strategyRefId, row2.strategyRefId);
    assert.equal(strategies.size, 2);
  });

  console.log("\n=== The payoff: a saved artifact reconstructs and RE-RUNS without ever asking the LLM again ===");
  await test("getStrategyArtifact() returns a spec that genuinely re-runs through runSimulation() directly - no compileNaturalLanguageStrategy, no AIProvider, no LLM call anywhere in this test", async () => {
    strategies.clear();
    const provider = fakeProvider(compileResponse("EMA 20 crosses above EMA 50 on gold", 20, 50));
    const hist = fakeHistoricalDataProvider(fakeBars());
    const r1 = await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross", startTime: START, endTime: END }, { provider, historicalDataProvider: hist });
    assert.equal(r1.status, "completed");

    const strategyRow = [...strategies.values()][0]!;
    const artifact = await algoTestService.getStrategyArtifact("user-1", strategyRow.strategyId as string);
    assert.ok(artifact, "the persisted artifact must be readable back");
    assert.equal(artifact!.spec.entryRules.length, 1);

    // Re-run the SAME artifact directly against fresh bars - proves the
    // spec is genuinely executable on its own, not merely descriptive.
    // The persisted StrategySpec has no buildIndicatorSeries function
    // attached (that closure was never part of what T2.2 persists), so a
    // genuine re-run consumer must supply indicator values itself - a
    // small, fully-defined, hand-forced series (same technique
    // validate-nl-strategy-compiler.ts's own proven happy-path test
    // uses), keyed exactly as the persisted condition tree names them
    // (EMA(20)/EMA(50), read directly off artifact.spec.entryRules, not
    // assumed) - not a real EMA computation, since proving genuine
    // re-runnability only requires that the SPEC executes correctly
    // end to end on a real crossover, not that this test re-derives
    // EMA math the engine itself already owns and tests elsewhere.
    const left = (artifact!.spec.entryRules[0]!.condition as { left: { ref: { name: string; params: readonly number[] } } }).left.ref;
    const right = (artifact!.spec.entryRules[0]!.condition as { right: { ref: { name: string; params: readonly number[] } } }).right.ref;
    const fastKey = `${left.name}(${left.params.join(",")})`;
    const slowKey = `${right.name}(${right.params.join(",")})`;
    const bars: OHLCVBar[] = Array.from({ length: 5 }, (_, i) => ({ timestamp: i * 900_000, instrument: { symbol: "XAUUSD" }, timeframe: "M15" as const, open: 2000, high: 2001, low: 1999, close: 2000, volume: 1000 }));
    const indicatorSeries = new Map<string, readonly (number | boolean | undefined)[]>();
    indicatorSeries.set(fastKey, [100, 100, 105, 106, 107]);
    indicatorSeries.set(slowKey, [100, 100, 100, 100, 100]);
    const outcome = runSimulation(bars as never, {
      strategySpec: artifact!.spec,
      instrument: { symbol: "XAUUSD" },
      timeframe: "M15" as never,
      initialBalance: 10_000,
      datasetId: "p4.8-t2.2-offline-test",
      datasetVersion: "1",
      dataFidelity: "D1",
      spreadModel: ZeroSpread,
      slippageModel: ZeroSlippage,
      feeModel: ZeroFee,
      latencyModel: ZeroLatency,
      indicatorSeries,
    } as never);
    assert.ok(outcome.tradeLedger.length > 0 || outcome.finalPositions.length > 0, "a re-run from the persisted artifact alone must produce real activity, exactly like the original compile did");
  });

  console.log("\n=== Defensive reads: corruption and non-existence are never silently trusted ===");
  await test("getStrategyArtifact() returns null for a strategyId that was never persisted - never fabricated, never throws", async () => {
    const missing = await algoTestService.getStrategyArtifact("user-1", "ai-user-1-doesnotexist");
    assert.equal(missing, null);
  });

  await test("getStrategyArtifact() THROWS if the persisted artifact's contentHash no longer matches its own spec - a tampered/corrupted row is never silently handed back as safe to execute", async () => {
    strategies.clear();
    const provider = fakeProvider(compileResponse("EMA 20 crosses above EMA 50 on gold", 20, 50));
    const hist = fakeHistoricalDataProvider(fakeBars());
    await algoTestService.compileAndRunAiStrategy("user-1", { intent: "EMA cross", startTime: START, endTime: END }, { provider, historicalDataProvider: hist });
    const strategyRow = [...strategies.values()][0]!;
    const tampered = { ...(strategyRow.artifact as Record<string, unknown>), contentHash: "0".repeat(64) };
    strategyRow.artifact = tampered;
    await assert.rejects(() => algoTestService.getStrategyArtifact("user-1", strategyRow.strategyId as string), /integrity check/);
  });

  console.log("\n=== Registry strategies never get a Strategy row (structural proof, source-verified) ===");
  await test("runAlgoTest (the registry path) never calls persistAiStrategy/prisma.strategy anywhere - read directly from source, not inferred behaviorally", () => {
    const source = readFileSync(new URL("../services/algo-test/algo-test.service.ts", import.meta.url), "utf8");
    const runAlgoTestStart = source.indexOf("async runAlgoTest(");
    const compileAndRunStart = source.indexOf("async compileAndRunAiStrategy(");
    assert.ok(runAlgoTestStart > 0 && compileAndRunStart > runAlgoTestStart);
    const runAlgoTestBody = source.slice(runAlgoTestStart, compileAndRunStart);
    assert.ok(!runAlgoTestBody.includes("persistAiStrategy"), "the registry-backed runAlgoTest() body must never reference the AI-only Strategy-persistence helper");
    assert.ok(!runAlgoTestBody.includes("prisma.strategy"), "the registry-backed runAlgoTest() body must never touch the Strategy table directly either");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
