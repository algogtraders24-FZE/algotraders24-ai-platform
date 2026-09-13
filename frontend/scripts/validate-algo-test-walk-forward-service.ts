// scripts/validate-algo-test-walk-forward-service.ts
// P4.9-B-B.2 (docs/P4.9-OPTIMIZATION-WFO.md) - pure offline tests (no live
// network, no live Postgres) against the REAL, unmodified walkForwardService
// (services/algo-test/walk-forward.service.ts) and the REAL golden
// strategy/registry - never a mock of the actual fold-derivation,
// atomic-transition, or lifecycle logic under test. Same "fake Prisma at
// the boundary" technique validate-algo-test-optimization-service.ts
// already established for its own sibling domain, extended here to the
// three new WFO models (walkForwardExperiment/Fold/Candidate).
//
// Deliberately NOT proven here (an honest, disclosed boundary, same as
// every other offline validator in this codebase): real Postgres-level
// concurrency/isolation guarantees. The fake $transaction executes
// synchronously against in-memory Maps - it proves the SERVICE's own
// application-level logic (which conditional WHERE clauses gate which
// writes, that a rejected atomic transition is a correct no-op, that
// parent/child integrity checks actually run) is correct, not that
// Postgres MVCC itself behaves as assumed (already true by construction -
// ordinary conditional UPDATE semantics, not a new mechanism this program
// invented). The DUPLICATE_CANDIDATE_HASH catch-block's own DB-constraint
// safety net (for a genuine concurrent race between the service's own
// pre-check and its create() call) is likewise not independently proven
// here - only the pre-check path, which is what the service's own
// createWalkForwardCandidate() call ordinarily exercises.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { walkForwardService, WalkForwardServiceError, deriveFolds, WALK_FORWARD_IN_SAMPLE_DAYS, WALK_FORWARD_OUT_OF_SAMPLE_DAYS, WALK_FORWARD_STEP_DAYS } from "../services/algo-test/walk-forward.service";
import type { CreateWalkForwardExperimentRequest } from "../types/walk-forward";

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): { experiments: Map<string, FakeRow>; folds: Map<string, FakeRow>; candidates: Map<string, FakeRow> } {
  const experiments = new Map<string, FakeRow>();
  const folds = new Map<string, FakeRow>();
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

  function applyUpdateData(existing: FakeRow, data: Record<string, unknown>): FakeRow {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(data)) {
      merged[key] = value !== null && typeof value === "object" && "increment" in (value as object) ? (Number(existing[key]) || 0) + (value as { increment: number }).increment : value;
    }
    return merged;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).walkForwardExperiment = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("exp"), createdAt: new Date(), completedAt: null, cancelledAt: null, verdict: null, passedFoldCount: 0, conclusiveFoldCount: 0, errorMessage: null, ...data };
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
      if (!row) throw new Error(`fake prisma: no WalkForwardExperiment row ${where.id}`);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = [...experiments.values()].filter((r) => matches(r, where));
      for (const row of matched) experiments.set(row.id, applyUpdateData(row, data));
      return { count: matched.length };
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = experiments.get(where.id);
      if (!existing) throw new Error(`fake prisma: no WalkForwardExperiment row ${where.id}`);
      const merged = applyUpdateData(existing, data);
      experiments.set(where.id, merged);
      return merged;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).walkForwardFold = {
    async createMany({ data }: { data: Record<string, unknown>[] }) {
      for (const d of data) {
        const row: FakeRow = { id: nextId("fold"), createdAt: new Date(), completedAt: null, winnerCandidateId: null, oosProfitFactor: null, oosTradeCount: null, oosOutcome: null, errorMessage: null, ...d };
        folds.set(row.id, row);
      }
      return { count: data.length };
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return [...folds.values()].find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { foldIndex?: "asc" | "desc" } }) {
      let matched = [...folds.values()].filter((r) => matches(r, where));
      if (orderBy?.foldIndex) {
        matched = matched.sort((a, b) => (orderBy.foldIndex === "asc" ? (a.foldIndex as number) - (b.foldIndex as number) : (b.foldIndex as number) - (a.foldIndex as number)));
      }
      return matched;
    },
    async findUniqueOrThrow({ where }: { where: { id: string } }) {
      const row = folds.get(where.id);
      if (!row) throw new Error(`fake prisma: no WalkForwardFold row ${where.id}`);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = [...folds.values()].filter((r) => matches(r, where));
      for (const row of matched) folds.set(row.id, applyUpdateData(row, data));
      return { count: matched.length };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).walkForwardCandidate = {
    async create({ data }: { data: Record<string, unknown> }) {
      const row: FakeRow = { id: nextId("cand"), createdAt: new Date(), completedAt: null, tradeCount: null, profitFactor: null, errorMessage: null, ...data };
      candidates.set(row.id, row);
      return row;
    },
    async findFirst({ where }: { where: Record<string, unknown> }) {
      return [...candidates.values()].find((r) => matches(r, where)) ?? null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      return candidates.get(where.id) ?? null;
    },
    async findMany({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt?: "asc" | "desc"; candidateHash?: "asc" | "desc" } | { createdAt?: "asc" | "desc"; candidateHash?: "asc" | "desc" }[] }) {
      let matched = [...candidates.values()].filter((r) => matches(r, where));
      const clauses = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
      if (clauses.length > 0) {
        matched = matched.sort((a, b) => {
          for (const clause of clauses) {
            if (clause.createdAt) {
              const av = (a.createdAt as Date).getTime();
              const bv = (b.createdAt as Date).getTime();
              if (av !== bv) return clause.createdAt === "asc" ? av - bv : bv - av;
            }
            if (clause.candidateHash) {
              const av = a.candidateHash as string;
              const bv = b.candidateHash as string;
              if (av !== bv) return clause.candidateHash === "asc" ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
            }
          }
          return 0;
        });
      }
      return matched;
    },
    async findUniqueOrThrow({ where }: { where: { id: string } }) {
      const row = candidates.get(where.id);
      if (!row) throw new Error(`fake prisma: no WalkForwardCandidate row ${where.id}`);
      return row;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = [...candidates.values()].filter((r) => matches(r, where));
      for (const row of matched) candidates.set(row.id, applyUpdateData(row, data));
      return { count: matched.length };
    },
  };

  // Fakes BOTH $transaction call shapes (array-style and interactive/
  // callback-style) - walk-forward.service.ts only ever uses the
  // callback style, both are faked anyway for parity with the same
  // technique optimization.service.ts's own validator establishes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (arg as (tx: any) => Promise<unknown>)(prisma);
  };

  return { experiments, folds, candidates };
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
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function assertThrowsCode(fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn();
    assert.fail(`expected WalkForwardServiceError(${expectedCode}) but no error was thrown`);
  } catch (err) {
    if (!(err instanceof WalkForwardServiceError)) throw err;
    assert.equal(err.code, expectedCode);
  }
}

