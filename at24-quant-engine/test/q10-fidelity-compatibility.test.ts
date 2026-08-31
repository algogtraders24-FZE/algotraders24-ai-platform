import { test } from "node:test";
import assert from "node:assert/strict";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { bar, buildManagementConfig, PM_INSTRUMENT } from "./fixtures/q10-position-management-fixtures.js";
import type { OHLCVBar } from "../src/domain/market-data.js";

const BASE_TS = Date.parse("2026-01-05T00:00:00Z");
const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000;

/**
 * `ParentBarIdentity` (`runtime/fidelity/parent-bar-identity.ts`) treats a
 * bar's `timestamp` as its CLOSE time (`openTimestamp = bar.timestamp -
 * durationMs`), matching Q0's own OHLCV convention throughout — so a
 * parent H1 bar at `BASE_TS + parentIndex*HOUR_MS` owns the window
 * `(BASE_TS + (parentIndex-1)*HOUR_MS, BASE_TS + parentIndex*HOUR_MS]`,
 * not `[parentIndex*HOUR_MS, (parentIndex+1)*HOUR_MS)` as a naive
 * open-time reading would suggest.
 */
function childBar(parentIndex: number, quarter: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + (parentIndex - 1) * HOUR_MS + (quarter + 1) * QUARTER_MS, instrument: PM_INSTRUMENT, timeframe: "M15", open, high, low, close, volume: 250 };
}

const RISK = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, takeProfit: { type: "fixed-distance" as const, distance: 10 } };

// Parent bars: bar 2 is the SAME "both SL and TP reachable" ambiguous bar as PM_SL_TP_CONFLICT.
const PARENT_BARS = [
  bar(0, 100, 101, 99, 101), // signal: stop=96, TP=111
  bar(1, 102, 102.5, 101.5, 102), // entry=102
  bar(2, 103, 115, 90, 105), // BOTH SL(96) and TP(111) reachable within this parent bar
];

// Parent bar 2's own M15 children: aggregate OHLC is IDENTICAL to the parent bar above
// (open=103, high=115, low=90, close=105), but the take-profit (111) is touched in the
// FIRST child, well before the stop-loss (96) is ever touched (third child) — real,
// resolvable intrabar order the parent-only OHLC cannot express.
const CHILD_BARS: OHLCVBar[] = [
  childBar(2, 0, 103, 113, 102, 112), // touches TP(111) first
  childBar(2, 1, 112, 115, 105, 108),
  childBar(2, 2, 108, 109, 90, 95), // touches SL(96) — but only AFTER TP already resolved the exit
  childBar(2, 3, 95, 105, 91, 105),
];

// --- Q0.10.32: D1/D2 compatibility — management-bearing StrategySpecs run through the SAME multi-fidelity entry point without duplicating business logic ---
test("Q0.10.32: a management-bearing strategy runs cleanly under D1_OHLC via runMultiFidelitySimulation (no separate management code path)", () => {
  const result = runMultiFidelitySimulation(PARENT_BARS, { base: buildManagementConfig(PARENT_BARS, "BUY", RISK), fidelity: "D1_OHLC" });
  assert.equal(result.provenance.simulationFidelity, "D1_OHLC");
  assert.equal(result.tradeLedger.length, 1);
  assert.equal(result.tradeLedger[0]!.exitPrice, 96, "D1 conservatively resolves the same-bar SL/TP ambiguity to the stop-loss");
});

// --- Q0.10.33: the required D1-vs-D2 golden test — D2 may resolve more precisely, but must never violate the conservative rule when it lacks the detail to do so ---
test("Q0.10.33: given real M15 child detail, D2_LOWER_TIMEFRAME resolves the SAME ambiguous bar to the TRUE, more precise outcome (take-profit), never contradicting D1's conservative fallback", () => {
  const base = buildManagementConfig(PARENT_BARS, "BUY", RISK);
  const d2Result = runMultiFidelitySimulation(PARENT_BARS, {
    base,
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider: createStaticBarDetailProvider(CHILD_BARS, "M15", "Q0.10-test-provider"),
    detailTimeframe: "M15",
    missingDetailPolicy: "FALLBACK_TO_D1",
  });
  assert.equal(d2Result.provenance.simulationFidelity, "D2_LOWER_TIMEFRAME");
  assert.equal(d2Result.tradeLedger.length, 1);
  assert.equal(d2Result.tradeLedger[0]!.exitPrice, 111, "D2's real intrabar ordering proves the take-profit was reached BEFORE the stop-loss — D1's conservative SL resolution was only ever a worst-case fallback for missing detail, not a claim that SL genuinely came first");
  assert.equal(d2Result.tradeLedger[0]!.grossPnl, 9);

  const d1Result = runMultiFidelitySimulation(PARENT_BARS, { base, fidelity: "D1_OHLC" });
  assert.notEqual(d1Result.tradeLedger[0]!.exitPrice, d2Result.tradeLedger[0]!.exitPrice, "D1 and D2 legitimately disagree here BECAUSE D2 has real information D1 does not — this is the documented, correct behavior, not a bug");
});
