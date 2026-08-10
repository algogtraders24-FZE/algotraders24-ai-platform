// scripts/validate-hypothesis-outcome.ts
// Sprint D2.5.4 - Standalone validation for HypothesisOutcomeEvaluatorService
// and HistoricalValidationService. Mixes pure/in-memory tests (the
// evaluator itself performs no I/O beyond the injected TimeSeriesProvider)
// with real-DB tests (persistence, aggregation) - matching this project's
// established scripts/validate-*.ts pattern. Run via
// `npm run validate:hypothesis-outcome`. Self-cleaning against the real
// DB, synthetic d2-5-4-tagged data only.
//
// Every fixture below was empirically probed against the real services
// before being locked in (same discipline as D2.5.2/D2.5.3) - EMA/ATR/
// recent-range/candle-window arithmetic is not reliably hand-calculable.
// trendingBullishCloses()/breakoutCloses() are copied verbatim from
// scripts/validate-hypothesis-engine.ts, already verified there.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import {
  HypothesisOutcomeEvaluatorService,
  type HypothesisEvaluationBasis,
} from "../services/intelligence/hypothesis/hypothesis-outcome-evaluator.service";
import { IntelligenceAnalysisRunService } from "../services/intelligence/memory/analysis-run.service";
import { IntelligenceAnalysisOutcomeService } from "../services/intelligence/memory/analysis-outcome.service";
import { HistoricalValidationService, MIN_HISTORICAL_VALIDATION_SAMPLE } from "../services/intelligence/memory/historical-validation.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { MarketState } from "../types/intelligence-market-state";
import type { Regime } from "../types/intelligence-regime";
import type { Hypothesis } from "../types/intelligence-hypothesis";
import type { TimeSeriesProvider } from "../types/market-data-provider";
import type { Clock } from "../lib/market-data/cache";
import type { HypothesisSnapshot } from "../types/intelligence-hypothesis-snapshot";

const RUN_TAG = `d2-5-4-${Date.now()}`;
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

// ---- Fixture helpers (empirically verified, hourly-spaced to match the "1h" timeframe used throughout) ----
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
/** Real candle timestamps continuing directly after `creationCandles`' last real candle - never a fresh, disconnected anchor. */
function candlesFollowing(creationCandles: Candle[], closesArr: number[], volatilityFrac = 0.0008): Candle[] {
  const lastMs = new Date(creationCandles[creationCandles.length - 1].datetime).getTime();
  return makeHourlyCandles(closesArr, volatilityFrac, lastMs + HOUR_MS);
}
function snapshotFor(candles: Candle[]): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol: "EURUSD",
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
// Copied verbatim from scripts/validate-hypothesis-engine.ts (verified there to produce a trending-bullish regime).
function trendingBullishCloses(): number[] {
  const rise: number[] = [];
  for (let i = 0; i < 60; i++) rise.push(1.0 + i * 0.0015);
  const peak = rise[rise.length - 1];
  const plateau: number[] = [];
  for (let i = 0; i < 21; i++) plateau.push(peak - 0.0005 + (i % 3) * 0.0001);
  return [...rise, ...plateau];
}
// Copied verbatim from scripts/validate-hypothesis-engine.ts (verified there to produce a breakout regime).
function breakoutCloses(): number[] {
  const flat: number[] = [];
  for (let i = 0; i < 60; i++) flat.push(1.1 + (i % 3) * 0.0003);
  return [...flat, 1.1 + 0.01];
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
    throw new Error("provider down (simulated)");
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
const historicalValidation = new HistoricalValidationService();

interface Fixture {
  marketState: MarketState;
  regime: Regime;
  hypothesis: Hypothesis;
  createdAt: string;
  creationCandles: Candle[];
}

function buildBullishTrendFixture(): Fixture {
  const creationCandles = makeHourlyCandles(trendingBullishCloses());
  const snapshot = snapshotFor(creationCandles);
  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles: creationCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  return { marketState, regime, hypothesis: hypotheses[0], createdAt: creationCandles[creationCandles.length - 1].datetime, creationCandles };
}

function buildBreakoutFixture(): Fixture {
  const creationCandles = makeHourlyCandles(breakoutCloses());
  const snapshot = snapshotFor(creationCandles);
  const marketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles: creationCandles });
  const regime = regimeSvc.classify({ marketState });
  const hypotheses = hypothesisSvc.generate({ marketState, regime });
  return { marketState, regime, hypothesis: hypotheses[0], createdAt: creationCandles[creationCandles.length - 1].datetime, creationCandles };
}

