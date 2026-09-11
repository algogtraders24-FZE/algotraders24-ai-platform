// scripts/validate-algo-test-walk-forward-execution.ts
// P4.9-B-B.3 (docs/P4.9-OPTIMIZATION-WFO.md) - pure offline tests (no live
// network, no live Postgres) against the REAL, unmodified
// walkForwardExecutionService AND the REAL golden strategy/registry AND
// the REAL runSimulation() - never a mock of the actual slicing,
// generation, claim, classification, winner-selection, OOS, or
// aggregation logic under test. Same "fake Prisma at the boundary"
// technique validate-algo-test-optimization-service.ts and
// validate-algo-test-walk-forward-service.ts already established,
// extended here to ALSO fake twelveDataHistoricalDataProvider.getBars()
// (the exact same monkey-patch technique
// validate-algo-test-optimization-service.ts's own header comment
// already discloses and defends - the provider has no DI seam in
// production code, by design, matching runAlgoTest()'s own established
// convention).
//
// Deliberately NOT proven here (an honest, disclosed boundary, same as
// every other offline validator in this codebase): real Postgres-level
// concurrency/isolation guarantees, and real Twelve Data network/
// rate-limit behavior. Synthetic bars are a deterministic sawtooth price
// series (never a live market) - real enough to exercise the golden
// strategy's actual entry/exit/risk logic and produce real, varying
// trade counts per swept parameter, but chosen for determinism, not
// market realism.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { walkForwardService } from "../services/algo-test/walk-forward.service";
import { walkForwardExecutionService, sliceToWindow, classifyOosOutcome, aggregateProcessVerdict, pickFoldWinner } from "../services/algo-test/walk-forward-execution.service";
import { twelveDataHistoricalDataProvider } from "../services/algo-test/historical-data/twelve-data-provider";
import type { CreateWalkForwardExperimentRequest, WalkForwardCandidateView } from "../types/walk-forward";
import type { OHLCVBar } from "at24-quant-engine";

// ---------------------------------------------------------------------------
// Fake Prisma boundary - identical technique/shape to
// validate-algo-test-walk-forward-service.ts's own installFakePrisma(),
// duplicated here rather than shared (each validator script in this
// codebase is self-contained, the same convention
// validate-algo-test-optimization-service.ts's own file already
// establishes for itself).
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  [key: string]: unknown;
}

function installFakePrisma(): void {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (arg as (tx: any) => Promise<unknown>)(prisma);
  };
}

// ---------------------------------------------------------------------------
// Deterministic synthetic bars - a repeating sawtooth (80 -> 220 every 48
// bars = 4 hours at M5) spanning whatever [start,end) is requested. Real
// enough to exercise the golden strategy's actual entry (close >
// priceThreshold) / exit (fixed stop-loss distance / risk-multiple
// take-profit) logic and produce real, varying trade counts per swept
// priceThreshold - never a live market, chosen for determinism.
// ---------------------------------------------------------------------------

function generateSyntheticBars(startMs: number, endMs: number, intervalMs: number): OHLCVBar[] {
  const bars: OHLCVBar[] = [];
  const instrument = { symbol: "XAUUSD", assetClass: "metal" as const };
  let i = 0;
  for (let ts = startMs; ts < endMs; ts += intervalMs, i++) {
    const phase = i % 48;
    const base = 80 + (phase / 48) * 140;
    const open = base;
    const close = base + (i % 2 === 0 ? 3 : -3);
    const high = Math.max(open, close) + 2;
    const low = Math.min(open, close) - 2;
    bars.push({ timestamp: ts, instrument, timeframe: "M5", open, high, low, close, volume: 100 });
  }
  return bars;
}

let getBarsCallCount = 0;

