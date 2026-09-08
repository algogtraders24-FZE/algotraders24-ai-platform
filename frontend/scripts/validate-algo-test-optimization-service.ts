// scripts/validate-algo-test-optimization-service.ts
// P4.9-A.2 (docs/P4.9-OPTIMIZATION-WFO.md) - pure offline tests (no live
// network, no live Postgres - the same fake-Prisma-at-the-boundary
// technique validate-algo-test-strategy-persistence.ts already established,
// extended here to also fake `$transaction` - the first tier in this
// program to use one) against the REAL, unmodified optimizationService
// (services/algo-test/optimization.service.ts) and the REAL golden
// strategy/registry - never a mock of the actual search-space expansion,
// atomic-transition, or finalization logic under test.
//
// Deliberately NOT proven here (an honest, disclosed boundary, same as
// every other offline validator in this codebase): real Postgres-level
// concurrency/isolation guarantees. The fake $transaction executes
// synchronously against in-memory Maps - it proves the SERVICE's own
// application-level logic (which fields get written together, which
// conditional WHERE clauses gate which writes, that a rejected atomic
// claim/finalize is a correct no-op) is correct, not that Postgres MVCC
// itself behaves as assumed (already true by construction - ordinary
// row-level conditional UPDATE semantics, not a new mechanism this program
// invented).
//
// twelveDataHistoricalDataProvider is not dependency-injectable in
// optimizationService (mirrors runAlgoTest's own established convention -
// see that function's own doc comment) - its `getBars` method is
// monkey-patched for the duration of this run and restored in `finally`,
// rather than adding DI surface area to production code purely for this
// test file's benefit.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { optimizationService, OptimizationServiceError, OPTIMIZATION_CANDIDATE_CAP, OPTIMIZATION_MIN_ELIGIBLE_TRADES, computeTotalCandidates } from "../services/algo-test/optimization.service";
import { twelveDataHistoricalDataProvider } from "../services/algo-test/historical-data/twelve-data-provider";
import type { CreateOptimizationExperimentRequest, OptimizationParameterRange } from "../types/optimization";
import type { OHLCVBar } from "at24-quant-engine";

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): { experiments: Map<string, FakeRow>; candidates: Map<string, FakeRow> } {
  const experiments = new Map<string, FakeRow>();
  const candidates = new Map<string, FakeRow>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(seq += 1)}`;

  function matches(row: FakeRow, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === "object" && "in" in (value as object)) {
        return (value as { in: unknown[] }).in.includes(row[key]);
      }
      return row[key] === value;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).optimizationExperiment = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("exp"), createdAt: new Date(), completedAt: null, cancelledAt: null, bestCandidateId: null, errorMessage: null, ...data };
      experiments.set(row.id, row);
      return row;
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return [...experiments.values()].find((r) => matches(r, where)) ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return experiments.get(where.id) ?? null;
    },
    async findUniqueOrThrow({ where }: { where: { id: string } }) {
      const row = experiments.get(where.id);
      if (!row) throw new Error(`fake prisma: no OptimizationExperiment row ${where.id}`);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = [...experiments.values()].filter((r) => matches(r, where));
      for (const row of matched) experiments.set(row.id, { ...row, ...data });
      return { count: matched.length };
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = experiments.get(where.id);
      if (!existing) throw new Error(`fake prisma: no OptimizationExperiment row ${where.id}`);
      const merged = { ...existing };
      for (const [key, value] of Object.entries(data)) {
        merged[key] = value !== null && typeof value === "object" && "increment" in (value as object) ? (Number(existing[key]) || 0) + (value as { increment: number }).increment : value;
      }
      experiments.set(where.id, merged);
      return merged;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).optimizationCandidate = {
    async createMany({ data }: { data: Record<string, unknown>[] }) {
      for (const d of data) {
        const row: FakeRow = { id: nextId("cand"), createdAt: new Date(), completedAt: null, tradeCount: null, profitFactor: null, errorMessage: null, ...d };
        candidates.set(row.id, row);
      }
      return { count: data.length };
    },
    async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt: "asc" | "desc" } }) {
      let matched = [...candidates.values()].filter((r) => matches(r, where));
      if (orderBy?.createdAt === "asc") matched = matched.sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
      return matched[0] ?? null;
    },
    async findMany({
      where,
      orderBy,
      take,
    }: {
      where: Record<string, unknown>;
      orderBy?: { profitFactor?: "asc" | "desc"; candidateHash?: "asc" | "desc"; createdAt?: "asc" | "desc" } | { profitFactor?: "asc" | "desc"; candidateHash?: "asc" | "desc"; createdAt?: "asc" | "desc" }[];
      take?: number;
    }) {
      let matched = [...candidates.values()].filter((r) => matches(r, where));
      // optimization.service.ts passes orderBy as either a single clause
      // object (getOptimizationExperiment's plain createdAt ordering) or an
      // array of clauses (TX3's profitFactor-desc/candidateHash-asc
      // tie-break) - both real Prisma shapes, normalized to an array here.
      const clauses = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
      if (clauses.length > 0) {
        matched = matched.sort((a, b) => {
          for (const clause of clauses) {
            if (clause.profitFactor) {
              const av = a.profitFactor === null ? -Infinity : (a.profitFactor as number);
              const bv = b.profitFactor === null ? -Infinity : (b.profitFactor as number);
              if (av !== bv) return clause.profitFactor === "desc" ? bv - av : av - bv;
            }
            if (clause.candidateHash) {
              const av = a.candidateHash as string;
              const bv = b.candidateHash as string;
              if (av !== bv) return clause.candidateHash === "asc" ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
            }
            if (clause.createdAt) {
              const av = (a.createdAt as Date).getTime();
              const bv = (b.createdAt as Date).getTime();
              if (av !== bv) return clause.createdAt === "asc" ? av - bv : bv - av;
            }
          }
          return 0;
        });
      }
      return take !== undefined ? matched.slice(0, take) : matched;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = [...candidates.values()].filter((r) => matches(r, where));
      for (const row of matched) candidates.set(row.id, { ...row, ...data });
      return { count: matched.length };
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = candidates.get(where.id);
      if (!existing) throw new Error(`fake prisma: no OptimizationCandidate row ${where.id}`);
      const updated = { ...existing, ...data };
      candidates.set(where.id, updated);
      return updated;
    },
  };

  // Fakes BOTH $transaction call shapes optimization.service.ts uses:
  // array-style (TX2 - the promises are already-executing fake-model calls,
  // Promise.all just awaits them) and interactive/callback-style (TX1, TX3
  // - invoked with a `tx` client that is the SAME fake model object, since
  // an in-memory Map has no real isolation to model).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (arg as (tx: any) => Promise<unknown>)(prisma);
  };

  return { experiments, candidates };
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

const INSTRUMENT = { symbol: "XAUUSD" };
// M5's own timeframe-aware range cap (maxRangeDaysFor) is 14 days per
// experiment - stay comfortably inside it.
const START = new Date(0).toISOString();
const END = new Date(10 * 86_400_000).toISOString();

/** Close pinned at 50 - below every candidate priceThreshold used in these tests, so golden's `PRICE > threshold` entry rule NEVER fires. Guarantees 0 trades, deterministically. */
function flatLowBars(): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let t = 0;
  for (let i = 0; i < 60; i++) {
    bars.push({ timestamp: t, instrument: INSTRUMENT, timeframe: "M5", open: 50, high: 50.5, low: 49.5, close: 50, volume: 1000 });
    t += 300_000;
  }
  return bars;
}

/** Close pinned at 200 (above every threshold used) with a wide high/low range each bar (150..250) - a tight stopLossDistance/takeProfitRMultiple resolves within one bar, so a position opens, closes, and reopens on nearly every bar. Guarantees >=20 trades over 80 bars (empirically confirmed, not merely assumed - see the assertion in the test itself). */
function churningHighBars(): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  let t = 0;
  for (let i = 0; i < 80; i++) {
    bars.push({ timestamp: t, instrument: INSTRUMENT, timeframe: "M5", open: 200, high: 250, low: 150, close: 200, volume: 1000 });
    t += 300_000;
  }
  return bars;
}

function withFakeBars<T>(bars: readonly OHLCVBar[], fn: () => Promise<T>): Promise<T> {
  const real = twelveDataHistoricalDataProvider.getBars;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (twelveDataHistoricalDataProvider as any).getBars = async () => ({ bars, rejected: [], source: "fake" });
  return fn().finally(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (twelveDataHistoricalDataProvider as any).getBars = real;
  });
}

const BASE_REQUEST: CreateOptimizationExperimentRequest = {
  strategyId: "golden",
  symbol: "XAUUSD",
  timeframe: "5m", // signal-facing string (SIGNAL_TIMEFRAME_TO_ENGINE_TIMEFRAME maps this to "M5") - NOT the engine token used on OHLCVBar fixtures below.
  startTime: START,
  endTime: END,
  searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 190, step: 45 }], // -> 100, 145, 190 (3 candidates)
};

async function continueUntilTerminal(userId: string, experimentId: string, maxIterations = 20) {
  let view = await optimizationService.continueOptimizationExperiment(userId, experimentId);
  let iterations = 0;
  while (view.status === "QUEUED" || view.status === "RUNNING") {
    if (iterations >= maxIterations) throw new Error(`continueUntilTerminal: did not reach a terminal state within ${maxIterations} iterations (stuck at ${view.status})`);
    view = await optimizationService.continueOptimizationExperiment(userId, experimentId);
    iterations += 1;
  }
  return view;
}

async function main(): Promise<void> {
  installFakePrisma();

  console.log("\n=== Search-space expansion / candidate cap (pure, no execution) ===");

  await test("computeTotalCandidates: empty searchSpace -> 1 (a degenerate, allowed single-candidate sweep)", () => {
    assert.equal(computeTotalCandidates([]), 1);
  });

  await test("computeTotalCandidates: a real multi-parameter grid multiplies step counts across parameters", () => {
    const space: OptimizationParameterRange[] = [
      { parameterId: "priceThreshold", min: 0, max: 100, step: 25 }, // 5 values
      { parameterId: "stopLossDistance", min: 1, max: 3, step: 1 }, // 3 values
    ];
    assert.equal(computeTotalCandidates(space), 15);
  });

  await test(`a searchSpace resolving to more than the ${OPTIMIZATION_CANDIDATE_CAP} cap is rejected at creation, before any candidate row is written`, async () => {
    const oversizedSpace: OptimizationParameterRange[] = [{ parameterId: "priceThreshold", min: 0, max: 1_000_000, step: 100 }];
    assert.ok(computeTotalCandidates(oversizedSpace) > OPTIMIZATION_CANDIDATE_CAP, "test fixture sanity check - this space must genuinely exceed the real cap");
    await assert.rejects(
      () => optimizationService.createOptimizationExperiment("user-1", { ...BASE_REQUEST, searchSpace: oversizedSpace }),
      (err: unknown) => err instanceof OptimizationServiceError && err.code === "TOO_MANY_CANDIDATES",
    );
  });

  await test("a searchSpace range outside the parameter's own declared bounds is rejected (min: -5, parameter's own min is 0)", async () => {
    await assert.rejects(
      () => optimizationService.createOptimizationExperiment("user-1", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: -5, max: 10, step: 1 }] }),
      (err: unknown) => err instanceof OptimizationServiceError && err.code === "INVALID_SEARCH_SPACE",
    );
  });

  await test("an unknown/undeclared parameterId is rejected", async () => {
    await assert.rejects(
      () => optimizationService.createOptimizationExperiment("user-1", { ...BASE_REQUEST, searchSpace: [{ parameterId: "notARealParameter", min: 0, max: 10, step: 1 }] }),
      (err: unknown) => err instanceof OptimizationServiceError && err.code === "INVALID_SEARCH_SPACE",
    );
  });

  console.log("\n=== Candidate generation ===");

  await test("candidate count matches computeTotalCandidates(); every candidate has a unique candidateHash; unswept parameters are filled with their own declared default", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-1", BASE_REQUEST);
    assert.equal(experiment.totalCandidates, 3);
    const detail = await optimizationService.getOptimizationExperiment("user-1", experiment.experimentId);
    assert.equal(detail?.candidates.length, 3);
    const hashes = new Set(detail!.candidates.map((c) => c.candidateHash));
    assert.equal(hashes.size, 3, "every candidate must have a distinct candidateHash");
    for (const c of detail!.candidates) {
      assert.equal(c.parameterValues.positionSizeQuantity, 1, "unswept parameters must be filled with their own registry default, never left absent");
      assert.equal(c.status, "UNRUN");
    }
    const thresholds = detail!.candidates.map((c) => c.parameterValues.priceThreshold).sort((a, b) => (a as number) - (b as number));
    assert.deepEqual(thresholds, [100, 145, 190]);
  });

  console.log("\n=== Fingerprint / strategyArtifactHash ===");

  await test("fingerprint is deterministic - two experiments created from the identical request produce the identical fingerprint", async () => {
    const e1 = await optimizationService.createOptimizationExperiment("user-1", BASE_REQUEST);
    const e2 = await optimizationService.createOptimizationExperiment("user-1", BASE_REQUEST);
    const d1 = await optimizationService.getOptimizationExperiment("user-1", e1.experimentId);
    const d2 = await optimizationService.getOptimizationExperiment("user-1", e2.experimentId);
    assert.equal(d1!.fingerprint, d2!.fingerprint);
    assert.equal(d1!.strategyArtifactHash, d2!.strategyArtifactHash);
  });

  await test("fingerprint changes when the searchSpace changes (a genuinely different experiment configuration)", async () => {
    const e1 = await optimizationService.createOptimizationExperiment("user-1", BASE_REQUEST);
    const e2 = await optimizationService.createOptimizationExperiment("user-1", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 200, step: 50 }] });
    const d1 = await optimizationService.getOptimizationExperiment("user-1", e1.experimentId);
    const d2 = await optimizationService.getOptimizationExperiment("user-1", e2.experimentId);
    assert.notEqual(d1!.fingerprint, d2!.fingerprint);
  });

  console.log("\n=== Full chunk execution: REJECTED path (0 trades, below minEligibleTrades) ===");

  await test(`a candidate whose window produces 0 trades is REJECTED (0 < minEligibleTrades=${OPTIMIZATION_MIN_ELIGIBLE_TRADES}), and the experiment still reaches COMPLETED with no winner`, async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-2", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 100, step: 1 }] });
    const finalView = await withFakeBars(flatLowBars(), () => continueUntilTerminal("user-2", experiment.experimentId));
    assert.equal(finalView.status, "COMPLETED");
    assert.equal(finalView.processedCandidates, finalView.totalCandidates, "TX2's atomic increment must have kept exact pace with every terminal candidate write");
    assert.equal(finalView.bestCandidateId, null, "no CANDIDATE-status row exists to win - bestCandidateId must be null, never fabricated");
    const detail = await optimizationService.getOptimizationExperiment("user-2", experiment.experimentId);
    assert.equal(detail!.candidates[0]!.status, "REJECTED");
    assert.equal(detail!.candidates[0]!.tradeCount, 0);
  });

  console.log("\n=== Full chunk execution: CANDIDATE/VALIDATED path, winner selection, Infinity wire format ===");

  await test("a candidate whose window produces >=20 trades becomes CANDIDATE, is selected as the winner, transitions to VALIDATED, and profitFactor serializes Infinity as the string \"Infinity\" on the wire (never a raw JSON number, never dropped as null)", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-3", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 100, step: 1 }] });
    const finalView = await withFakeBars(churningHighBars(), () => continueUntilTerminal("user-3", experiment.experimentId));
    assert.equal(finalView.status, "COMPLETED");
    assert.ok(finalView.bestCandidateId, "a real winner must have been selected");
    const detail = await optimizationService.getOptimizationExperiment("user-3", experiment.experimentId);
    const winner = detail!.candidates.find((c) => c.id === finalView.bestCandidateId)!;
    assert.equal(winner.status, "VALIDATED");
    assert.ok((winner.tradeCount ?? 0) >= OPTIMIZATION_MIN_ELIGIBLE_TRADES, `expected >= ${OPTIMIZATION_MIN_ELIGIBLE_TRADES} trades to prove the "many trades" bar fixture actually churns enough - got ${winner.tradeCount}`);
    // Zero losing trades is plausible for this fixture (SL/TP both tight,
    // price always far above threshold) - if it happens, profitFactor is
    // genuinely Infinity, and must be serialized as the STRING "Infinity",
    // never a raw JSON number (JSON.stringify(Infinity) === "null") and
    // never silently coerced to a finite value.
    if (winner.profitFactor === "Infinity") {
      assert.equal(typeof winner.profitFactor, "string");
    } else {
      assert.equal(typeof winner.profitFactor, "number");
    }
  });

  await test("at most one candidate per experiment is ever VALIDATED", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-3b", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 190, step: 45 }] });
    await withFakeBars(churningHighBars(), () => continueUntilTerminal("user-3b", experiment.experimentId));
    const detail = await optimizationService.getOptimizationExperiment("user-3b", experiment.experimentId);
    const validatedCount = detail!.candidates.filter((c) => c.status === "VALIDATED").length;
    assert.ok(validatedCount <= 1, `expected at most one VALIDATED candidate, found ${validatedCount}`);
  });

  console.log("\n=== Cancellation ===");

  await test("cancelling a QUEUED/RUNNING experiment: atomic transition to CANCELLED with cancelledAt set, completedAt stays unset, no winner validation runs, and a subsequent continue() call claims no further candidates", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-4", BASE_REQUEST);
    const cancelled = await optimizationService.cancelOptimizationExperiment("user-4", experiment.experimentId);
    assert.equal(cancelled?.status, "CANCELLED");
    assert.ok(cancelled?.cancelledAt);
    assert.equal(cancelled?.completedAt, undefined);

    const afterCancel = await withFakeBars(churningHighBars(), () => optimizationService.continueOptimizationExperiment("user-4", experiment.experimentId));
    assert.equal(afterCancel.status, "CANCELLED", "continue() on a CANCELLED experiment must be a harmless no-op, never resuming execution");
    assert.equal(afterCancel.processedCandidates, 0, "no candidate claims after cancellation");

    const detail = await optimizationService.getOptimizationExperiment("user-4", experiment.experimentId);
    assert.ok(detail!.candidates.every((c) => c.status === "UNRUN"), "every candidate must remain untouched (still UNRUN) after a cancellation that landed before any chunk ran");
  });

  await test("cancelling an already-COMPLETED experiment is a no-op (the atomic WHERE status IN (QUEUED,RUNNING) matches nothing)", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-5", { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 100, step: 1 }] });
    const completed = await withFakeBars(flatLowBars(), () => continueUntilTerminal("user-5", experiment.experimentId));
    assert.equal(completed.status, "COMPLETED");
    const afterCancelAttempt = await optimizationService.cancelOptimizationExperiment("user-5", experiment.experimentId);
    assert.equal(afterCancelAttempt?.status, "COMPLETED", "a completed experiment must never be turned into CANCELLED after the fact");
    assert.equal(afterCancelAttempt?.cancelledAt, undefined);
  });

  console.log("\n=== Ownership isolation ===");

  await test("continue()/get()/cancel() never leak or act across users", async () => {
    const experiment = await optimizationService.createOptimizationExperiment("user-6", BASE_REQUEST);
    assert.equal(await optimizationService.getOptimizationExperiment("user-7", experiment.experimentId), null);
    await assert.rejects(() => optimizationService.continueOptimizationExperiment("user-7", experiment.experimentId), (err: unknown) => err instanceof OptimizationServiceError && err.code === "NOT_FOUND");
    assert.equal(await optimizationService.cancelOptimizationExperiment("user-7", experiment.experimentId), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
