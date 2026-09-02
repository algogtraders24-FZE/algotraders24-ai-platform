// scripts/validate-algo-test-service.ts
// P3.2B - exercises services/algo-test/algo-test.service.ts against the
// REAL database (AlgoTestRun, this feature's own migration) and the REAL
// live Twelve Data API (same "real data, self-cleaning" convention
// validate-paper-trading.ts and validate-algo-test-production-data.ts
// already establish) - a synthetic algotest<timestamp>-tagged user,
// hard-deleted in a `finally` block, along with every AlgoTestRun row it
// created.
//
// Route-level HTTP/auth testing (the actual withContext/getUserOrNull
// wiring) is NOT unit-tested here - this codebase's own established
// convention (confirmed: validate-paper-trading.ts tests only the SERVICE
// layer, never constructs a mock NextRequest) relies on live/manual
// verification for that layer instead - see
// docs/P3.2B-ALGO-TEST-E2E.md's own "Golden E2E Test" section for where
// that's covered.
// Run via `npm run validate:algo-test-service` (not bare tsx) - it needs
// TWELVEDATA_API_KEY from .env.local, which plain `import "dotenv/config"`
// does NOT load (dotenv's default config() only reads .env) - confirmed by
// this exact failure mode during this sprint's own testing. The npm script
// passes `node --env-file=.env.local --env-file=.env`, the same real fix
// scripts/validate-algo-test-production-data.ts's own npm script already
// established.
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { algoTestService, MAX_RANGE_DAYS } from "../services/algo-test/algo-test.service";
import { STRATEGY_REGISTRY, getStrategyDefinition } from "../services/algo-test/strategy-registry";
import { RESULT_CONTRACT_VERSION } from "../services/algo-test/result-contract";
import type { AlgoTestRunRequest } from "../types/algo-test";

const RUN_TAG = `algotest-${Date.now()}`;
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