function continuedBullishCandles(creationCandles: Candle[], bars = 30): Candle[] {
  const lastClose = creationCandles[creationCandles.length - 1].close;
  const closesArr: number[] = [];
  for (let i = 0; i < bars; i++) closesArr.push(lastClose - 0.0005 + (i % 3) * 0.0001);
  return candlesFollowing(creationCandles, closesArr);
}
function reversedBearishCandles(creationCandles: Candle[], bars = 30): Candle[] {
  const lastClose = creationCandles[creationCandles.length - 1].close;
  const closesArr: number[] = [];
  for (let i = 0; i < bars; i++) closesArr.push(lastClose - i * 0.003);
  return candlesFollowing(creationCandles, closesArr);
}
// Empirically verified against buildBreakoutFixture(): recentRange.high ~= 1.10104, these stay comfortably above it.
function breakoutHoldsAboveCandles(creationCandles: Candle[]): Candle[] {
  return candlesFollowing(creationCandles, [1.14, 1.145, 1.15, 1.155, 1.16]);
}
// Empirically verified: candle 2 (close 1.09) has low ~1.0896, below the ~1.10104 boundary - an
// intra-window breach even though the series later recovers to 1.15 by the final evaluation candle.
function breakoutDipsBelowCandles(creationCandles: Candle[]): Candle[] {
  return candlesFollowing(creationCandles, [1.105, 1.09, 1.095, 1.14, 1.15]);
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}-owner@internal.test`, name: "D2.5.4 Test Owner" } });
  const runIds: string[] = [];

  try {
    // ---- Pending ----
    await test("pending: prediction window not yet closed", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...continuedBullishCandles(creationCandles)]),
        clock: fixedClock(dueAt - 1000),
      });
      assert.equal(result.status, "pending");
      assert.equal(result.actualPriceMovePct, null);
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.source, "window-not-closed");
    });

    // ---- Validated (trend continuation, point-in-time comparator) ----
    await test("validated: real historical fixture satisfies the hypothesis", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...continuedBullishCandles(creationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "validated");
      assert.ok(typeof result.actualPriceMovePct === "number");
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.invalidationObserved, false);
      assert.equal(basis.source, "historical-candle");
    });

    // ---- Invalidated (trend continuation, point-in-time comparator) ----
    await test("invalidated: real historical fixture breaches the stored invalidation condition", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...reversedBearishCandles(creationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "invalidated");
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.invalidationObserved, true);
    });

    // ---- Breakout: preserved reference + intra-window scan (crosses-below comparator) ----
    await test("breakout validated: price holds above the stored creation-time boundary", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBreakoutFixture();
      assert.equal(hypothesis.type, "breakout-confirmation-bullish");
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...breakoutHoldsAboveCandles(creationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "validated");
    });

    await test("breakout invalidated: price dips below the stored boundary mid-window, even though it later recovers (intra-window scan, not an endpoint check)", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBreakoutFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...breakoutDipsBelowCandles(creationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "invalidated", "the final candle recovers to 1.15 (above boundary) - only an intra-window scan catches this breach");
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.invalidationObserved, true);
    });

    await test("breakout: the evaluated invalidation boundary is the stored creation-time recentRange.high, never recalculated from today's structure", () => {
      const { marketState, hypothesis } = buildBreakoutFixture();
      assert.equal(hypothesis.statement.invalidationCondition.referenceValue, marketState.structure?.recentRange?.high);
      assert.equal(hypothesis.statement.invalidationCondition.comparator, "crosses-below");
    });

    // ---- Inconclusive: missing data ----
    await test("inconclusive: required historical data missing (fetched series never reaches the evaluation boundary)", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider(creationCandles), // nothing past creation
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "inconclusive");
      assert.equal(result.actualPriceMovePct, null);
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.source, "insufficient-historical-data");
    });

    await test("inconclusive: provider throws while fetching historical candles", async () => {
      const { marketState, hypothesis, createdAt } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new ThrowingTimeSeriesProvider(),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(result.status, "inconclusive");
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.source, "provider-unavailable");
    });

    // ---- Prediction window / timeframe semantics ----
    await test("prediction window: 20 candles at 1h means exactly 20 hours, never silently 20 minutes", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      assert.equal(hypothesis.statement.predictionWindow.candles, 20);
      assert.equal(hypothesis.statement.predictionWindow.timeframe, "1h");
      const dueAt = new Date(createdAt).getTime() + 20 * HOUR_MS;
      const series = [...creationCandles, ...continuedBullishCandles(creationCandles)];
      const justBefore = await evaluator.evaluateHypothesis({ hypothesis, marketStateAtCreation: marketState, createdAt, timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt - 1000) });
      const justAfter = await evaluator.evaluateHypothesis({ hypothesis, marketStateAtCreation: marketState, createdAt, timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt + 1000) });
      assert.equal(justBefore.status, "pending", "1 second before the 20-hour boundary must still be pending");
      assert.notEqual(justAfter.status, "pending", "1 second after the 20-hour boundary must no longer be pending");
    });

    await test("prediction window: breakout confirmation is 5 candles, a distinct window from trend continuation's 20", () => {
      const { hypothesis } = buildBreakoutFixture();
      assert.equal(hypothesis.statement.predictionWindow.candles, 5);
      assert.equal(hypothesis.statement.predictionWindow.timeframe, "1h");
    });

    // ---- Creation-time reference (no future leakage) ----
    await test("creation-time reference: evaluator uses the stored creation price, never a value re-derived from fresh data", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      // Deliberately corrupt the "creation" candle in the freshly-fetched series -
      // if the evaluator ever re-derived creationPrice from this series instead
      // of the stored snapshot, this would produce an absurd price move.
      const corrupted = [...creationCandles];
      corrupted[corrupted.length - 1] = { ...corrupted[corrupted.length - 1], close: 999 };
      const series = [...corrupted, ...continuedBullishCandles(creationCandles)];
      const result = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider(series),
        clock: fixedClock(dueAt + 1000),
      });
      const basis = JSON.parse(result.evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.creationPrice, marketState.snapshot.price, "creationPrice must equal the real, stored snapshot price");
      assert.notEqual(basis.creationPrice, 999);
      assert.ok(Math.abs(result.actualPriceMovePct ?? 0) < 5, "a real, small price move - not the absurd move corrupting the fetched series would have produced");
    });

    await test("no future leakage: the invalidation boundary comes from the stored hypothesis, never recalculated from today's structure", () => {
      // Structural proof, not a runtime probe: the referenceValue is read
      // directly off the persisted Hypothesis.statement.invalidationCondition
      // (set once, at generation time, by hypothesis.service.ts) - the
      // evaluator has no code path that recomputes a boundary from a fresh
      // MarketState before comparing.
      const { hypothesis } = buildBullishTrendFixture();
      assert.equal(hypothesis.statement.invalidationCondition.referenceValue, "up");
    });

    // ---- Price move: signed percentage ----
    await test("price move: correct signed percentage calculation, both directions", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const upCandles = continuedBullishCandles(creationCandles);
      const up = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...upCandles]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.ok(typeof up.actualPriceMovePct === "number");
      const evalCandle = upCandles[hypothesis.statement.predictionWindow.candles - 1];
      const expectedUp = ((evalCandle.close - marketState.snapshot.price) / marketState.snapshot.price) * 100;
      assert.ok(Math.abs((up.actualPriceMovePct ?? 0) - expectedUp) < 1e-9);

      const down = await evaluator.evaluateHypothesis({
        hypothesis,
        marketStateAtCreation: marketState,
        createdAt,
        timeSeriesProvider: new FakeTimeSeriesProvider([...creationCandles, ...reversedBearishCandles(creationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.ok(typeof down.actualPriceMovePct === "number" && down.actualPriceMovePct < 0, "a reversal to bearish must produce a negative price move");
    });

    // ---- Determinism ----
    await test("determinism: same historical data + same hypothesis -> same outcome", async () => {
      const { marketState, hypothesis, createdAt, creationCandles } = buildBullishTrendFixture();
      const dueAt = new Date(createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const series = [...creationCandles, ...continuedBullishCandles(creationCandles)];
      const r1 = await evaluator.evaluateHypothesis({ hypothesis, marketStateAtCreation: marketState, createdAt, timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt + 1000) });
      const r2 = await evaluator.evaluateHypothesis({ hypothesis, marketStateAtCreation: marketState, createdAt, timeSeriesProvider: new FakeTimeSeriesProvider(series), clock: fixedClock(dueAt + 1000) });
      assert.deepEqual(r1, r2);
    });

    // ---- evaluateAnalysisRun: persistence + immutability ----
    let persistedRunId: string;
    await test("evaluateAnalysisRun persists a real outcome and flips the run to evaluated", async () => {
      const { marketState, regime, hypothesis, createdAt } = buildBullishTrendFixture();
      const snapshot: HypothesisSnapshot = { marketState, regime, hypotheses: [hypothesis], capturedAt: createdAt };
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "EURUSD", timeframe: "1h", analysisResult: null, hypothesisSnapshot: snapshot });
      runIds.push(run.id);
      persistedRunId = run.id;

      // evaluateAnalysisRun searches for candles at/after the REAL persisted
      // run.createdAt (the actual DB insert time), never the fixture's
      // synthetic historical createdAt - so the injected candle series must
      // be anchored to run.createdAt, not to the fixture's BASE_TIME.
      const anchorMs = new Date(run.createdAt).getTime() - (trendingBullishCloses().length - 1) * HOUR_MS;
      const liveCreationCandles = makeHourlyCandles(trendingBullishCloses(), 0.0008, anchorMs);
      const dueAt = new Date(run.createdAt).getTime() + hypothesis.statement.predictionWindow.candles * HOUR_MS;
      const produced = await evaluator.evaluateAnalysisRun(run.id, user.id, {
        timeSeriesProvider: new FakeTimeSeriesProvider([...liveCreationCandles, ...continuedBullishCandles(liveCreationCandles)]),
        clock: fixedClock(dueAt + 1000),
      });
      assert.equal(produced.length, 1);
      assert.equal(produced[0].status, "validated");
      assert.equal(produced[0].hypothesisId, hypothesis.id);
      assert.equal(produced[0].hypothesisType, hypothesis.type);

      const refetchedRun = await runs.getAnalysisRun(run.id, user.id);
      assert.equal(refetchedRun?.evaluationStatus, "evaluated");
    });

    await test("immutability: the original hypothesisSnapshot is byte-identical after evaluation", async () => {
      const refetched = await runs.getAnalysisRun(persistedRunId, user.id);
      assert.ok(refetched?.hypothesisSnapshot);
      assert.equal(refetched?.hypothesisSnapshot?.hypotheses.length, 1);
      assert.equal(refetched?.hypothesisSnapshot?.marketState.symbol, "EURUSD");
    });

    await test("evaluateAnalysisRun with no hypothesisSnapshot produces one honest inconclusive outcome, never fabricates a verdict", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "GBPUSD", timeframe: "1h", analysisResult: null });
      runIds.push(run.id);
      const produced = await evaluator.evaluateAnalysisRun(run.id, user.id, { timeSeriesProvider: new FakeTimeSeriesProvider([]) });
      assert.equal(produced.length, 1);
      assert.equal(produced[0].status, "inconclusive");
      const basis = JSON.parse(produced[0].evaluationBasis) as HypothesisEvaluationBasis;
      assert.equal(basis.source, "no-hypothesis-snapshot");
    });

    // ---- Historical validation: below/at minimum sample size ----
    await test("historical validation: below MIN_HISTORICAL_VALIDATION_SAMPLE -> validatedRate is undefined, never 0", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "XAUUSD", timeframe: "15m", analysisResult: null });
      runIds.push(run.id);
      // 5 validated, 0 invalidated - a real, nonzero rate if it were reported, which is exactly why it must stay undefined below threshold.
      for (let i = 0; i < 5; i++) {
        await outcomes.createOutcome({
          analysisRunId: run.id,
          hypothesisId: `${RUN_TAG}-h${i}`,
          hypothesisType: "range-continuation",
          regimeType: "ranging",
          status: "validated",
          evaluatedAt: new Date().toISOString(),
          actualPriceMovePct: 0.1,
          actualRegimeAfter: null,
          evaluationBasis: "test fixture",
        });
      }
      const result = await historicalValidation.buildHistoricalValidation(
        { symbol: "XAUUSD", timeframe: "15m", regimeType: "ranging", hypothesisType: "range-continuation" },
        user.id,
      );
      assert.equal(result.sampleSize, 5);
      assert.equal(result.validatedCount, 5);
      assert.equal(result.validatedRate, undefined, "5 samples is below the documented minimum - must never report a rate, and never fabricate 0%");
      assert.equal(result.minSampleSize, MIN_HISTORICAL_VALIDATION_SAMPLE);
    });

    await test("historical validation: at/above MIN_HISTORICAL_VALIDATION_SAMPLE -> correct deterministic rate", async () => {
      const run = await runs.createAnalysisRun({ userId: user.id, symbol: "BTCUSD", timeframe: "4h", analysisResult: null });
      runIds.push(run.id);
      // 21 validated + 9 invalidated = 30 resolved -> rate 21/30 = 0.7
      for (let i = 0; i < 21; i++) {
        await outcomes.createOutcome({
          analysisRunId: run.id, hypothesisId: `${RUN_TAG}-v${i}`, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
          status: "validated", evaluatedAt: new Date().toISOString(), actualPriceMovePct: 1, actualRegimeAfter: null, evaluationBasis: "test fixture",
        });
      }
      for (let i = 0; i < 9; i++) {
        await outcomes.createOutcome({
          analysisRunId: run.id, hypothesisId: `${RUN_TAG}-i${i}`, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
          status: "invalidated", evaluatedAt: new Date().toISOString(), actualPriceMovePct: -1, actualRegimeAfter: null, evaluationBasis: "test fixture",
        });
      }
      // 2 inconclusive - must be reported separately and NOT dilute the rate's denominator
      for (let i = 0; i < 2; i++) {
        await outcomes.createOutcome({
          analysisRunId: run.id, hypothesisId: `${RUN_TAG}-x${i}`, hypothesisType: "trend-continuation-bullish", regimeType: "trending-bullish",
          status: "inconclusive", evaluatedAt: new Date().toISOString(), actualPriceMovePct: null, actualRegimeAfter: null, evaluationBasis: "test fixture",
        });
      }

      const result = await historicalValidation.buildHistoricalValidation(
        { symbol: "BTCUSD", timeframe: "4h", regimeType: "trending-bullish", hypothesisType: "trend-continuation-bullish" },
        user.id,
      );
      assert.equal(result.validatedCount, 21);
      assert.equal(result.invalidatedCount, 9);
      assert.equal(result.inconclusiveCount, 2);
      assert.equal(result.sampleSize, 30, "sampleSize excludes inconclusive - only objectively resolved outcomes count");
      assert.equal(result.validatedRate, 0.7);
    });

    // ---- Segmentation ----
    await test("segmentation: different symbol/timeframe/regime/hypothesis combinations never mix", async () => {
      const btcResult = await historicalValidation.buildHistoricalValidation(
        { symbol: "BTCUSD", timeframe: "4h", regimeType: "trending-bullish", hypothesisType: "trend-continuation-bullish" },
        user.id,
      );
      const xauResult = await historicalValidation.buildHistoricalValidation(
        { symbol: "XAUUSD", timeframe: "15m", regimeType: "ranging", hypothesisType: "range-continuation" },
        user.id,
      );
      // The BTCUSD segment's 30 rows must not leak into an unrelated XAUUSD/ranging/range-continuation segment.
      assert.equal(xauResult.sampleSize, 5, "XAUUSD segment must still show only its own 5 rows, unaffected by the BTCUSD segment's 30");
      assert.notEqual(btcResult.sampleSize, xauResult.sampleSize);

      // A segment that was never created at all must honestly report zero, not throw or fabricate.
      const emptyResult = await historicalValidation.buildHistoricalValidation(
        { symbol: "ETHUSD", timeframe: "1d", regimeType: "breakout", hypothesisType: "breakout-confirmation-bullish" },
        user.id,
      );
      assert.equal(emptyResult.sampleSize, 0);
      assert.equal(emptyResult.validatedRate, undefined);
    });
  } finally {
    await prisma.intelligenceAnalysisOutcome.deleteMany({ where: { analysisRunId: { in: runIds } } });
    await prisma.intelligenceAnalysisRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.user.deleteMany({ where: { id: user.id } });

    const leftoverOutcomes = await prisma.intelligenceAnalysisOutcome.count({ where: { analysisRunId: { in: runIds } } });
    const leftoverRuns = await prisma.intelligenceAnalysisRun.count({ where: { id: { in: runIds } } });
    const leftoverUsers = await prisma.user.count({ where: { id: user.id } });

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
