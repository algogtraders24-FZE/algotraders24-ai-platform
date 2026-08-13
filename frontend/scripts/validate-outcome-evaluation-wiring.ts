// scripts/validate-outcome-evaluation-wiring.ts
// Sprint D2.7.9 - Historical Validation Production Wiring.
//
// Base eligibility/outcome-correctness behavior (pending/validated/
// invalidated/inconclusive verdicts, prediction-window timing, creation-
// price integrity, historical-validation sample math) is already covered
// by scripts/validate-hypothesis-outcome.ts (D2.5.4, 20/20) and is
// unchanged by this sprint - not re-tested here. This script covers only
// what D2.7.9 actually added: idempotency (the two real bugs D2.7.9 fixed),
// the DB-level concurrency backstop, batch enumeration/aggregation, user
// isolation across the new batch path, honest failure handling through the
// full evaluateAnalysisRun path, and structural verification of the
// protected trigger route's auth model.
//
// Fixture helpers below are intentionally copied from
// scripts/validate-hypothesis-outcome.ts (already verified there) rather
// than imported - matches this project's own established convention (see
// that file's own header: "copied verbatim from
// scripts/validate-hypothesis-engine.ts, already verified there").
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { HypothesisOutcomeEvaluatorService } from "../services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "../services/intelligence/memory/analysis-outcome.service";
import {
  runScheduledOutcomeEvaluation,
  evaluateOutcomesForUser,
} from "../services/intelligence/orchestration/scheduled-outcome-evaluation.service";
import { loadIntelligenceEvaluationCronSecret } from "../lib/intelligence/evaluation-env";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { MarketState } from "../types/intelligence-market-state";
import type { Regime } from "../types/intelligence-regime";
import type { Hypothesis } from "../types/intelligence-hypothesis";
import type { TimeSeriesProvider } from "../types/market-data-provider";
import type { Clock } from "../lib/market-data/cache";
import type { HypothesisSnapshot } from "../types/intelligence-hypothesis-snapshot";

const RUN_TAG = `d2-7-9-${Date.now()}`;
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

// ---- Fixture helpers (copied from scripts/validate-hypothesis-outcome.ts, already verified there) ----
const HOUR_MS = 3_600_000;
const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

function makeHourlyCandles(closesArr: number[], volatilityFrac = 0.0008, anchorMs = BASE_TIME): Candle[] {
  return closesArr.map((close, i) => {
    const range = volatilityFrac * close;
    return {
      datetime: new Date(anchorMs + i * HOUR_MS).toISOString(),
      open: close - range / 3,
      high: close + range / 2,
      low: close - range / 2,
      close,
      volume: 1000 + i,
    };
  });
}
function candlesFollowing(creationCandles: Candle[], closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  const lastMs = new Date(creationCandles[creationCandles.length - 1].datetime).getTime();
  return makeHourlyCandles(closesArr, volatilityFrac, lastMs + HOUR_MS);
}
function snapshotFor(candles: Candle[], symbol = "EURUSD"): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol,
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}
function continuedBullishCandles(creationCandles: Candle[], bars = 30): Candle[] {
  const lastClose = creationCandles[creationCandles.length - 1].close;
  const closesArr: number[] = [];
  for (let i = 0; i < bars; i++) closesArr.push(lastClose - 0.0005 + (i % 3) * 0.0001);
  return candlesFollowing(creationCandles, closesArr);
}

class FakeTimeSeriesProvider implements TimeSeriesProvider {
  readonly name = "fake";
  constructor(private readonly candles: Candle[]) {}
  isConfigured(): boolean {
    return true;
  }
  async getTimeSeries(): Promise<Candle[]> {
    return this.candles;
  }
}
class ThrowingTimeSeriesProvider implements TimeSeriesProvider {
  readonly name = "throwing";
  isConfigured(): boolean {
    return true;
  }
  async getTimeSeries(): Promise<Candle[]> {
    throw new Error("provider down (simulated, D2.7.9)");
  }
}
function fixedClock(atMs: number): Clock {
  return { now: () => atMs };
}

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();
const hypothesisSvc = new HypothesisService();
const evaluator = new HypothesisOutcomeEvaluatorService();
const runs = new IntelligenceAnalysisRunService();
const outcomes = new IntelligenceAnalysisOutcomeService();