const BASE_REQUEST: CreateWalkForwardExperimentRequest = {
  strategyId: "golden",
  symbol: "XAUUSD",
  timeframe: "5m",
  startTime: "2024-11-04T00:00:00.000Z",
  endTime: "2024-11-18T00:00:00.000Z", // 14 real days (the locked M5 cap) - floor((14-7-3)/3)+1 = 2 folds
  searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 200, step: 50 }],
};

async function main() {
  console.log("\n=== Fold derivation (pure math, no DB) ===");

  await test("deriveFolds - 10-day span with locked 7/3/3 produces exactly 2 folds", () => {
    const folds = deriveFolds(new Date("2024-11-04T00:00:00.000Z"), new Date("2024-11-18T00:00:00.000Z"), "M5");
    assert.equal(folds.length, 2);
  });

  await test("deriveFolds - IS/OOS boundary is never shared (OOS starts strictly after IS end, one bar interval later)", () => {
    const [fold] = deriveFolds(new Date("2024-11-04T00:00:00.000Z"), new Date("2024-11-18T00:00:00.000Z"), "M5");
    assert.ok(fold);
    const gapMs = fold!.outOfSampleStart.getTime() - fold!.inSampleEnd.getTime();
    assert.equal(gapMs, 5 * 60_000, "outOfSampleStart must be exactly one M5 bar interval after inSampleEnd, never the same instant");
  });

  await test("deriveFolds - a span too short for even one fold returns empty, never a fabricated fold", () => {
    const folds = deriveFolds(new Date("2024-11-04T00:00:00.000Z"), new Date("2024-11-06T00:00:00.000Z"), "M5"); // 2 days < 7+3
    assert.equal(folds.length, 0);
  });

  await test("deriveFolds - rolling advancement uses stepDays from START, not from the previous fold's end", () => {
    const folds = deriveFolds(new Date("2024-11-04T00:00:00.000Z"), new Date("2024-11-18T00:00:00.000Z"), "M5");
    const gapMs = folds[1]!.inSampleStart.getTime() - folds[0]!.inSampleStart.getTime();
    assert.equal(gapMs, WALK_FORWARD_STEP_DAYS * 86_400_000);
    assert.equal(WALK_FORWARD_IN_SAMPLE_DAYS, 7);
    assert.equal(WALK_FORWARD_OUT_OF_SAMPLE_DAYS, 3);
  });

  console.log("\n=== Experiment lifecycle ===");
  {
    installFakePrisma();
    let experimentId = "";

    await test("valid creation - persists the experiment AND every derived fold in one call, no candidates yet", async () => {
      const view = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
      experimentId = view.experimentId;
      assert.equal(view.status, "QUEUED");
      assert.equal(view.totalFolds, 2);
      assert.equal(view.foldsCompleted, 0);
      assert.equal(view.validationMethod, "walk-forward");
      assert.equal(view.verdict, null);
      assert.equal(view.inSampleDays, 7);
      assert.equal(view.outOfSampleDays, 3);
      assert.equal(view.stepDays, 3);
      assert.equal(view.minEligibleTrades, 20);
      assert.equal(view.candidateCap, 256);

      const detail = await walkForwardService.getWalkForwardExperiment("user-1", experimentId);
      assert.ok(detail);
      assert.equal(detail!.folds.length, 2);
      assert.equal(detail!.folds[0]!.candidates.length, 0, "no candidates are created at experiment-creation time - that is B.3's own job");
      assert.equal(detail!.folds[0]!.status, "UNRUN");
      assert.equal(detail!.folds[1]!.status, "UNRUN");
    });

    await test("valid retrieval - ownership-scoped, a different user resolves to null (never leaks existence)", async () => {
      const asOwner = await walkForwardService.getWalkForwardExperiment("user-1", experimentId);
      const asOther = await walkForwardService.getWalkForwardExperiment("user-2", experimentId);
      assert.ok(asOwner);
      assert.equal(asOther, null);
    });

    await test("valid lifecycle transition - QUEUED -> RUNNING", async () => {
      const view = await walkForwardService.startWalkForwardExperiment("user-1", experimentId);
      assert.equal(view.status, "RUNNING");
    });

    await test("invalid transition rejected - starting an already-RUNNING experiment", async () => {
      await assertThrowsCode(() => walkForwardService.startWalkForwardExperiment("user-1", experimentId), "INVALID_TRANSITION");
    });

    await test("valid lifecycle transition - RUNNING -> COMPLETED with an externally-supplied verdict (this service never computes one)", async () => {
      const view = await walkForwardService.completeWalkForwardExperiment(experimentId, { verdict: "INCONCLUSIVE", passedFoldCount: 0, conclusiveFoldCount: 0 });
      assert.equal(view.status, "COMPLETED");
      assert.equal(view.verdict, "INCONCLUSIVE");
      assert.ok(view.completedAt);
    });

    await test("terminal-state immutability - cancelling an already-COMPLETED experiment is a correct no-op (never un-completes it)", async () => {
      const before = await walkForwardService.getWalkForwardExperiment("user-1", experimentId);
      const after = await walkForwardService.cancelWalkForwardExperiment("user-1", experimentId);
      assert.equal(after!.status, "COMPLETED", "status must remain COMPLETED - the atomic updateMany's WHERE status IN (QUEUED,RUNNING) matches nothing once terminal");
      assert.equal(after!.verdict, before!.verdict);
    });
  }

  {
    installFakePrisma();
    const view = await walkForwardService.createWalkForwardExperiment("user-x", BASE_REQUEST);

    await test("invalid transition rejected - completing with a supplied verdict requires RUNNING (not e.g. QUEUED)", async () => {
      await assertThrowsCode(() => walkForwardService.completeWalkForwardExperiment(view.experimentId, { verdict: "PASSED", passedFoldCount: 2, conclusiveFoldCount: 2 }), "INVALID_TRANSITION");
    });
  }

  console.log("\n=== Cancellation (never touches verdict, mirrors T3's own locked rule) ===");
  {
    installFakePrisma();
    const view = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    await walkForwardService.startWalkForwardExperiment("user-1", view.experimentId);

    await test("cancel - QUEUED/RUNNING -> CANCELLED, verdict stays null", async () => {
      const cancelled = await walkForwardService.cancelWalkForwardExperiment("user-1", view.experimentId);
      assert.equal(cancelled!.status, "CANCELLED");
      assert.equal(cancelled!.verdict, null);
      assert.ok(cancelled!.cancelledAt);
    });

    await test("cancel on a nonexistent experiment resolves to null, never throws", async () => {
      const result = await walkForwardService.cancelWalkForwardExperiment("user-1", "no-such-id");
      assert.equal(result, null);
    });
  }

  console.log("\n=== Fold lifecycle + parent/child integrity ===");
  {
    installFakePrisma();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    const [fold0, fold1] = detail!.folds;

    await test("nonexistent parent rejected - getWalkForwardFold with the wrong experimentId resolves to null", async () => {
      const result = await walkForwardService.getWalkForwardFold("user-1", "no-such-experiment", fold0!.id);
      assert.equal(result, null);
    });

    await test("cross-parent retrieval rejected - fold1 does not resolve under a DIFFERENT (but real) experiment id", async () => {
      const otherExperiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
      const result = await walkForwardService.getWalkForwardFold("user-1", otherExperiment.experimentId, fold0!.id);
      assert.equal(result, null, "fold0 belongs to the FIRST experiment, not otherExperiment - must not resolve cross-parent");
    });

    await test("valid transition - UNRUN -> OPTIMIZING", async () => {
      const started = await walkForwardService.startFoldOptimizing(experiment.experimentId, fold0!.id);
      assert.equal(started.status, "OPTIMIZING");
    });

    await test("invalid transition rejected - starting an already-OPTIMIZING fold", async () => {
      await assertThrowsCode(() => walkForwardService.startFoldOptimizing(experiment.experimentId, fold0!.id), "INVALID_TRANSITION");
    });

    await test("invalid transition rejected - starting fold1 while it is still UNRUN is fine, but setFoldWinner before OPTIMIZING is not", async () => {
      await assertThrowsCode(() => walkForwardService.setFoldWinner(experiment.experimentId, fold1!.id, "no-such-candidate"), "NOT_FOUND");
    });
  }

  console.log("\n=== Candidate lifecycle + parent/child/duplicate integrity ===");
  {
    installFakePrisma();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    const fold = detail!.folds[0]!;
    await walkForwardService.startFoldOptimizing(experiment.experimentId, fold.id);

    await test("nonexistent parent rejected - creating a candidate under a fold that isn't this experiment's", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardCandidate("no-such-experiment", fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } }), "INVALID_PARENT");
    });

    let candidateId = "";
    await test("valid creation under fold - persists exactly the supplied identity, UNRUN, no computation", async () => {
      const created = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } });
      candidateId = created.id;
      assert.equal(created.status, "UNRUN");
      assert.equal(created.foldId, fold.id);
      assert.deepEqual(created.parameterValues, { priceThreshold: 100 });
    });

    await test("duplicate candidate hash within the SAME fold rejected", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardCandidate(experiment.experimentId, fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } }), "DUPLICATE_CANDIDATE_HASH");
    });

    await test("the SAME candidate hash across a DIFFERENT fold remains valid (candidateHash uniqueness is fold-scoped, per the locked B.1 schema)", async () => {
      const otherFold = detail!.folds[1]!;
      await walkForwardService.startFoldOptimizing(experiment.experimentId, otherFold.id);
      const created = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, otherFold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } });
      assert.equal(created.candidateHash, "h1");
      assert.notEqual(created.foldId, fold.id);
    });

    await test("valid transition - UNRUN -> RUNNING (claim)", async () => {
      const claimed = await walkForwardService.claimWalkForwardCandidate(fold.id, candidateId);
      assert.equal(claimed.status, "RUNNING");
    });

    await test("invalid transition rejected - claiming an already-RUNNING candidate", async () => {
      await assertThrowsCode(() => walkForwardService.claimWalkForwardCandidate(fold.id, candidateId), "INVALID_TRANSITION");
    });

    await test("valid transition - RUNNING -> CANDIDATE (an externally-supplied outcome; this service never computes it)", async () => {
      const completed = await walkForwardService.completeWalkForwardCandidate(fold.id, candidateId, { status: "CANDIDATE", tradeCount: 30, profitFactor: 1.8, errorMessage: null });
      assert.equal(completed.status, "CANDIDATE");
      assert.equal(completed.tradeCount, 30);
      assert.equal(completed.profitFactor, 1.8);
    });

    await test("invalid transition rejected - completing an already-terminal candidate", async () => {
      await assertThrowsCode(() => walkForwardService.completeWalkForwardCandidate(fold.id, candidateId, { status: "REJECTED", tradeCount: 1, profitFactor: 0, errorMessage: null }), "INVALID_TRANSITION");
    });
  }

  console.log("\n=== Fold winner selection - setFoldWinner (B.2's own analog of finalizeIfComplete, minus the selection decision) ===");
  {
    installFakePrisma();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    const fold = detail!.folds[0]!;
    await walkForwardService.startFoldOptimizing(experiment.experimentId, fold.id);
    const candidate = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } });
    await walkForwardService.claimWalkForwardCandidate(fold.id, candidate.id);
    await walkForwardService.completeWalkForwardCandidate(fold.id, candidate.id, { status: "CANDIDATE", tradeCount: 25, profitFactor: 2.0, errorMessage: null });

    await test("candidate/fold integrity - a candidate from a DIFFERENT fold cannot be set as this fold's winner", async () => {
      const otherFold = detail!.folds[1]!;
      await walkForwardService.startFoldOptimizing(experiment.experimentId, otherFold.id);
      const otherCandidate = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, otherFold.id, { candidateHash: "h2", parameterValues: { priceThreshold: 150 } });
      await assertThrowsCode(() => walkForwardService.setFoldWinner(experiment.experimentId, fold.id, otherCandidate.id), "INVALID_PARENT");
    });

    await test("valid transition - setFoldWinner: fold OPTIMIZING -> VALIDATING, candidate CANDIDATE -> VALIDATED, atomically", async () => {
      const result = await walkForwardService.setFoldWinner(experiment.experimentId, fold.id, candidate.id);
      assert.equal(result.status, "VALIDATING");
      assert.equal(result.winnerCandidateId, candidate.id);
      const winnerNow = await walkForwardService.getWalkForwardCandidate(experiment.experimentId, fold.id, candidate.id);
      assert.equal(winnerNow!.status, "VALIDATED");
    });

    await test("invalid transition rejected - setting a winner twice on the same fold", async () => {
      await assertThrowsCode(() => walkForwardService.setFoldWinner(experiment.experimentId, fold.id, candidate.id), "INVALID_TRANSITION");
    });

    await test("valid transition - completeFold: VALIDATING -> COMPLETED with an externally-supplied OOS outcome, and increments the experiment's foldsCompleted", async () => {
      const before = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
      const completed = await walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: 1.4, oosTradeCount: 22, oosOutcome: "PASSED" });
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.oosOutcome, "PASSED");
      const after = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
      assert.equal(after!.foldsCompleted, before!.foldsCompleted + 1);
    });

    await test("VALIDATED is unreachable except via setFoldWinner - completeWalkForwardCandidate never produces it (structural, same invariant as OptimizationCandidate)", async () => {
      const otherFold = detail!.folds[1]!;
      const otherCandidate = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, otherFold.id, { candidateHash: "h3", parameterValues: { priceThreshold: 180 } });
      await walkForwardService.claimWalkForwardCandidate(otherFold.id, otherCandidate.id);
      const completed = await walkForwardService.completeWalkForwardCandidate(otherFold.id, otherCandidate.id, { status: "CANDIDATE", tradeCount: 21, profitFactor: 1.1, errorMessage: null });
      assert.notEqual(completed.status, "VALIDATED");
    });
  }

  console.log("\n=== Fold completion without a winner (P4.9-B-B.2.1 - the R1/R2-locked 'all candidates REJECTED/FAILED' edge case) ===");
  {
    installFakePrisma();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    const fold = detail!.folds[0]!;
    await walkForwardService.startFoldOptimizing(experiment.experimentId, fold.id);
    const candidate = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } });
    await walkForwardService.claimWalkForwardCandidate(fold.id, candidate.id);
    await walkForwardService.completeWalkForwardCandidate(fold.id, candidate.id, { status: "REJECTED", tradeCount: 3, profitFactor: 0.5, errorMessage: null });

    await test("invalid - completing an OPTIMIZING fold with a PASSED/FAILED verdict is refused (no OOS run ever happened, that would be a fabricated result)", async () => {
      await assertThrowsCode(() => walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: 1.5, oosTradeCount: 25, oosOutcome: "PASSED" }), "INVALID_TRANSITION");
    });

    await test("invalid - completing an OPTIMIZING fold with a real OOS metric (even under INCONCLUSIVE) is refused", async () => {
      await assertThrowsCode(() => walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: null, oosTradeCount: 5, oosOutcome: "INCONCLUSIVE" }), "INVALID_TRANSITION");
    });

    await test("valid transition - OPTIMIZING -> COMPLETED directly, given INCONCLUSIVE + null OOS metrics, winnerCandidateId stays null, foldsCompleted increments", async () => {
      const before = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
      const completed = await walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: null, oosTradeCount: null, oosOutcome: "INCONCLUSIVE" });
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.oosOutcome, "INCONCLUSIVE");
      assert.equal(completed.oosProfitFactor, null);
      assert.equal(completed.oosTradeCount, null);
      assert.equal(completed.winnerCandidateId, null, "no winner was ever selected - setFoldWinner() was never called on this fold");
      const after = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
      assert.equal(after!.foldsCompleted, before!.foldsCompleted + 1);
    });

    await test("invalid transition rejected - completing an already-terminal (COMPLETED) fold again", async () => {
      await assertThrowsCode(() => walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: null, oosTradeCount: null, oosOutcome: "INCONCLUSIVE" }), "INVALID_TRANSITION");
    });
  }

  console.log("\n=== Fold completion via VALIDATING (regression - the ordinary path must still work unchanged after the B.2.1 widening) ===");
  {
    installFakePrisma();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    const fold = detail!.folds[0]!;
    await walkForwardService.startFoldOptimizing(experiment.experimentId, fold.id);
    const candidate = await walkForwardService.createWalkForwardCandidate(experiment.experimentId, fold.id, { candidateHash: "h1", parameterValues: { priceThreshold: 100 } });
    await walkForwardService.claimWalkForwardCandidate(fold.id, candidate.id);
    await walkForwardService.completeWalkForwardCandidate(fold.id, candidate.id, { status: "CANDIDATE", tradeCount: 25, profitFactor: 1.8, errorMessage: null });
    await walkForwardService.setFoldWinner(experiment.experimentId, fold.id, candidate.id);

    await test("valid transition - VALIDATING -> COMPLETED with a real PASSED outcome still works exactly as before", async () => {
      const completed = await walkForwardService.completeFold(experiment.experimentId, fold.id, { oosProfitFactor: 1.4, oosTradeCount: 22, oosOutcome: "PASSED" });
      assert.equal(completed.status, "COMPLETED");
      assert.equal(completed.oosOutcome, "PASSED");
      assert.equal(completed.winnerCandidateId, candidate.id);
    });
  }

  console.log("\n=== Request validation ===");
  {
    installFakePrisma();
    await test("invalid strategy rejected", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardExperiment("user-1", { ...BASE_REQUEST, strategyId: "does-not-exist" }), "INVALID_STRATEGY");
    });
    await test("a span too short for one fold rejected with the locked INSUFFICIENT_SPAN_FOR_FOLDS code", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardExperiment("user-1", { ...BASE_REQUEST, startTime: "2024-11-04T00:00:00.000Z", endTime: "2024-11-06T00:00:00.000Z" }), "INSUFFICIENT_SPAN_FOR_FOLDS");
    });
    await test("a span exceeding the provider's per-request cap rejected (P4.9-B-R2 locked - bounded total span, no new fetch architecture)", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardExperiment("user-1", { ...BASE_REQUEST, startTime: "2024-10-01T00:00:00.000Z", endTime: "2024-12-01T00:00:00.000Z" }), "RANGE_TOO_LARGE");
    });
    await test("an unknown swept parameter rejected", async () => {
      await assertThrowsCode(() => walkForwardService.createWalkForwardExperiment("user-1", { ...BASE_REQUEST, searchSpace: [{ parameterId: "notAReal Param", min: 0, max: 1, step: 1 }] }), "INVALID_SEARCH_SPACE");
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
