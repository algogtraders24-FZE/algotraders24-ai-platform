// scripts/validate-algo-test-strategy-library.ts
// P4.8-T3.2 (docs/P4.8-T3-STRATEGY-LIBRARY.md, per the locked T3.1
// contract) - pure offline tests (no live LLM, no live network, no live
// Postgres - the same fake-Prisma-at-the-boundary technique every other
// algo-test validate script already established) proving
// listStrategyLibrary()/getStrategyLibraryDetail() against the REAL,
// unmodified algoTestService, real registry strategies, and real
// (fake-DB-persisted) AI Strategy rows - never a mock of the aggregation
// logic itself.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { algoTestService } from "../services/algo-test/algo-test.service";
import { listAvailableStrategies } from "../services/algo-test/strategy-registry";
import { freezeStrategyVersion, type StrategySpec } from "at24-quant-engine";

interface FakeStrategyRow {
  id: string;
  userId: string;
  strategyId: string;
  origin: string;
  name: string;
  artifact: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeRunRow {
  id: string;
  userId: string;
  strategyId: string;
  strategyRefId: string | null;
  createdAt: Date;
  [key: string]: unknown;
}

function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown };
      if ("in" in c) return c.in!.includes(value);
      if ("not" in c) return value !== c.not;
    }
    return value === cond;
  });
}

function installFakePrisma(): { runs: Map<string, FakeRunRow>; strategies: Map<string, FakeStrategyRow> } {
  const runs = new Map<string, FakeRunRow>();
  const strategies = new Map<string, FakeStrategyRow>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).algoTestRun = {
    async groupBy({ by, where, _count, _max }: { by: string[]; where: Record<string, unknown>; _count?: unknown; _max?: { createdAt?: boolean } }) {
      const matching = [...runs.values()].filter((r) => matchesWhere(r as unknown as Record<string, unknown>, where));
      const groups = new Map<string, FakeRunRow[]>();
      for (const row of matching) {
        const key = by.map((k) => String((row as unknown as Record<string, unknown>)[k])).join("::");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(row);
      }
      return [...groups.values()].map((groupRows) => {
        const result: Record<string, unknown> = {};
        for (const k of by) result[k] = (groupRows[0] as unknown as Record<string, unknown>)[k];
        if (_count) result._count = { _all: groupRows.length };
        if (_max?.createdAt) result._max = { createdAt: groupRows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), groupRows[0]!.createdAt) };
        return result;
      });
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).strategy = {
    async findMany({ where, orderBy, take }: { where: { userId: string }; orderBy?: { createdAt: "asc" | "desc" }; take?: number }) {
      let rows = [...strategies.values()].filter((s) => s.userId === where.userId);
      if (orderBy?.createdAt === "desc") rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (take !== undefined) rows = rows.slice(0, take);
      return rows;
    },
    async findUnique({ where }: { where: { userId_strategyId: { userId: string; strategyId: string } } }) {
      const key = `${where.userId_strategyId.userId}::${where.userId_strategyId.strategyId}`;
      return [...strategies.values()].find((s) => `${s.userId}::${s.strategyId}` === key) ?? null;
    },
  };

  // Test fixtures write directly into these maps.
  return { runs, strategies };
}

function buildFixtureSpec(strategyId: string, name: string): StrategySpec {
  return {
    identity: { strategyId, name },
    version: "1.0.0",
    metadata: { createdAt: 0 },
    instruments: [{ symbol: "XAUUSD" }],
    timeframes: ["M15"],
    parameters: [],
    entryRules: [{ id: "e0", direction: "BUY", condition: { type: "comparison", operator: "cross_above", left: { kind: "indicator", ref: { name: "EMA", params: [20] } }, right: { kind: "indicator", ref: { name: "EMA", params: [50] } } } }],
    exitRules: [],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, stopLoss: { type: "fixed-distance", distance: 5 } },
    execution: { declared: { fillModel: "next-bar-open", costsExplicitlyZero: true }, platformDefaultsUsed: [] },
  } as unknown as StrategySpec;
}

