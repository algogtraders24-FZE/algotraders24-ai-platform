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
import {
  GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
  GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
  GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
  GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
} from "at24-quant-engine";

import type { AlgoTestRunRequest } from "../types/algo-test";

// P3.5 - validateParameterValues() always returns every declared parameter,
// defaults filled in, never a partial object - see strategy-registry.ts's
// own doc comment. This is the one place that full default snapshot is
// spelled out for the "golden" registry entry, reused by every assertion
// below that checks a persisted/returned `parameters` object against "the
// registered defaults, nothing submitted".
const GOLDEN_DEFAULT_PARAMETERS = {
  priceThreshold: GOLDEN_STRATEGY_DEFAULT_PRICE_THRESHOLD,
  positionSizeQuantity: GOLDEN_STRATEGY_DEFAULT_POSITION_SIZE_QUANTITY,
  stopLossDistance: GOLDEN_STRATEGY_DEFAULT_STOP_LOSS_DISTANCE,
  takeProfitRMultiple: GOLDEN_STRATEGY_DEFAULT_TAKE_PROFIT_R_MULTIPLE,
};

// P3.4 section 22 - the EXACT resultHash this exact canonical request
// (VALID_REQUEST below: Golden Strategy defaults, XAUUSD/M5,
// 2024-01-08T00:00:00Z..2024-01-13T00:00:00Z, $10,000) produces under
// pre-P3.4 code, verified directly (not assumed) by checking out
// origin/main at a8e0812 (the P3.3-merged commit, before any P3.4 change)
// into an isolated worktree and running this identical request against
// it - NOT the resultHash from this program's live browser E2E session,
// which used a different endTime (23:59:59Z end-of-day, per
// AlgoTestPanel.tsx's own toEngineTimestamp) and is therefore a genuinely
// different request with its own different (also-unchanged-by-P3.4)
// hash - see docs/P3.4-STRATEGY-PARAMETERS.md's compatibility section for
// the full investigation. P3.4's default configuration MUST reproduce
// this exactly - if this constant ever needs to change, that is itself
// the STOP condition section 22 describes, not a routine update.
const P3_3_CANONICAL_RESULT_HASH = "0522a91f136d6c94b757482aab7ef3f640f4c4192af8356b8362b449a9bf527f";
const P3_3_CANONICAL_TRADE_COUNT = 26;

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

      // P3.4 section 22 (Golden Strategy Compatibility Requirement) - THE
      // hardest gate in this whole sprint: with registered defaults, this
      // exact canonical request must reproduce P3.3's own exact resultHash
      // and trade count, byte-for-byte. If this ever fails, the fix is to
      // investigate the real difference, never to update the recorded
      // canonical constants above.
      assert.equal(run.metrics!.tradeCount, P3_3_CANONICAL_TRADE_COUNT, "the default (no parameters submitted) canonical run must still produce exactly the P3.3 baseline's 26 trades");
      assert.equal(run.resultHash, P3_3_CANONICAL_RESULT_HASH, "the default configuration's resultHash must be BYTE-IDENTICAL to the live-verified P3.3 canonical baseline - a P3.4 implementation detail must never change what P3.3 already proved correct");

      // P3.8 - the real, live-verified lifecycle: a real completed run
      // against real historical data, with real trades, must reach
      // EVIDENCE_VERIFIED and be reported fullyVerified - the strongest,
      // most end-to-end proof this phase's mechanism actually works (the
      // engine-level tests already prove the individual stages; this
      // proves the full composition against production infrastructure).
      assert.ok(run.lifecycle, "a completed run's response must include its lifecycle");
      assert.equal(run.lifecycle!.reachedStage, "EVIDENCE_VERIFIED");
      assert.equal(run.lifecycle!.fullyVerified, true);
      const evidenceStage = run.lifecycle!.stages.find((s) => s.stage === "EVIDENCE_VERIFIED");
      assert.ok(evidenceStage?.detail?.includes(`${P3_3_CANONICAL_TRADE_COUNT} trade`), `EVIDENCE_VERIFIED's own detail must name the real trade count, not a generic pass message - got: ${evidenceStage?.detail}`);

      // P3.4 - the fully-normalized parameter snapshot is always present
      // and persisted, even when the caller submitted none at all (the
      // registered default is what was actually used, and that fact is
      // recorded, not left implicit).
      assert.deepEqual(run.parameters, GOLDEN_DEFAULT_PARAMETERS);

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
      assert.deepEqual(row!.parameters, GOLDEN_DEFAULT_PARAMETERS, "the parameter snapshot must be persisted on the row itself, not just in the response");
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
      assert.deepEqual(fetched!.parameters, firstRun!.parameters, "P3.4 - the persisted parameter snapshot survives reopen, byte-identical, never re-derived");
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

    console.log("\n=== Strategy Parameters (P3.4) ===");
    await test("Test B - a real, non-default priceThreshold is accepted, changes actual execution (zero trades, since 2100 is above every real bar in this window), and is persisted", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, parameters: { priceThreshold: 2100 } });
      createdRunIds.push(run.testId);
      assert.equal(run.status, "completed", `expected a completed (not failed) run - got errorCode ${run.errorCode}: ${run.errorMessage}`);
      assert.deepEqual(run.parameters, { ...GOLDEN_DEFAULT_PARAMETERS, priceThreshold: 2100 }, "the exact submitted value must be what's recorded (other fields still get their own registered defaults filled in), not the default");
      assert.equal(run.metrics!.tradeCount, 0, "2100 is above every real bar's close in this window - the entry condition must never fire, a genuine zero-trade result, not an error");
      assert.notEqual(run.resultHash, P3_3_CANONICAL_RESULT_HASH, "a genuinely different parameter that changes execution must produce a genuinely different resultHash");

      const row = await prisma.algoTestRun.findUnique({ where: { id: run.testId } });
      assert.deepEqual(row?.parameters, { ...GOLDEN_DEFAULT_PARAMETERS, priceThreshold: 2100 });
    });

    // A dedicated second real network call proving determinism specifically
    // for a non-default parameter value was deliberately folded out here:
    // Twelve Data's real free-tier rate limit (8 requests/minute - hit and
    // documented live during this sprint's own test development) means
    // every real network call in this file is a scarce resource, and the
    // determinism MECHANISM itself (byte-identical resultHash for
    // identical effective inputs) is not parameter-specific - it's already
    // proven end-to-end by the "Determinism: RUN #1 === RUN #2" section
    // below using VALID_REQUEST's own default parameters. Test B's own job
    // above (accepted, genuinely changes execution, correctly persisted)
    // is the parameter-specific proof this section exists for.

    await test("an unknown parameter key is rejected with INVALID_PARAMETERS, no row created", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, parameters: { notARealParameter: 1 } });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_PARAMETERS");
    });

    await test("a wrong-typed parameter value is rejected with INVALID_PARAMETERS", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, parameters: { priceThreshold: "not-a-number" } });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_PARAMETERS");
    });

    await test("a below-minimum parameter value is rejected with INVALID_PARAMETERS", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, parameters: { priceThreshold: -1 } });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_PARAMETERS");
    });

    await test("an above-maximum parameter value is rejected with INVALID_PARAMETERS", async () => {
      const run = await algoTestService.runAlgoTest(user.id, { ...VALID_REQUEST, parameters: { priceThreshold: 2_000_000 } });
      assert.equal(run.testId, "");
      assert.equal(run.errorCode, "INVALID_PARAMETERS");
    });

    await test("backward compatibility - a pre-P3.4 row (parameters column genuinely NULL, simulating a P3.3-era run) still reopens successfully, with parameters honestly undefined (never backfilled with a guessed default)", async () => {
      const legacyRow = await prisma.algoTestRun.create({
        data: {
          userId: user.id,
          strategyId: "golden",
          strategyVersion: "1.0.0",
          symbol: "XAUUSD",
          timeframe: "5m",
          startTime: new Date("2024-01-08T00:00:00Z"),
          endTime: new Date("2024-01-13T00:00:00Z"),
          initialBalance: 10_000,
          status: "completed",
          resultHash: P3_3_CANONICAL_RESULT_HASH,
          resultVersion: RESULT_CONTRACT_VERSION,
          engineVersion: "0.1.0",
          // parameters intentionally omitted - simulates a genuine pre-P3.4 row.
          metrics: { totalReturn: 0, netProfit: 3.97, grossProfit: 0, grossLoss: 0, profitFactor: 1.05, winRate: 0.3462, expectancy: 0, maxDrawdown: 0.26, averageTrade: 0, tradeCount: 26, averageR: null, totalFees: 0 },
          trades: [],
          equityCurve: [],
          assumptions: { spread: "ZeroSpread (0 / placeholder)", slippage: "ZeroSlippage (0 / placeholder)", fees: "ZeroFee (0 / placeholder)", margin: "not enforced" },
        },
      });
      createdRunIds.push(legacyRow.id);

      const fetched = await algoTestService.getAlgoTestRun(user.id, legacyRow.id);
      assert.ok(fetched, "a pre-P3.4 row must still be readable/reopenable, not broken by the new column");
      assert.equal(fetched!.parameters, undefined, "no snapshot was ever recorded for this row - must be undefined, never silently assigned today's registered default");
      assert.equal(fetched!.resultHash, P3_3_CANONICAL_RESULT_HASH, "every other field remains intact and readable");
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
      assert.equal(runB.status, "completed", `expected a completed run - got status=${runB.status} errorCode=${runB.errorCode} errorMessage=${runB.errorMessage}`);
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
