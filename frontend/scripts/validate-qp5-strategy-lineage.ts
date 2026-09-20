// scripts/validate-qp5-strategy-lineage.ts
// QP-5 (docs/architecture/QP5_RECONCILIATION_DECISION.md) - Strategy
// Lineage. Same two established conventions every prior sprint in this
// program uses (no test framework exists here, per package.json):
//   1. Real behavioral tests, including a fake AIProvider/
//      HistoricalDataProvider injected directly at the service boundary
//      where the LLM/market-data would otherwise be needed - the SAME
//      convention every prior algo-test validator already establishes.
//   2. Structural source verification for the locked architectural rules
//      that can't be behaviorally observed from outside (MODIFY never
//      persists, the client never becomes the identity authority, no
//      second Strategy/version model, etc).
//
// A real end-to-end database test of `persistAiStrategy`'s new
// parentStrategyId behavior requires the QP-5 migration
// (20260917100000_add_strategy_lineage) to actually be applied to this
// environment's database first - it is NOT applied yet (a deliberate,
// reported decision - see the implementation report). Section D below is
// therefore SKIPPED with the exact reason, never a false PASS, matching
// this codebase's own established "SKIPPED, exact reason" discipline
// (e.g. M8_1_production_activation.md's own cross-owner-mutation test).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma";

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(name: string, reason: string): void {
  skipped += 1;
  console.log(`  SKIPPED - ${name}`);
  console.log(`    reason: ${reason}`);
}

function readSource(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  if (!existsSync(path)) throw new Error(`${relativePath} does not exist`);
  return readFileSync(path, "utf8");
}

function stripLineComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "");
}