function addStrategy(strategies: Map<string, FakeStrategyRow>, overrides: Partial<FakeStrategyRow> & { userId: string; strategyId: string; name: string }): FakeStrategyRow {
  // A genuinely valid, integrity-verifiable artifact - built via the
  // REAL engine freezeStrategyVersion(), the exact same function
  // persistAiStrategy() itself calls, so verifyStrategyVersionIntegrity()
  // and validateStrategySpec() both genuinely pass, not merely assumed.
  const spec = buildFixtureSpec(overrides.strategyId, overrides.name);
  const row: FakeStrategyRow = {
    id: `strat_${strategies.size + 1}_${Math.random().toString(36).slice(2, 8)}`,
    origin: "ai-generated",
    artifact: freezeStrategyVersion(spec, 0),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  strategies.set(row.id, row);
  return row;
}

function addRun(runs: Map<string, FakeRunRow>, overrides: Partial<FakeRunRow> & { userId: string; strategyId: string }): FakeRunRow {
  const row: FakeRunRow = { id: `run_${runs.size + 1}_${Math.random().toString(36).slice(2, 8)}`, strategyRefId: null, createdAt: new Date(), ...overrides };
  runs.set(row.id, row);
  return row;
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

async function main(): Promise<void> {
  console.log("=== listStrategyLibrary: registry entries always present, no fabricated createdAt ===");
  await test("every registered, available strategy appears, with no createdAt and 0 runCount when the user never ran it", async () => {
    installFakePrisma();
    const items = await algoTestService.listStrategyLibrary("user-empty");
    const registryIds = listAvailableStrategies().map((s) => s.strategyId);
    for (const id of registryIds) {
      const item = items.find((i) => i.strategyId === id);
      assert.ok(item, `registry strategy ${id} must always appear`);
      assert.equal(item!.origin, "registry");
      assert.equal(item!.createdAt, undefined, "a registry entry has no real per-user creation moment - must never be fabricated");
      assert.equal(item!.runCount, 0);
      assert.equal(item!.lastRunAt, undefined);
    }
  });

  console.log("\n=== listStrategyLibrary: real run-count/last-run aggregation, registry ===");
  await test("a registry strategy's runCount/lastRunAt reflect real runs, not a guess", async () => {
    const { runs } = installFakePrisma();
    addRun(runs, { userId: "user-1", strategyId: "golden", createdAt: new Date(1000) });
    addRun(runs, { userId: "user-1", strategyId: "golden", createdAt: new Date(2000) });
    const items = await algoTestService.listStrategyLibrary("user-1");
    const golden = items.find((i) => i.strategyId === "golden")!;
    assert.equal(golden.runCount, 2);
    assert.equal(golden.lastRunAt, new Date(2000).toISOString());
  });

  console.log("\n=== listStrategyLibrary: AI strategies ordered newest-first, keyed by Strategy.id not strategyId ===");
  await test("AI strategies appear after registry entries, ordered createdAt desc, with real per-strategy run aggregation keyed by the row id (the FK target), not the semantic strategyId string", async () => {
    const { runs, strategies } = installFakePrisma();
    const older = addStrategy(strategies, { userId: "user-1", strategyId: "ai-user-1-aaa", name: "Older Strategy", createdAt: new Date(1000) });
    const newer = addStrategy(strategies, { userId: "user-1", strategyId: "ai-user-1-bbb", name: "Newer Strategy", createdAt: new Date(5000) });
    addRun(runs, { userId: "user-1", strategyId: "ai-generated", strategyRefId: older.id, createdAt: new Date(1500) });
    addRun(runs, { userId: "user-1", strategyId: "ai-generated", strategyRefId: older.id, createdAt: new Date(1800) });
    addRun(runs, { userId: "user-1", strategyId: "ai-generated", strategyRefId: newer.id, createdAt: new Date(5500) });

    const items = await algoTestService.listStrategyLibrary("user-1");
    const registryCount = listAvailableStrategies().length;
    const aiItems = items.slice(registryCount);
    assert.equal(aiItems.length, 2);
    assert.equal(aiItems[0]!.strategyId, "ai-user-1-bbb", "newest AI strategy must come first");
    assert.equal(aiItems[1]!.strategyId, "ai-user-1-aaa");
    assert.equal(aiItems[1]!.runCount, 2);
    assert.equal(aiItems[1]!.lastRunAt, new Date(1800).toISOString());
    assert.equal(aiItems[0]!.runCount, 1);
    assert.ok(aiItems[0]!.createdAt, "an AI strategy DOES have a real createdAt, unlike a registry entry");
  });

  console.log("\n=== No best-metric field anywhere - structurally excluded, not merely unset ===");
  await test("a StrategyLibraryItem never carries any metric-shaped key", async () => {
    const { strategies } = installFakePrisma();
    addStrategy(strategies, { userId: "user-1", strategyId: "ai-user-1-ccc", name: "X" });
    const items = await algoTestService.listStrategyLibrary("user-1");
    const aiItem = items.find((i) => i.strategyId === "ai-user-1-ccc")!;
    const keys = Object.keys(aiItem);
    for (const forbidden of ["netProfit", "profitFactor", "winRate", "bestMetric", "metric"]) {
      assert.ok(!keys.includes(forbidden), `StrategyLibraryItem must never include "${forbidden}" - the locked T3.1 contract explicitly excludes a best-metric field`);
    }
  });

  console.log("\n=== getStrategyLibraryDetail: registry strategy ===");
  await test("a registry strategy's detail carries a real compiledStrategy view, artifactVerified true, and real aggregation", async () => {
    const { runs } = installFakePrisma();
    addRun(runs, { userId: "user-1", strategyId: "golden", createdAt: new Date(3000) });
    const detail = await algoTestService.getStrategyLibraryDetail("user-1", "golden");
    assert.ok(detail);
    assert.equal(detail!.origin, "registry");
    assert.equal(detail!.artifactVerified, true);
    assert.ok(detail!.compiledStrategy);
    assert.equal(detail!.runCount, 1);
  });

  console.log("\n=== getStrategyLibraryDetail: AI strategy, real persisted artifact ===");
  await test("an AI strategy's detail carries a compiledStrategy view derived from the REAL persisted artifact (via getStrategyArtifact), not re-derived some other way", async () => {
    const { strategies } = installFakePrisma();
    const row = addStrategy(strategies, { userId: "user-1", strategyId: "ai-user-1-ddd", name: "My EMA Strategy" });
    const detail = await algoTestService.getStrategyLibraryDetail("user-1", row.strategyId);
    assert.ok(detail);
    assert.equal(detail!.origin, "ai-generated");
    assert.equal(detail!.artifactVerified, true);
    assert.ok(detail!.compiledStrategy);
    assert.equal(detail!.compiledStrategy!.longEntry, "EMA(20) cross_above EMA(50)");
  });

  console.log("\n=== getStrategyLibraryDetail: honest absence and corruption handling ===");
  await test("returns null for a strategyId that resolves to neither a registry entry nor a persisted Strategy - never fabricated, never throws", async () => {
    installFakePrisma();
    const detail = await algoTestService.getStrategyLibraryDetail("user-1", "ai-user-1-doesnotexist");
    assert.equal(detail, null);
  });

  await test("ownership isolation: a Strategy owned by a different user resolves to null, never leaked", async () => {
    const { strategies } = installFakePrisma();
    const row = addStrategy(strategies, { userId: "user-A", strategyId: "ai-user-A-eee", name: "A's Strategy" });
    const detail = await algoTestService.getStrategyLibraryDetail("user-B", row.strategyId);
    assert.equal(detail, null);
  });

  await test("a corrupted artifact produces artifactVerified: false and no compiledStrategy - never crashes, never fabricates", async () => {
    const { strategies } = installFakePrisma();
    const row = addStrategy(strategies, { userId: "user-1", strategyId: "ai-user-1-fff", name: "Tampered" });
    row.artifact = { ...(row.artifact as Record<string, unknown>), contentHash: "0".repeat(64) };
    const detail = await algoTestService.getStrategyLibraryDetail("user-1", row.strategyId);
    assert.ok(detail);
    assert.equal(detail!.artifactVerified, false);
    assert.equal(detail!.compiledStrategy, undefined);
    // Identity/display fields must still be honest and present, even
    // though the artifact itself can't be trusted.
    assert.equal(detail!.name, "Tampered");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
