// scripts/validate-intelligence-analysis-memory.ts
// Sprint D2.5.1 - Standalone validation for the new Intelligence Memory
// persistence foundation: IntelligenceAnalysisRunService,
// IntelligenceAnalysisOutcomeService, and OutcomeEvaluatorService. No test
// framework exists in this project; run via
// `npm run validate:intelligence-memory`. Self-cleaning against the real
// DB, synthetic d2-5-1-tagged data only.
//
// Note on "validated"/"invalidated" outcome tests below: OutcomeEvaluatorService
// never produces these statuses in D2.5.1 (no Hypothesis Engine exists yet
// to define what would count as validated/invalidated - see that file's
// header). The tests for those two statuses exercise
// IntelligenceAnalysisOutcomeService directly (the persistence layer,
// which must support all four enum values for forward compatibility),
// not the evaluator - this is called out explicitly so the distinction
// isn't lost later.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "../services/intelligence/memory/analysis-outcome.service";
import { OutcomeEvaluatorService } from "../services/intelligence/memory/outcome-evaluator.service";
import { RepositoryError } from "../types/repository";
import type { MarketIntelligenceResult } from "../types/market-intelligence-result";
import type { SnapshotProvider } from "../types/market-data-provider";
import type { MarketSnapshot } from "../types/market-snapshot";

const RUN_TAG = `d2-5-1-${Date.now()}`;
const runs = new IntelligenceAnalysisRunService();
const outcomes = new IntelligenceAnalysisOutcomeService();

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

// Minimal fixture covering only the fields any code under test actually
// reads (evidence.items for price extraction, metadata.pipelineVersion) -
// not a fully-populated real pipeline result. Cast through `unknown`
// deliberately, same as any test fixture for a large production type.
function fakeAnalysisResult(price: number | undefined, pipelineVersion = "15D.12.0-test"): MarketIntelligenceResult {
  const items = price === undefined
    ? []
    : [{ type: "price", symbol: "EURUSD", claim: `Price is ${price}`, source: "test-fixture", asOf: new Date().toISOString(), retrievedAt: new Date().toISOString(), magnitude: price }];
  return {
    symbol: "EURUSD",
    evidence: { symbol: "EURUSD", items, conflicts: [], generatedAt: new Date().toISOString() },
    reasoning: { symbol: "EURUSD", supportingEvidence: [], opposingEvidence: [], conflicts: [], unresolvedItems: [], assumptions: [], uncertainty: { score: 0, reasons: [] }, confidenceDrivers: [], riskDrivers: [], generatedAt: new Date().toISOString() },
    risk: { symbol: "EURUSD", categories: [], overallLevel: "medium", generatedAt: new Date().toISOString() },
    confidence: { symbol: "EURUSD", categories: [], drivers: [], penalties: [], basis: [], overallScore: 0, overallLevel: "low", generatedAt: new Date().toISOString() },
    metadata: { pipelineVersion, providerStatus: { status: "ok", provider: "test-fixture" }, executionTimeMs: 1, generatedAt: new Date().toISOString() },
  } as unknown as MarketIntelligenceResult;
}

function fakeSnapshot(price: number): MarketSnapshot {
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price,
    quoteCurrency: "USD",
    timestamp: new Date().toISOString(),
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: new Date().toISOString(),
  } as unknown as MarketSnapshot;
}

class WorkingSnapshotProvider implements SnapshotProvider {
  readonly name = "test-working";
  constructor(private readonly price: number) {}
  isConfigured(): boolean {
    return true;
  }
  async getSnapshot(): Promise<MarketSnapshot> {
    return fakeSnapshot(this.price);
  }
}

class FailingSnapshotProvider implements SnapshotProvider {
  readonly name = "test-failing";
  isConfigured(): boolean {
    return true;
  }
  async getSnapshot(): Promise<MarketSnapshot> {
    throw new Error("provider unavailable (simulated)");
  }
}