async function main(): Promise<void> {
  console.log("\n=== A - schema/migration structural checks ===");

  await test("Strategy.parentStrategyId is declared as a nullable self-relation in the real schema - not a second model", () => {
    const schema = readSource("../prisma/schema.prisma");
    const strategyBlock = schema.slice(schema.indexOf("model Strategy {"), schema.indexOf("model AlgoTestRun {"));
    assert.ok(strategyBlock.includes("parentStrategyId String?"));
    assert.ok(strategyBlock.includes('@relation("StrategyLineage"'));
    assert.ok(!schema.includes("model StrategyVersion"));
    // The existing identity/uniqueness/immutability contract must be untouched.
    assert.ok(strategyBlock.includes("@@unique([userId, strategyId])"));
  });

  await test("the migration is additive only - ADD COLUMN + ADD FOREIGN KEY, never DROP/ALTER an existing column, never a new table", () => {
    const migration = readSource("../prisma/migrations/20260917100000_add_strategy_lineage/migration.sql");
    assert.ok(migration.includes('ALTER TABLE "Strategy" ADD COLUMN "parentStrategyId" TEXT;'));
    assert.ok(migration.includes("ADD CONSTRAINT"));
    assert.ok(migration.includes("ON DELETE SET NULL"));
    assert.ok(!/DROP\s/i.test(migration));
    assert.ok(!/CREATE TABLE/i.test(migration));
  });

  console.log("\n=== B - persistAiStrategy() ownership + best-effort lineage behavior (structural - the function itself is module-private) ===");

  await test("persistAiStrategy verifies a supplied parentStrategyId against userId before ever using it - never trusts the caller blindly", () => {
    const service = stripLineComments(readSource("../services/algo-test/algo-test.service.ts"));
    const fnStart = service.indexOf("async function persistAiStrategy(");
    const fnBody = service.slice(fnStart, service.indexOf("\n}", fnStart));
    assert.ok(fnBody.includes("prisma.strategy.findFirst({ where: { id: parentStrategyId, userId } })"));
  });

  await test("an existing Strategy row's parent (like its artifact/name/origin) is never rewritten on a later recompile - the update branch stays empty", () => {
    const service = stripLineComments(readSource("../services/algo-test/algo-test.service.ts"));
    const fnStart = service.indexOf("async function persistAiStrategy(");
    const fnBody = service.slice(fnStart, service.indexOf("\n}", fnStart));
    assert.ok(/update:\s*\{\}/.test(fnBody));
  });

  await test("compileAndRunAiStrategy() passes the request's own parentStrategyId straight through - never invents or derives one", () => {
    const service = stripLineComments(readSource("../services/algo-test/algo-test.service.ts"));
    assert.ok(service.includes("persistAiStrategy(userId, compilation.compiledSpec, request.parentStrategyId)"));
  });

  await test("AlgoTestRunView.strategyRefId is returned on every branch that actually persisted/reused a Strategy row (success, RANGE_TOO_LARGE, and the post-EXECUTION_VALID catch) - never fabricated when compilation itself never reached EXECUTION_VALID", () => {
    const service = stripLineComments(readSource("../services/algo-test/algo-test.service.ts"));
    const fnStart = service.indexOf("async compileAndRunAiStrategy(");
    const fnEnd = service.indexOf("\n  async getStrategyArtifact", fnStart);
    const fnBody = service.slice(fnStart, fnEnd);
    const occurrences = fnBody.match(/\bstrategyRefId\b/g) ?? [];
    // 1 in `const strategyRefId = ...` + 1 more use inside that same call + 3 in the three return objects (RANGE_TOO_LARGE, success, catch) = 5.
    assert.ok(occurrences.length >= 5, `expected strategyRefId to appear at least 5 times, found ${occurrences.length}`);
    // The very first branch (compilation never reached EXECUTION_VALID) must NOT reference strategyRefId - it genuinely doesn't exist yet at that point.
    const invalidStrategyBranch = fnBody.slice(fnBody.indexOf('if (!compilation.compiledSpec'), fnBody.indexOf('const strategyRefId ='));
    assert.ok(!invalidStrategyBranch.includes("strategyRefId"));
  });

  console.log("\n=== C - Quant Chat client-side lineage/staleness rules (structural) ===");

  await test("Run Backtest sends the conversation's own latestPersistedStrategyId as parentStrategyId - never an arbitrary/global/other-conversation id", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    assert.ok(page.includes("buildQuantChatBacktestRequest(intentAtRequestTime, new Date(), latestPersistedStrategyId)"));
  });

  await test("latestPersistedStrategyId only advances on a genuinely completed run - a failed run never corrupts the previously-tracked identity", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    assert.ok(page.includes('if (run.status === "completed" && run.strategyRefId) setLatestPersistedStrategyId(run.strategyRefId);'));
  });

  await test("MODIFY (handleSend) never references latestPersistedStrategyId or persistAiStrategy - MODIFY stays purely in-memory (D2/D3)", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    const fnStart = page.indexOf("async function handleSend(");
    const fnBody = page.slice(fnStart, page.indexOf("\n  }", fnStart));
    assert.ok(!fnBody.includes("latestPersistedStrategyId"));
    assert.ok(!fnBody.includes("persistAiStrategy"));
    assert.ok(!fnBody.includes("setLatestPersistedStrategyId"));
  });

  await test("latestPersistedStrategyId is NOT part of QuantChatConversationState - it stays page-local, so the compile-only MODIFY round trip never needs to carry it (avoids touching quant-strategy-builder.service.ts)", () => {
    const types = readSource("../types/quant-chat.ts");
    assert.ok(!types.includes("latestPersistedStrategyId"));
    const qp2Service = readSource("../services/algo-test/quant-strategy-builder.service.ts");
    assert.ok(!qp2Service.includes("latestPersistedStrategyId"));
    assert.ok(!qp2Service.includes("persistAiStrategy"));
  });

  await test("a stale backtest result is never cleared/replaced by MODIFY - it stays visible with an explicit re-label once currentIntent has diverged from what it was actually run against", () => {
    const page = stripLineComments(readSource("../app/dashboard/quant-chat/page.tsx"));
    assert.ok(!page.includes("setBacktestResult(undefined)"));
    assert.ok(page.includes("backtestResultIntent !== conversationState.currentIntent"));
    assert.ok(page.includes("This backtest reflects the previous strategy"));
  });

  console.log("\n=== D - real database behavior (requires the QP-5 migration to be applied) ===");

  const strategyTableHasParentColumn = await (async () => {
    try {
      await prisma.strategy.findFirst({ where: { parentStrategyId: "__qp5_probe__" } });
      return true;
    } catch {
      return false;
    }
  })();

  if (!strategyTableHasParentColumn) {
    skip(
      "lineage persists end-to-end: root -> child -> grandchild, ownership enforced, same-semantic re-run reuses the row",
      "the QP-5 migration (20260917100000_add_strategy_lineage) has not been applied to this environment's database yet - Strategy.parentStrategyId does not exist there. Deliberately not applied by this implementation sprint (see the final report) rather than run blindly.",
    );
  } else {
    // Reached only once the migration is confirmed applied in this
    // environment - a real fixture here would compile two semantically
    // different strategies via the existing compiler with a fake
    // AIProvider (mirroring validate-nl-strategy-compiler.ts's own
    // convention), persist both through persistAiStrategy(), and assert
    // the second's parentStrategyId equals the first's row id, then clean
    // up both rows - not written now since this environment cannot
    // exercise it yet.
    await test("Strategy.parentStrategyId column is queryable", async () => {
      await prisma.strategy.findFirst({ where: { parentStrategyId: "__qp5_probe__" } });
    });
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main();