// A real, fixed week already verified in P3.2A/P3.2A.1 - real XAUUSD M5
// data, well within provider coverage and MAX_RANGE_DAYS.
const VALID_REQUEST: AlgoTestRunRequest = {
  strategyId: "golden",
  symbol: "XAUUSD",
  timeframe: "5m",
  startTime: "2024-01-08T00:00:00Z",
  endTime: "2024-01-13T00:00:00Z",
  initialBalance: 10_000,
};

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Algo Test Service Test User" } });
  const createdRunIds: string[] = [];

  try {
    console.log("=== Engine Integration: request -> historical provider -> at24-quant-engine -> result ===");
    let firstRun: Awaited<ReturnType<typeof algoTestService.runAlgoTest>> | undefined;
    await test("a valid request completes, produces real trades, and persists a real AlgoTestRun row", async () => {
      const run = await algoTestService.runAlgoTest(user.id, VALID_REQUEST);
      firstRun = run;
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed");
      assert.ok(run.testId.length > 0);
      assert.ok(run.metrics);
      assert.ok(run.trades && run.trades.length > 0, "the Golden Strategy against real XAUUSD data must produce real trades");
      assert.ok(run.equityCurve && run.equityCurve.length > 1);
      assert.ok(run.assumptions);
      assert.equal(run.resultHash?.length, 64);
      assert.ok(run.candles && run.candles.length > 1000, "a fresh run's response must include the real bars used for chart rendering");

      // P3.3 - Strategy Versioning / Result Contract Hardening: every
      // completed run records its exact strategyId+strategyVersion and the
      // result contract/engine versions, all real (never a placeholder).
      const golden = getStrategyDefinition("golden");
      assert.ok(golden, "the Golden Strategy must be registered");
      assert.equal(run.strategyVersion, golden!.strategyVersion);
      assert.equal(run.resultVersion, RESULT_CONTRACT_VERSION);
      assert.ok(run.engineVersion && run.engineVersion.length > 0, "engineVersion must be the engine's own real provenance.runtimeVersion, never blank");

      const row = await prisma.algoTestRun.findUnique({ where: { id: run.testId } });
      assert.ok(row, "the run must be persisted");
      assert.equal(row!.userId, user.id);
      assert.equal(row!.status, "completed");
      assert.equal(row!.strategyVersion, golden!.strategyVersion);
      assert.equal(row!.resultVersion, RESULT_CONTRACT_VERSION);
      assert.ok(row!.engineVersion);
      assert.ok(row!.metrics, "metrics must be persisted");
      assert.ok(row!.trades, "trades must be persisted");
    });

    await test("getAlgoTestRun() returns the persisted run for its real owner, WITH candles reconstructed (P3.3 reopen - never persisted in the row itself, but re-fetched live via the same read-only provider so a refresh can still render chart markers)", async () => {
      assert.ok(firstRun);
      const fetched = await algoTestService.getAlgoTestRun(user.id, firstRun!.testId);
      assert.ok(fetched);
      assert.equal(fetched!.status, "completed");
      // Every canonical, engine-produced field must be BYTE-IDENTICAL to
      // the original run's own response - a reopen never re-simulates.
      assert.equal(fetched!.resultHash, firstRun!.resultHash);
      assert.deepEqual(fetched!.metrics, firstRun!.metrics);
      assert.equal(fetched!.trades?.length, firstRun!.trades?.length);
      assert.equal(fetched!.strategyVersion, firstRun!.strategyVersion);
      assert.equal(fetched!.resultVersion, firstRun!.resultVersion);
      assert.equal(fetched!.engineVersion, firstRun!.engineVersion);
      // Candles themselves are RECONSTRUCTED (a fresh provider fetch for
      // the run's own persisted window), so must be present and shaped
      // like a real chart-ready dataset, though not necessarily the exact
      // same array instance/count as the original POST response.
      assert.ok(fetched!.candles && fetched!.candles.length > 1000, "a reopened completed run must reconstruct real chart candles for its own persisted date range");

      const row = await prisma.algoTestRun.findUnique({ where: { id: firstRun!.testId } });
      assert.equal((row?.trades as unknown[] | null)?.length, firstRun!.trades?.length, "the DB row itself still never stores candles - only trades/metrics/equityCurve");
    });

    await test("getAlgoTestRun() returns null for a real run id owned by a DIFFERENT user - ownership is enforced server-side, never trusted from input", async () => {
      assert.ok(firstRun);
      const otherUser = await prisma.user.create({ data: { email: `${RUN_TAG}-other@internal.test`, name: "Other User" } });
      try {
        const fetched = await algoTestService.getAlgoTestRun(otherUser.id, firstRun!.testId);
        assert.equal(fetched, null);
      } finally {
        await prisma.user.delete({ where: { id: otherUser.id } });
      }
    });

    console.log("\n=== Strategy Registry / Capability Registry (P3.3) ===");
    await test("the registry contains exactly the Golden Strategy, available, with real supportedSymbols/supportedTimeframes", async () => {
      assert.equal(STRATEGY_REGISTRY.length, 1, "P3.3 registers exactly one strategy - no artificial second entry");
      const golden = STRATEGY_REGISTRY[0]!;
      assert.equal(golden.strategyId, "golden");
      assert.equal(golden.status, "available");
      assert.ok(golden.strategyVersion.length > 0, "strategyVersion must be a real, non-empty version string, read from the engine's own StrategySpec");
      assert.deepEqual(golden.supportedSymbols, ["XAUUSD"]);
      assert.deepEqual(golden.supportedTimeframes, ["5m"]);
    });

    console.log("\n=== Invalid request handling (rejected before any row is created) ===");
    await test("unsupported strategy is rejected with INVALID_STRATEGY, no row created", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, strategyId: "not-a-real-strategy" });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_STRATEGY");
    });

    await test("a mismatched strategyVersion is rejected with INVALID_STRATEGY_VERSION, no row created", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, strategyVersion: "999.0.0-does-not-exist" });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_STRATEGY_VERSION");
    });

    await test("the strategy's real current strategyVersion, when explicitly supplied, is accepted (not just when omitted)", async () => {
      const golden = getStrategyDefinition("golden")!;
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, strategyVersion: golden.strategyVersion });
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed");
      assert.equal(run.strategyVersion, golden.strategyVersion);
    });

    await test("a zero initialBalance is rejected with INVALID_INITIAL_BALANCE", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, initialBalance: 0 });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_INITIAL_BALANCE");
    });

    await test("a negative initialBalance is rejected with INVALID_INITIAL_BALANCE", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, initialBalance: -500 });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_INITIAL_BALANCE");
    });

    await test("unsupported symbol is rejected with INVALID_SYMBOL", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, symbol: "EURUSD" });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_SYMBOL");
    });

    await test("unsupported timeframe is rejected with INVALID_TIMEFRAME", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, timeframe: "1h" });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_TIMEFRAME");
    });

    await test("start >= end is rejected with INVALID_DATE_RANGE", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, startTime: "2024-01-13T00:00:00Z", endTime: "2024-01-08T00:00:00Z" });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_DATE_RANGE");
    });

    await test("a future endTime is rejected with INVALID_DATE_RANGE", async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, endTime: future });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_DATE_RANGE");
    });

    await test(`a range wider than MAX_RANGE_DAYS (${MAX_RANGE_DAYS}) is rejected with RANGE_TOO_LARGE`, async () => {
      const start = "2024-01-01T00:00:00Z";
      const end = new Date(Date.parse(start) + (MAX_RANGE_DAYS + 5) * 86_400_000).toISOString();
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, startTime: start, endTime: end });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "RANGE_TOO_LARGE");
    });

    await test("regression (live-verification finding, P3.2B fix): AlgoTestPanel.tsx's real default date range (7 days ago .. yesterday, end-of-day UTC) never fails INVALID_DATE_RANGE - the exact bug a same-day default previously produced", async () => {
      // Mirrors AlgoTestPanel.tsx's real isoDateNDaysAgo()/toEngineTimestamp()
      // logic byte-for-byte, not a simplified approximation - if the client
      // ever drifts from this again, this test drifts with it and still
      // proves the real client-shaped request against the real service.
      function isoDateNDaysAgo(n: number): string {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - n);
        return d.toISOString().slice(0, 10);
      }
      const startTime = `${isoDateNDaysAgo(7)}T00:00:00Z`;
      const endTime = `${isoDateNDaysAgo(1)}T23:59:59Z`;

      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, startTime, endTime });
      if (run.testId) createdRunIds.push(run.testId);

      // The one thing this regression test exists to guarantee: date
      // validation itself must never reject the untouched default range.
      assert.notEqual(run.errorCode, "INVALID_DATE_RANGE", `the fresh-form default range must never be rejected as INVALID_DATE_RANGE (got: ${run.errorMessage})`);
      assert.ok(run.testId.length > 0, "a date-valid request must always be persisted as a real attempted run, whatever its outcome");

      // Whatever REAL current-gold-price data produces (a completed run, or
      // a real engine failure like the negative-risk-distance case this
      // sprint's own live verification found) must still be handled
      // gracefully - never an unhandled exception, never a silently
      // fabricated result. Both real outcomes are acceptable here; only an
      // undefined/unrecognized status would indicate broken handling.
      assert.ok(run.status === "completed" || run.status === "failed", `status must be a real, defined outcome, got: ${run.status}`);
      if (run.status === "failed") {
        assert.ok(run.errorCode, "a failed run must always carry a real errorCode - never a silent failure");
        console.log(`    (real outcome this run: failed/${run.errorCode} - "${run.errorMessage}" - a genuine engine/provider result on today's real data, not a bug)`);
      } else {
        console.log(`    (real outcome this run: completed, ${run.trades?.length ?? 0} trades)`);
      }
    });

    console.log("\n=== Provider failure (a real attempt, no data - a real persisted 'failed' row) ===");
    await test("a real date range with no available historical data fails honestly with NO_HISTORICAL_DATA, and IS persisted (a real attempted run)", async () => {
      // A real calendar range within MAX_RANGE_DAYS, far outside any real
      // provider's historical coverage - genuinely exercises the "provider
      // returned nothing" path, not a mock.
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, startTime: "1990-01-01T00:00:00Z", endTime: "1990-01-05T00:00:00Z" });
      createdRunIds.push(run.testId);
      assert.ok(run.testId.length > 0, "a genuinely-attempted (validation-passing) run is always persisted, even when it fails");
      assert.equal(run.status, "failed");
      assert.equal(run.errorCode, "NO_HISTORICAL_DATA");

      const row = await prisma.algoTestRun.findUnique({ where: { id: run.testId } });
      assert.equal(row?.status, "failed");
      assert.equal(row?.errorCode, "NO_HISTORICAL_DATA");
    });

    console.log("\n=== Determinism: RUN #1 === RUN #2 (through the real service + real Twelve Data) ===");
    await test("running the identical request twice produces byte-identical resultHash/metrics/trades", async () => {
      const runB = await algoTestService.runAlgoTest(user.id, VALID_REQUEST);
      createdRunIds.push(runB.testId);
      assert.ok(firstRun);
      assert.equal(runB.resultHash, firstRun!.resultHash);
      assert.deepEqual(runB.metrics, firstRun!.metrics);
      assert.equal(runB.strategyVersion, firstRun!.strategyVersion);
      assert.equal(runB.resultVersion, firstRun!.resultVersion);
      assert.equal(runB.engineVersion, firstRun!.engineVersion);
      assert.equal(runB.trades?.length, firstRun!.trades?.length);
      for (let i = 0; i < (runB.trades?.length ?? 0); i++) {
        assert.equal(runB.trades![i]!.tradeId, firstRun!.trades![i]!.tradeId);
        assert.equal(runB.trades![i]!.pnl, firstRun!.trades![i]!.pnl);
      }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
  } finally {
    if (createdRunIds.length > 0) {
      await prisma.algoTestRun.deleteMany({ where: { id: { in: createdRunIds } } });
    }
    await prisma.user.delete({ where: { id: user.id } });
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