async function main(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@internal.test`, name: "Intelligence Memory Test Owner" },
  });
  const otherUser = await prisma.user.create({
    data: { email: `${RUN_TAG}-other@internal.test`, name: "Intelligence Memory Test Stranger" },
  });

  const runIds: string[] = [];

  try {
    // ---- AnalysisRun creation + retrieval ----
    let runWithResult: Awaited<ReturnType<typeof runs.createAnalysisRun>>;
    await test("createAnalysisRun persists a real analysis snapshot with derived pipelineVersion", async () => {
      runWithResult = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "EURUSD",
        timeframe: "1h",
        analysisResult: fakeAnalysisResult(1.085),
      });
      runIds.push(runWithResult.id);
      assert.equal(runWithResult.pipelineVersion, "15D.12.0-test");
      assert.equal(runWithResult.evaluationStatus, "pending");
      assert.equal(runWithResult.regimeAtTime, null, "regimeAtTime must be null - no Regime Engine exists yet");
      assert.ok(runWithResult.analysisResult, "analysisResult should round-trip");
    });

    await test("createAnalysisRun with no result leaves analysisResult and pipelineVersion null - never fabricated", async () => {
      const run = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "GBPUSD",
        timeframe: "4h",
        analysisResult: null,
      });
      runIds.push(run.id);
      assert.equal(run.analysisResult, null);
      assert.equal(run.pipelineVersion, null);
    });

    await test("getAnalysisRun retrieves a persisted run by id+userId", async () => {
      const fetched = await runs.getAnalysisRun(runWithResult.id, user.id);
      assert.ok(fetched);
      assert.equal(fetched?.symbol, "EURUSD");
      assert.equal(fetched?.timeframe, "1h");
    });

    await test("getAnalysisRun returns null for a run owned by a different user", async () => {
      const fetched = await runs.getAnalysisRun(runWithResult.id, otherUser.id);
      assert.equal(fetched, null);
    });

    await test("getAnalysisRun returns null for a nonexistent id", async () => {
      const fetched = await runs.getAnalysisRun("nonexistent-id", user.id);
      assert.equal(fetched, null);
    });

    await test("a run persisted by one service instance is visible from a fresh instance (survives no in-process cache)", async () => {
      const freshServiceInstance = new IntelligenceAnalysisRunService();
      const fetched = await freshServiceInstance.getAnalysisRun(runWithResult.id, user.id);
      assert.ok(fetched, "a brand-new service instance with no shared in-memory state must still read the row from the real database");
      assert.equal(fetched?.id, runWithResult.id);
    });

    await test("listPendingEvaluationRuns returns only pending runs for this user", async () => {
      const pending = await runs.listPendingEvaluationRuns(user.id, 50);
      const ids = pending.map((r) => r.id);
      assert.ok(ids.includes(runWithResult.id));
      assert.ok(pending.every((r) => r.evaluationStatus === "pending"));
    });

    // ---- AnalysisOutcome: persistence layer supports all 4 statuses (forward-compat) ----
    await test("createOutcome persists a pending outcome with evaluationBasis", async () => {
      const outcome = await outcomes.createOutcome({
        analysisRunId: runWithResult.id,
        hypothesisId: null,
        status: "pending",
        evaluatedAt: null,
        actualPriceMovePct: null,
        actualRegimeAfter: null,
        evaluationBasis: "Test: pending status persistence.",
      });
      assert.equal(outcome.status, "pending");
      assert.equal(outcome.hypothesisId, null);
      assert.equal(outcome.evaluationBasis, "Test: pending status persistence.");
    });

    await test("createOutcome persists a validated outcome (persistence layer only - the evaluator never produces this in D2.5.1)", async () => {
      const outcome = await outcomes.createOutcome({
        analysisRunId: runWithResult.id,
        hypothesisId: null,
        status: "validated",
        evaluatedAt: new Date().toISOString(),
        actualPriceMovePct: 1.23,
        actualRegimeAfter: null,
        evaluationBasis: "Test: validated status persistence (schema forward-compat check).",
      });
      assert.equal(outcome.status, "validated");
      assert.equal(outcome.actualPriceMovePct, 1.23);
    });

    await test("createOutcome persists an invalidated outcome (persistence layer only - the evaluator never produces this in D2.5.1)", async () => {
      const outcome = await outcomes.createOutcome({
        analysisRunId: runWithResult.id,
        hypothesisId: null,
        status: "invalidated",
        evaluatedAt: new Date().toISOString(),
        actualPriceMovePct: -0.5,
        actualRegimeAfter: null,
        evaluationBasis: "Test: invalidated status persistence (schema forward-compat check).",
      });
      assert.equal(outcome.status, "invalidated");
    });

    await test("createOutcome persists an inconclusive outcome", async () => {
      const outcome = await outcomes.createOutcome({
        analysisRunId: runWithResult.id,
        hypothesisId: null,
        status: "inconclusive",
        evaluatedAt: new Date().toISOString(),
        actualPriceMovePct: 0,
        actualRegimeAfter: null,
        evaluationBasis: "Test: inconclusive status persistence.",
      });
      assert.equal(outcome.status, "inconclusive");
    });

    await test("createOutcome rejects an empty evaluationBasis - no outcome without a stated reason", async () => {
      await assert.rejects(
        () =>
          outcomes.createOutcome({
            analysisRunId: runWithResult.id,
            hypothesisId: null,
            status: "inconclusive",
            evaluatedAt: null,
            actualPriceMovePct: null,
            actualRegimeAfter: null,
            evaluationBasis: "   ",
          }),
        RepositoryError,
      );
    });

    await test("getOutcomesForRun returns every outcome for a run, in order - relation integrity", async () => {
      const forRun = await outcomes.getOutcomesForRun(runWithResult.id);
      assert.equal(forRun.length, 4, "pending + validated + invalidated + inconclusive = 4 (the rejected-validation test above created no row)");
      assert.ok(forRun.every((o) => o.analysisRunId === runWithResult.id));
    });

    // ---- OutcomeEvaluatorService: the conservative evaluator ----
    await test("evaluator: no analysisResult -> pending, with an explicit reason", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "USDJPY", timeframe: "1d", analysisResult: null });
      runIds.push(run.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new WorkingSnapshotProvider(150) });
      const outcome = await evaluator.evaluateRun(run.id, user.id);
      assert.equal(outcome.status, "pending");
      assert.match(outcome.evaluationBasis, /no analysis snapshot/i);
      const refetched = await runs.getAnalysisRun(run.id, user.id);
      assert.equal(refetched?.evaluationStatus, "pending", "a pending outcome must not flip the run to evaluated");
    });

    await test("evaluator: analysisResult with no price evidence -> pending, never estimates a price move", async () => {
      const run = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "XAUUSD",
        timeframe: "1h",
        analysisResult: fakeAnalysisResult(undefined),
      });
      runIds.push(run.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new WorkingSnapshotProvider(2000) });
      const outcome = await evaluator.evaluateRun(run.id, user.id);
      assert.equal(outcome.status, "pending");
      assert.equal(outcome.actualPriceMovePct, null);
      assert.match(outcome.evaluationBasis, /no price evidence/i);
    });

    await test("evaluator: current snapshot unavailable -> pending, never estimates", async () => {
      const run = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "EURUSD",
        timeframe: "1h",
        analysisResult: fakeAnalysisResult(1.08),
      });
      runIds.push(run.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new FailingSnapshotProvider() });
      const outcome = await evaluator.evaluateRun(run.id, user.id);
      assert.equal(outcome.status, "pending");
      assert.equal(outcome.actualPriceMovePct, null);
      assert.match(outcome.evaluationBasis, /unavailable/i);
    });

    await test("evaluator: real price data both sides -> inconclusive with a genuinely computed price move, run flips to evaluated", async () => {
      const run = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "EURUSD",
        timeframe: "1h",
        analysisResult: fakeAnalysisResult(1.0),
      });
      runIds.push(run.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new WorkingSnapshotProvider(1.05) });
      const outcome = await evaluator.evaluateRun(run.id, user.id);
      assert.equal(outcome.status, "inconclusive");
      assert.equal(outcome.actualPriceMovePct, 5, "(1.05 - 1.0) / 1.0 * 100 = 5");
      assert.match(outcome.evaluationBasis, /no hypothesis/i);
      const refetched = await runs.getAnalysisRun(run.id, user.id);
      assert.equal(refetched?.evaluationStatus, "evaluated");
    });

    await test("evaluator: never produces validated/invalidated in D2.5.1 (no Hypothesis Engine exists)", async () => {
      const run = await runs.createAnalysisRun({
        userId: user.id,
        symbol: "EURUSD",
        timeframe: "1h",
        analysisResult: fakeAnalysisResult(1.2),
      });
      runIds.push(run.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new WorkingSnapshotProvider(1.19) });
      const outcome = await evaluator.evaluateRun(run.id, user.id);
      assert.notEqual(outcome.status, "validated");
      assert.notEqual(outcome.status, "invalidated");
    });

    await test("evaluatePendingRuns processes multiple pending runs and produces one outcome each", async () => {
      const a = await runs.createAnalysisRun({ userId: user.id, symbol: "BTCUSD", timeframe: "1d", analysisResult: fakeAnalysisResult(60000) });
      const b = await runs.createAnalysisRun({ userId: user.id, symbol: "ETHUSD", timeframe: "1d", analysisResult: fakeAnalysisResult(3000) });
      runIds.push(a.id, b.id);
      const evaluator = new OutcomeEvaluatorService({ snapshotProvider: new WorkingSnapshotProvider(60000) });
      const results = await evaluator.evaluatePendingRuns(user.id, 100);
      const resultRunIds = results.map((r) => r.analysisRunId);
      assert.ok(resultRunIds.includes(a.id));
      assert.ok(resultRunIds.includes(b.id));
    });

    // ---- Relation integrity: cascade delete ----
    await test("deleting an analysis run cascades to its outcomes (FK integrity)", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "EURUSD", timeframe: "1h", analysisResult: fakeAnalysisResult(1.1) });
      await outcomes.createOutcome({
        analysisRunId: run.id,
        hypothesisId: null,
        status: "inconclusive",
        evaluatedAt: new Date().toISOString(),
        actualPriceMovePct: 0,
        actualRegimeAfter: null,
        evaluationBasis: "Test: cascade delete check.",
      });
      await prisma.intelligenceAnalysisRun.delete({ where: { id: run.id } });
      const remaining = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: run.id } });
      assert.equal(remaining, 0, "outcomes must be cascade-deleted with their parent run");
      // Not added to runIds - already hard-deleted by this test.
    });
  } finally {
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, otherUser.id] } } });

    const leftoverOutcomes = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: { in: runIds } } });
    const leftoverRuns = await prisma.intelligenceAnalysisRun.count({ where: { id: { in: runIds } } });
    const leftoverUsers = await prisma.user.count({ where: { id: { in: [user.id, otherUser.id] } } });

    if (leftoverOutcomes > 0 || leftoverRuns > 0 || leftoverUsers > 0) {
      console.error(
        `  WARNING: leftover rows - outcomes:${leftoverOutcomes} runs:${leftoverRuns} users:${leftoverUsers}`,
      );
      failed += 1;
    } else {
      console.log("  cleanup - all validation rows removed (users, runs, outcomes)");
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