interface Fixture {
  marketState: MarketState;
  regime: Regime;
  hypothesis: Hypothesis;
  createdAt: string;
  creationCandles: Candle[];
}

function buildBullishTrendFixture(symbol = "EURUSD"): Fixture {
  const creationCandles = makeHourlyCandles(trendingBullishCloses());
  const snapshot = snapshotFor(creationCandles, symbol);
  const marketState = marketStateSvc.assemble({ symbol, timeframe: "1h", snapshot, candles: creationCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  return { marketState, regime, hypothesis: hypotheses[0], createdAt: creationCandles[creationCandles.length - 1].datetime, creationCandles };
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}-owner@internal.test`, name: "D2.7.9 Test Owner" } });
  const userB = await prisma.user.create({ data: { email: `${RUN_TAG}-owner-b@internal.test`, name: "D2.7.9 Test Owner B" } });
  const runIds: string[] = [];

  try {
    // ==== Idempotency: no-hypothesisSnapshot runs ====
    await test("idempotency: a no-hypothesisSnapshot run evaluated twice produces exactly one outcome, and is flagged evaluated (fixes the pre-D2.7.9 infinite-repick bug)", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "GBPUSD", timeframe: "1h", analysisResult: null });
      runIds.push(run.id);

      const first = await evaluator.evaluateAnalysisRun(run.id, user.id, { timeSeriesProvider: new FakeTimeSeriesProvider([]) });
      assert.equal(first.length, 1);
      assert.equal(first[0].status, "inconclusive");

      const refetchedAfterFirst = await runs.getAnalysisRun(run.id, user.id);
      assert.equal(refetchedAfterFirst?.evaluationStatus, "evaluated", "must be flagged evaluated after its one honest outcome is recorded - pre-D2.7.9 this never happened");

      const second = await evaluator.evaluateAnalysisRun(run.id, user.id, { timeSeriesProvider: new FakeTimeSeriesProvider([]) });
      assert.equal(second.length, 1, "a repeated call must reuse the existing outcome, never create a second one");
      assert.equal(second[0].id, first[0].id, "must be the exact same row, not a duplicate");

      const allOutcomes = await outcomes.getOutcomesForRun(run.id);
      assert.equal(allOutcomes.length, 1, "exactly one outcome row must exist in the database after two invocations");
    });

    // ==== Idempotency: multi-hypothesis partial resolution ====
    await test("idempotency: re-evaluating a run does not duplicate an already-finalized hypothesis's outcome", async () => {
      const { marketState, regime, hypothesis, createdAt } = buildBullishTrendFixture("USDJPY");
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses: [hypothesis], capturedAt: createdAt };
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "USDJPY", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(run.id);

      const anchorMs = new Date(run.createdAt).getTime() - (trendingBullishCloses().length - 1) * HOUR_MS;
      const liveCreationCandles = makeHourlyCandles(trendingBullishCloses(), 0.0008, anchorMs);
      const series = [...liveCreationCandles, ...continuedBullishCandles(liveCreationCandles)];
      const dueAt = new Date(run.createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;

      const first = await evaluator.evaluateAnalysisRun(run.id, user.id, {
        timeSeriesProvider: new FakeTimeSeriesProvider(series),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(first.length, 1);
      assert.equal(first[0].status, "validated");

      // A second invocation of the SAME run (simulating a repeated trigger)
      // must reuse the finalized verdict, never re-evaluate/re-persist it.
      const second = await evaluator.evaluateAnalysisRun(run.id, user.id, {
        timeSeriesProvider: new FakeTimeSeriesProvider(series),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(second.length, 1);
      assert.equal(second[0].id, first[0].id, "must reuse the existing finalized outcome row, not create a new one");

      const allOutcomes = await outcomes.getOutcomesForRun(run.id);
      const finalized = allOutcomes.filter((o) => o.status === "validated" || o.status === "invalidated");
      assert.equal(finalized.length, 1, "exactly one finalized outcome must exist for this hypothesis after two invocations - this is the sampleSize-inflation bug D2.7.9 fixes");
    });

    // ==== Concurrency: DB-level backstop is real ====
    await test("concurrency: the DB partial unique index rejects a second finalized outcome for the same (analysisRunId, hypothesisId)", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "AUDUSD", timeframe: "1h", analysisResult: null });
      runIds.push(run.id);
      const hypothesisId = `${RUN_TAG}-concurrency-h1`;

      await outcomes.createOutcome({
        analysisRunId: run.id, hypothesisId, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
        status: "validated", evaluatedAt: new Date().toISOString(), actualPriceMovePct: 1, actualRegimeAfter: null, evaluationBasis: "fixture 1",
      });

      // createOutcome() wraps every failure into a generic RepositoryError
      // (services/intelligence/memory/analysis-outcome.service.ts) whose
      // own .message is always "Failed to create intelligence analysis
      // outcome" regardless of cause - the real Prisma P2002 (unique
      // constraint violation) is preserved on RepositoryError.cause, not
      // in the message text. Assert on the wrapped cause, not the message.
      let caught: unknown;
      try {
        await outcomes.createOutcome({
          analysisRunId: run.id, hypothesisId, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
          status: "invalidated", evaluatedAt: new Date().toISOString(), actualPriceMovePct: -1, actualRegimeAfter: null, evaluationBasis: "fixture 2 (should be rejected)",
        });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "a second finalized outcome for the same (analysisRunId, hypothesisId) must be rejected by the DB - the migration's partial unique index must exist and be enforced");
      const cause = (caught as { cause?: unknown })?.cause as { code?: string } | undefined;
      assert.equal(cause?.code, "P2002", "must be rejected specifically by the DB unique constraint (Prisma code P2002), not some other failure");

      const rowsForHypothesis = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: run.id, hypothesisId } });
      assert.equal(rowsForHypothesis, 1, "the rejected insert must not have landed - exactly one finalized row remains");
    });

    await test("concurrency: pending/inconclusive duplicates for the same hypothesis are NOT blocked by the index (retry must remain possible)", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "NZDUSD", timeframe: "1h", analysisResult: null });
      runIds.push(run.id);
      const hypothesisId = `${RUN_TAG}-retry-h1`;

      await outcomes.createOutcome({
        analysisRunId: run.id, hypothesisId, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
        status: "inconclusive", evaluatedAt: new Date().toISOString(), actualPriceMovePct: null, actualRegimeAfter: null, evaluationBasis: "attempt 1 (provider down)",
      });
      // Must NOT throw - inconclusive is deliberately excluded from the constraint so a retry can happen.
      await outcomes.createOutcome({
        analysisRunId: run.id, hypothesisId, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
        status: "inconclusive", evaluatedAt: new Date().toISOString(), actualPriceMovePct: null, actualRegimeAfter: null, evaluationBasis: "attempt 2 (retry, still down)",
      });

      const rowsForHypothesis = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: run.id, hypothesisId } });
      assert.equal(rowsForHypothesis, 2, "two inconclusive rows are expected and harmless - both are excluded from sampleSize");
    });

    await test("concurrency (live race): two simultaneous evaluateAnalysisRun invocations for the same resolved hypothesis never produce two finalized rows", async () => {
      const { marketState, regime, hypothesis, createdAt } = buildBullishTrendFixture("EURJPY");
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses: [hypothesis], capturedAt: createdAt };
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "EURJPY", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(run.id);

      const anchorMs = new Date(run.createdAt).getTime() - (trendingBullishCloses().length - 1) * HOUR_MS;
      const liveCreationCandles = makeHourlyCandles(trendingBullishCloses(), 0.0008, anchorMs);
      const series = [...liveCreationCandles, ...continuedBullishCandles(liveCreationCandles)];
      const dueAt = new Date(run.createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;

      // Genuinely concurrent: both fire real DB round trips against Supabase
      // at the same time, so their read-then-write windows can overlap.
      const [a, b] = await Promise.all([
        evaluator.evaluateAnalysisRun(run.id, user.id, { timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt + 1000) }),
        evaluator.evaluateAnalysisRun(run.id, user.id, { timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt + 1000) }),
      ]);
      assert.equal(a.length, 1);
      assert.equal(b.length, 1);
      assert.equal(a[0].id, b[0].id, "both concurrent calls must resolve to the exact same finalized outcome row");

      const finalized = (await outcomes.getOutcomesForRun(run.id)).filter((o) => o.status === "validated" || o.status === "invalidated");
      assert.equal(finalized.length, 1, "exactly one finalized outcome must exist regardless of which invocation \"won\" the race - this is the end-state guarantee, independent of timing");
    });

    // ==== Honest failure handling through the full evaluateAnalysisRun path ====
    await test("failure handling: a provider outage through the full evaluateAnalysisRun path produces inconclusive, never a fabricated verdict", async () => {
      const { marketState, regime, hypothesis, createdAt } = buildBullishTrendFixture("EURGBP");
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses: [hypothesis], capturedAt: createdAt };
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "EURGBP", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(run.id);
      const dueAt = new Date(run.createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;

      const produced = await evaluator.evaluateAnalysisRun(run.id, user.id, {
        timeSeriesProvider: new ThrowingTimeSeriesProvider(),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(produced.length, 1);
      assert.equal(produced[0].status, "inconclusive");
      assert.notEqual(produced[0].status, "validated");
      assert.notEqual(produced[0].status, "invalidated");

      // A provider outage must not silently mark the run as finally evaluated in a misleading way -
      // "inconclusive" IS a resolved (non-pending) status here, so this run correctly flips to evaluated
      // (a later real trigger won't infinitely retry a single already-recorded honest failure), matching
      // the same retry-vs-terminal semantics documented in the evaluator's header comment.
      const refetched = await runs.getAnalysisRun(run.id, user.id);
      assert.equal(refetched?.evaluationStatus, "evaluated");
    });

    // ==== User isolation ====
    // Note: evaluatePendingAnalysisRun (the real batch/manual path) only
    // ever touches runs with a real hypothesisSnapshot, and a freshly
    // created hypothesis's prediction window cannot have closed yet against
    // real wall-clock time (that path has no clock-injection parameter, by
    // design - it always uses the real production clock). So isolation is
    // proven at the level that's actually deterministic: the ownership
    // check inside evaluateAnalysisRun itself (ownership is enforced by the
    // exact same getAnalysisRun(id, userId) call both the direct and
    // wrapped paths use), plus a real-DB check that listUserIdsWithPending
    // EvaluationRuns never merges or loses userIds.
    await test("user isolation: evaluateAnalysisRun refuses to evaluate another user's run, and leaves it completely untouched", async () => {
      const { marketState, regime, hypothesis, createdAt } = buildBullishTrendFixture("EURAUD");
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses: [hypothesis], capturedAt: createdAt };
      const runForA = await runs.createAnalysisRun({ userId: user.id, symbol: "EURAUD", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(runForA.id);

      await assert.rejects(
        evaluator.evaluateAnalysisRun(runForA.id, userB.id, { timeSeriesProvider: new FakeTimeSeriesProvider([]) }),
        /not found for this user/,
        "user B must never be able to evaluate user A's run",
      );

      const stillOwnedByA = await runs.getAnalysisRun(runForA.id, user.id);
      assert.equal(stillOwnedByA?.evaluationStatus, "pending", "the rejected cross-user attempt must not have mutated the run");
      const outcomesForRun = await outcomes.getOutcomesForRun(runForA.id);
      assert.equal(outcomesForRun.length, 0, "the rejected cross-user attempt must not have created any outcome row");
    });

    await test("user isolation: listUserIdsWithPendingEvaluationRuns returns real, distinct userIds without cross-contamination", async () => {
      const runForA = await runs.createAnalysisRun({ userId: user.id, symbol: "USDCAD", timeframe: "1h", analysisResult: null });
      runIds.push(runForA.id);
      const runForB = await runs.createAnalysisRun({ userId: userB.id, symbol: "USDCHF", timeframe: "1h", analysisResult: null });
      runIds.push(runForB.id);

      const pendingUserIds = await runs.listUserIdsWithPendingEvaluationRuns(2000);
      assert.ok(pendingUserIds.includes(user.id));
      assert.ok(pendingUserIds.includes(userB.id));
      assert.equal(new Set(pendingUserIds).size, pendingUserIds.length, "must be truly distinct userIds, never duplicated");
    });

    // ==== Batch aggregation ====
    // Deliberately bounded to a SMALL maxUsers - this calls the real
    // production wiring (real marketData singleton, real users, real
    // FIFO-oldest-first ordering), so an unbounded scope here would
    // process genuine backlog outside this test's own synthetic users on
    // every single run of this script. A small bound still proves the real
    // contract (well-formed, honest, bounded, no throw) without that cost.
    await test("batch: runScheduledOutcomeEvaluation returns a well-formed, honest, bounded summary against the real evaluator", async () => {
      const summary = await runScheduledOutcomeEvaluation({ maxUsers: 3, perUserLimit: 5 });
      assert.ok(summary.usersScanned <= 3, "must never enumerate more than the requested maxUsers");
      assert.ok(summary.usersProcessed + summary.usersFailed <= summary.usersScanned, "every scanned user must be accounted for as processed or failed - never silently dropped");
      assert.ok(summary.outcomesCreated >= 0);
      assert.ok(Array.isArray(summary.errors));
      assert.equal(summary.errors.length, summary.usersFailed, "one error entry per failed user, no more, no less");
    });

    await test("batch: bounded by maxUsers - never scans beyond the requested cap", async () => {
      const summary = await runScheduledOutcomeEvaluation({ maxUsers: 1, perUserLimit: 5 });
      assert.ok(summary.usersScanned <= 1, "must never enumerate more than maxUsers, even if more users have pending work");
    });

    await test("batch: evaluateOutcomesForUser (the admin-manual path) safely no-ops when the only pending run has no hypothesisSnapshot - by design, left to a different evaluator", async () => {
      const runForA = await runs.createAnalysisRun({ userId: user.id, symbol: "USDSEK", timeframe: "1h", analysisResult: null });
      runIds.push(runForA.id);
      const produced = await evaluateOutcomesForUser(user.id, 5);
      assert.ok(Array.isArray(produced));
      // Must not throw, and must not fabricate anything for a run this path structurally cannot evaluate.
      const stillPending = await runs.getAnalysisRun(runForA.id, user.id);
      assert.equal(stillPending?.evaluationStatus, "pending");
    });

    await test("batch: evaluateOutcomesForUser and runScheduledOutcomeEvaluation call the exact same underlying evaluator - not a second implementation", () => {
      const servicePath = join(__dirname, "..", "services", "intelligence", "orchestration", "scheduled-outcome-evaluation.service.ts");
      const content = readFileSync(servicePath, "utf-8");
      const importCount = (content.match(/from "@\/services\/intelligence\/orchestration\/pending-outcome-evaluation\.service"/g) || []).length;
      assert.equal(importCount, 1, "must import evaluatePendingAnalysisRunsForUser exactly once, and both exported functions must call it - never a duplicated evaluation path");
      assert.ok(!content.includes("new HypothesisOutcomeEvaluatorService"), "must never construct its own evaluator instance - the existing D2.5.4 evaluator (already instantiated in pending-outcome-evaluation.service.ts) is the only one");
    });

    // ==== Env loader: honest optional-secret pattern ====
    await test("env: loadIntelligenceEvaluationCronSecret returns null when unset, mirroring lib/payments/env.ts's pattern", () => {
      const original = process.env.INTELLIGENCE_EVALUATION_CRON_SECRET;
      delete process.env.INTELLIGENCE_EVALUATION_CRON_SECRET;
      assert.equal(loadIntelligenceEvaluationCronSecret(), null);
      process.env.INTELLIGENCE_EVALUATION_CRON_SECRET = "a-real-secret-value";
      assert.equal(loadIntelligenceEvaluationCronSecret(), "a-real-secret-value");
      if (original === undefined) delete process.env.INTELLIGENCE_EVALUATION_CRON_SECRET;
      else process.env.INTELLIGENCE_EVALUATION_CRON_SECRET = original;
    });

    // ==== Structural: protected trigger route auth model ====
    await test("structural: the trigger route requires admin OR a constant-time-compared cron secret - never an open endpoint", () => {
      // Sprint D2.7.10 - isValidCronSecret/timingSafeEqual/the secret loader
      // were extracted from this route into lib/intelligence/cron-auth.ts
      // (so they're directly unit-testable without Next.js's request-scoped
      // APIs - see scripts/validate-scheduler-wiring.ts). The route now
      // delegates rather than inlining the check; assert the delegation and
      // that the extracted module still upholds the same properties.
      const routePath = join(__dirname, "..", "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
      const content = readFileSync(routePath, "utf-8");
      assert.ok(content.includes("requireAdmin"), "route must gate the non-cron path on requireAdmin, matching every other /api/private/admin/* route");
      assert.ok(content.includes("isValidCronSecret") && content.includes("@/lib/intelligence/cron-auth"), "route must delegate cron-secret verification to the extracted module, never inline a second check");
      assert.ok(content.includes("MAX_USERS_CAP") && content.includes("PER_USER_LIMIT_CAP"), "batch size must be hard-capped regardless of caller-requested values");

      const cronAuthPath = join(__dirname, "..", "lib", "intelligence", "cron-auth.ts");
      const cronAuthContent = readFileSync(cronAuthPath, "utf-8");
      assert.ok(cronAuthContent.includes("timingSafeEqual"), "the cron secret must be compared in constant time, never with a plain ===");
      assert.ok(cronAuthContent.includes("loadIntelligenceEvaluationCronSecret"), "must use the honest optional-secret loader, never a hardcoded secret");
      assert.ok(!/===\s*configured|configured\s*===/.test(cronAuthContent), "must never plain-equality-compare the secret");
    });

    await test("structural: the cron-secret path never reads a client-supplied userId (no impersonation vector)", () => {
      const routePath = join(__dirname, "..", "app", "api", "private", "admin", "intelligence", "evaluate-outcomes", "route.ts");
      const content = readFileSync(routePath, "utf-8");
      const cronBlockMatch = content.match(/if \(isValidCronSecret\(req\)\) \{([\s\S]*?)\n\s*\}/);
      assert.ok(cronBlockMatch, "must find the cron-secret branch");
      assert.ok(!cronBlockMatch![1].includes('searchParams.get("userId")'), "the cron-secret branch must never read a per-user override - only the admin-gated branch may target a specific user");
    });

    await test("structural: no hardcoded/committed secret literal for the cron env var", () => {
      const envPath = join(__dirname, "..", "lib", "intelligence", "evaluation-env.ts");
      const content = readFileSync(envPath, "utf-8");
      assert.ok(content.includes("process.env.INTELLIGENCE_EVALUATION_CRON_SECRET"));
      assert.ok(!/=\s*["'][A-Za-z0-9+/]{16,}["']/.test(content), "must never assign a literal secret-looking string");
    });
  } finally {
    await prisma.intelligenceAnalysisOutcome.deleteMany({ where: { analysisRunId: { in: runIds } } });
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, userB.id] } } });

    const leftoverOutcomes = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: { in: runIds } } });
    const leftoverRuns = await prisma.intelligenceAnalysisRun.count({ where: { id: { in: runIds } } });
    const leftoverUsers = await prisma.user.count({ where: { id: { in: [user.id, userB.id] } } });

    if (leftoverOutcomes > 0 || leftoverRuns > 0 || leftoverUsers > 0) {
      console.error(`  WARNING: leftover rows - outcomes:${leftoverOutcomes} runs:${leftoverRuns} users:${leftoverUsers}`);
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