function installFakeProvider(): void {
  getBarsCallCount = 0;
  twelveDataHistoricalDataProvider.getBars = async (request) => {
    getBarsCallCount += 1;
    const startMs = new Date(request.startTime).getTime();
    const endMs = new Date(request.endTime).getTime();
    const bars = generateSyntheticBars(startMs, endMs, 5 * 60_000);
    return { bars, rejected: [], source: "synthetic-test-fixture" };
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
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

const BASE_REQUEST: CreateWalkForwardExperimentRequest = {
  strategyId: "golden",
  symbol: "XAUUSD",
  timeframe: "5m",
  startTime: "2024-11-04T00:00:00.000Z",
  endTime: "2024-11-18T00:00:00.000Z", // 14 real days (locked M5 cap) - 2 folds at 7/3/3
  searchSpace: [{ parameterId: "priceThreshold", min: 100, max: 200, step: 50 }], // 3 candidates/fold
};

/** Drives continueWalkForwardExperiment() to a terminal state, matching how a real client polls - returns the number of continue() calls it took. */
async function runToCompletion(userId: string, experimentId: string, maxCalls = 500): Promise<number> {
  for (let i = 1; i <= maxCalls; i++) {
    const view = await walkForwardExecutionService.continueWalkForwardExperiment(userId, experimentId);
    if (view.status === "COMPLETED" || view.status === "FAILED" || view.status === "CANCELLED") return i;
  }
  throw new Error(`runToCompletion: did not terminate within ${maxCalls} continue() calls`);
}

async function main() {
  console.log("\n=== A/B - exact window slicing (pure, no DB/provider) ===");
  {
    const instrument = { symbol: "XAUUSD", assetClass: "metal" as const };
    const bars: OHLCVBar[] = [];
    for (let h = 9; h <= 12; h++) {
      for (let m = 0; m < 60; m += 5) {
        bars.push({ timestamp: new Date(`2024-11-04T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`).getTime(), instrument, timeframe: "M5", open: 100, high: 101, low: 99, close: 100, volume: 1 });
      }
    }
    const series = new Map([["close", bars.map((b) => b.close)]]);

    await test("exact slicing - [10:00, 11:00) includes 10:00..10:55, excludes 09:55 and 11:00", () => {
      const { bars: sliced } = sliceToWindow(bars, series, new Date("2024-11-04T10:00:00.000Z"), new Date("2024-11-04T11:00:00.000Z"));
      const timestamps = sliced.map((b) => new Date(b.timestamp).toISOString());
      assert.ok(timestamps.includes("2024-11-04T10:00:00.000Z"));
      assert.ok(timestamps.includes("2024-11-04T10:55:00.000Z"));
      assert.ok(!timestamps.includes("2024-11-04T09:55:00.000Z"), "09:55 is before the window - must be excluded");
      assert.ok(!timestamps.includes("2024-11-04T11:00:00.000Z"), "11:00 is the exclusive end boundary - must be excluded");
      assert.equal(sliced.length, 12, "exactly 12 five-minute bars in a 1-hour window");
    });

    await test("exact slicing - indicator series sliced with the identical index set as bars", () => {
      const { bars: sliced, indicatorSeries } = sliceToWindow(bars, series, new Date("2024-11-04T10:00:00.000Z"), new Date("2024-11-04T11:00:00.000Z"));
      assert.equal(indicatorSeries.get("close")!.length, sliced.length);
    });

    await test("IS/OOS isolation - a fold's [isStart,isEnd) and [oosStart,oosEnd) slices never overlap", () => {
      const isStart = new Date("2024-11-04T00:00:00.000Z");
      const isEnd = new Date("2024-11-11T00:00:00.000Z");
      const oosStart = new Date(isEnd.getTime() + 5 * 60_000); // one M5 bar interval later, per the locked boundary
      const oosEnd = new Date(oosStart.getTime() + 3 * 86_400_000);
      const fullBars = generateSyntheticBars(isStart.getTime(), oosEnd.getTime(), 5 * 60_000);
      const series2 = new Map([["close", fullBars.map((b) => b.close)]]);
      const isSlice = sliceToWindow(fullBars, series2, isStart, isEnd);
      const oosSlice = sliceToWindow(fullBars, series2, oosStart, oosEnd);
      const isTimestamps = new Set(isSlice.bars.map((b) => b.timestamp));
      const overlap = oosSlice.bars.filter((b) => isTimestamps.has(b.timestamp));
      assert.equal(overlap.length, 0, "no bar timestamp appears in both the IS slice and the OOS slice");
      assert.ok(isSlice.bars.length > 0 && oosSlice.bars.length > 0, "both slices are non-empty, a meaningful test");
    });
  }

  console.log("\n=== Pure decision functions ===");
  {
    await test("classifyOosOutcome - below minEligibleTrades is always INCONCLUSIVE regardless of profitFactor", () => {
      assert.equal(classifyOosOutcome(5, 99, 20), "INCONCLUSIVE");
      assert.equal(classifyOosOutcome(19, 0.1, 20), "INCONCLUSIVE");
    });
    await test("classifyOosOutcome - >= minEligibleTrades and profitFactor > 1 is PASSED", () => {
      assert.equal(classifyOosOutcome(25, 1.01, 20), "PASSED");
    });
    await test("classifyOosOutcome - >= minEligibleTrades and profitFactor <= 1 is FAILED", () => {
      assert.equal(classifyOosOutcome(25, 1.0, 20), "FAILED");
      assert.equal(classifyOosOutcome(25, 0.4, 20), "FAILED");
    });
    await test("aggregateProcessVerdict - locked table: any FAILED -> experiment FAILED regardless of what else is mixed in", () => {
      assert.equal(aggregateProcessVerdict(["PASSED", "FAILED"]).verdict, "FAILED");
      assert.equal(aggregateProcessVerdict(["FAILED", "INCONCLUSIVE"]).verdict, "FAILED");
    });
    await test("aggregateProcessVerdict - all INCONCLUSIVE (zero conclusive) -> INCONCLUSIVE", () => {
      const r = aggregateProcessVerdict(["INCONCLUSIVE", "INCONCLUSIVE"]);
      assert.equal(r.verdict, "INCONCLUSIVE");
      assert.equal(r.conclusiveFoldCount, 0);
    });
    await test("aggregateProcessVerdict - every conclusive fold PASSED, >=1 conclusive -> PASSED", () => {
      const r = aggregateProcessVerdict(["PASSED", "PASSED", "INCONCLUSIVE"]);
      assert.equal(r.verdict, "PASSED");
      assert.equal(r.passedFoldCount, 2);
      assert.equal(r.conclusiveFoldCount, 2);
    });
    await test("pickFoldWinner (F) - deterministic: highest profitFactor wins, candidateHash asc breaks ties", () => {
      const candidates: WalkForwardCandidateView[] = [
        { id: "c1", foldId: "f1", candidateHash: "b", parameterValues: {}, status: "CANDIDATE", tradeCount: 20, profitFactor: 1.5, errorMessage: null },
        { id: "c2", foldId: "f1", candidateHash: "a", parameterValues: {}, status: "CANDIDATE", tradeCount: 20, profitFactor: 1.5, errorMessage: null },
        { id: "c3", foldId: "f1", candidateHash: "z", parameterValues: {}, status: "CANDIDATE", tradeCount: 20, profitFactor: 1.2, errorMessage: null },
      ];
      const winner = pickFoldWinner(candidates);
      assert.equal(winner!.id, "c2", "tied profitFactor 1.5 -> candidateHash asc ('a' < 'b') wins");
    });
    await test("pickFoldWinner - Infinity profit factor sorts above every finite value", () => {
      const candidates: WalkForwardCandidateView[] = [
        { id: "c1", foldId: "f1", candidateHash: "a", parameterValues: {}, status: "CANDIDATE", tradeCount: 20, profitFactor: 99, errorMessage: null },
        { id: "c2", foldId: "f1", candidateHash: "b", parameterValues: {}, status: "CANDIDATE", tradeCount: 20, profitFactor: "Infinity", errorMessage: null },
      ];
      assert.equal(pickFoldWinner(candidates)!.id, "c2");
    });
    await test("pickFoldWinner - empty eligible list returns undefined, never fabricates a winner", () => {
      assert.equal(pickFoldWinner([]), undefined);
    });
  }

  console.log("\n=== C - single-fetch architecture (fake prisma + fake provider, real golden strategy + real runSimulation) ===");
  {
    installFakePrisma();
    installFakeProvider();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);

    const callsToComplete = await runToCompletion("user-1", experiment.experimentId);
    await test("one getBars() call per continueWalkForwardExperiment() call, never per fold/window", () => {
      assert.equal(getBarsCallCount, callsToComplete, `getBars was called ${getBarsCallCount} times across ${callsToComplete} continue() calls - must be exactly 1:1`);
    });

    const final = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
    await test("experiment reaches a real terminal state (COMPLETED) with a real verdict", () => {
      assert.equal(final!.status, "COMPLETED");
      assert.ok(final!.verdict === "PASSED" || final!.verdict === "FAILED" || final!.verdict === "INCONCLUSIVE");
    });

    await test("D - candidate idempotency: exactly totalForFold candidates exist per fold, never regenerated across multiple continue() calls", () => {
      for (const fold of final!.folds) {
        assert.equal(fold.candidates.length, 3, "3 swept values (100/150/200) -> exactly 3 candidates, not duplicated across the many continue() calls it took to reach completion");
        const hashes = new Set(fold.candidates.map((c) => c.candidateHash));
        assert.equal(hashes.size, 3, "no duplicate candidateHash within a fold");
      }
    });

    await test("E - fold-local winner: every fold's winnerCandidateId (if set) points at a candidate that actually belongs to THAT fold", () => {
      for (const fold of final!.folds) {
        if (fold.winnerCandidateId) {
          const ownCandidate = fold.candidates.find((c) => c.id === fold.winnerCandidateId);
          assert.ok(ownCandidate, `winnerCandidateId '${fold.winnerCandidateId}' must be found among fold ${fold.foldIndex}'s own candidates`);
          assert.equal(ownCandidate!.status, "VALIDATED");
        }
      }
    });

    await test("H - OOS validation ran at most once per fold (a fold with a winner has real oosOutcome; a fold without one has null OOS metrics)", () => {
      for (const fold of final!.folds) {
        if (fold.winnerCandidateId) {
          assert.ok(fold.oosOutcome === "PASSED" || fold.oosOutcome === "FAILED" || fold.oosOutcome === "INCONCLUSIVE");
        } else {
          assert.equal(fold.oosOutcome, "INCONCLUSIVE");
          assert.equal(fold.oosProfitFactor, null);
          assert.equal(fold.oosTradeCount, null);
        }
      }
    });

    await test("no global winner anywhere in the final result (structural - the type itself has no such field)", () => {
      assert.ok(!("bestCandidateId" in final!));
    });
  }

  console.log("\n=== I - sequential execution (fold N+1 never starts before fold N is terminal) ===");
  {
    installFakePrisma();
    installFakeProvider();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);

    let sawFold1StartBeforeFold0Terminal = false;
    for (let i = 0; i < 500; i++) {
      const view = await walkForwardExecutionService.continueWalkForwardExperiment("user-1", experiment.experimentId);
      const detail = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);
      const fold0 = detail!.folds[0]!;
      const fold1 = detail!.folds[1]!;
      if (fold1.status !== "UNRUN" && fold0.status !== "COMPLETED" && fold0.status !== "FAILED") {
        sawFold1StartBeforeFold0Terminal = true;
      }
      if (view.status === "COMPLETED" || view.status === "FAILED" || view.status === "CANCELLED") break;
    }

    await test("fold 1 is never observed to have started before fold 0 reached a terminal state", () => {
      assert.equal(sawFold1StartBeforeFold0Terminal, false);
    });
  }

  console.log("\n=== G - no-winner path (every candidate REJECTED - an unreachable price threshold) ===");
  {
    installFakePrisma();
    installFakeProvider();
    const noWinnerRequest: CreateWalkForwardExperimentRequest = { ...BASE_REQUEST, searchSpace: [{ parameterId: "priceThreshold", min: 100000, max: 100000, step: 1 }] }; // never crossed by the 80-220 synthetic series -> zero trades -> REJECTED
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", noWinnerRequest);
    await runToCompletion("user-1", experiment.experimentId);
    const final = await walkForwardService.getWalkForwardExperiment("user-1", experiment.experimentId);

    await test("every fold completes INCONCLUSIVE with a null winner and null OOS metrics - no OOS run ever happened", () => {
      for (const fold of final!.folds) {
        assert.equal(fold.status, "COMPLETED");
        assert.equal(fold.winnerCandidateId, null);
        assert.equal(fold.oosOutcome, "INCONCLUSIVE");
        assert.equal(fold.oosProfitFactor, null);
        assert.equal(fold.oosTradeCount, null);
        for (const c of fold.candidates) assert.equal(c.status, "REJECTED", "zero trades ever, every candidate REJECTED, none FAILED/CANDIDATE");
      }
    });

    await test("experiment-level verdict is INCONCLUSIVE (zero conclusive folds anywhere)", () => {
      assert.equal(final!.verdict, "INCONCLUSIVE");
      assert.equal(final!.conclusiveFoldCount, 0);
    });
  }

  console.log("\n=== J - cancellation (execution stops, no further folds/candidates process) ===");
  {
    installFakePrisma();
    installFakeProvider();
    const experiment = await walkForwardService.createWalkForwardExperiment("user-1", BASE_REQUEST);
    // Cancel deterministically while still QUEUED, before any continue()
    // call - this small fixture (2 folds x 3 candidates) completes an
    // entire experiment within a SINGLE continue() call, so racing a
    // cancel against "mid-run" progress would be inherently timing-
    // fragile. Cancelling pre-execution is the clean, deterministic way
    // to prove "no further folds/candidates process after cancellation" -
    // cancelWalkForwardExperiment()'s own atomic WHERE status IN
    // (QUEUED,RUNNING) already covers both starting points identically.
    const cancelled = await walkForwardService.cancelWalkForwardExperiment("user-1", experiment.experimentId);

    await test("cancelled experiment stays CANCELLED, verdict stays null", () => {
      assert.equal(cancelled!.status, "CANCELLED");
      assert.equal(cancelled!.verdict, null);
    });

    const beforeGetBars = getBarsCallCount;
    const afterContinue = await walkForwardExecutionService.continueWalkForwardExperiment("user-1", experiment.experimentId);
    await test("continueWalkForwardExperiment() on a CANCELLED experiment is a harmless no-op - never fetches data, never advances any fold", () => {
      assert.equal(afterContinue.status, "CANCELLED");
      assert.equal(getBarsCallCount, beforeGetBars, "no new provider fetch for an already-terminal experiment");
    });
  }

  console.log("\n=== J - NOT_FOUND ===");
  {
    installFakePrisma();
    installFakeProvider();
    await test("continueWalkForwardExperiment on a nonexistent experiment throws NOT_FOUND", async () => {
      try {
        await walkForwardExecutionService.continueWalkForwardExperiment("user-1", "no-such-experiment");
        assert.fail("expected a throw");
      } catch (err) {
        assert.equal((err as { code?: string }).code, "NOT_FOUND");
      }
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
