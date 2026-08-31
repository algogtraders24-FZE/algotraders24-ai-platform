import { test } from "node:test";
import assert from "node:assert/strict";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { bar, absolute, buildOrderTypeConfig, ORD_INSTRUMENT } from "./fixtures/q11-order-fixtures.js";
import type { OHLCVBar } from "../src/domain/market-data.js";

const BASE_TS = Date.parse("2026-01-05T00:00:00Z");
const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000;

/** `ParentBarIdentity` treats a bar's `timestamp` as its CLOSE time — a parent's own window is `(timestamp - duration, timestamp]` (see docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md's identical note). */
function childBar(parentIndex: number, quarter: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + (parentIndex - 1) * HOUR_MS + (quarter + 1) * QUARTER_MS, instrument: ORD_INSTRUMENT, timeframe: "M15", open, high, low, close, volume: 250 };
}

const RISK = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, takeProfit: { type: "fixed-distance" as const, distance: 5 } }; // stopPrice(103) -> SL=98, TP=108

// A STOP entry fills unambiguously (bar-level gap, no child data needed) at parent bar 1's open (103).
// The resulting position's SL(98)/TP(108) both become reachable on a LATER bar (2) — the ambiguous bar.
const PARENT_BARS = [bar(0, 100, 101, 99, 101), bar(1, 103, 104, 102, 103.5), bar(2, 104, 115, 90, 105)];

// Real M15 children for parent bar 2 only: TP(108) is reached in the FIRST child, well before SL(98) is ever touched.
const CHILD_BARS: OHLCVBar[] = [
  childBar(2, 0, 104, 109, 103, 108.5), // touches TP(108) first
  childBar(2, 1, 108, 110, 104, 106),
  childBar(2, 2, 106, 107, 90, 95), // touches SL(98) -- but only AFTER TP already resolved the exit
  childBar(2, 3, 95, 105, 91, 105),
];

// --- Q0.11.13: D1/D2/D3 compatibility — a STOP-entry strategy runs through the SAME multi-fidelity entry point, no duplicated business logic ---
test("Q0.11.13: a STOP-entry strategy runs cleanly under D1_OHLC via runMultiFidelitySimulation (no separate order-type-aware code path)", () => {
  const base = buildOrderTypeConfig(PARENT_BARS, "BUY", "STOP", { stopPrice: absolute(103) }, RISK);
  const result = runMultiFidelitySimulation(PARENT_BARS, { base, fidelity: "D1_OHLC" });
  assert.equal(result.provenance.simulationFidelity, "D1_OHLC");
  assert.equal(result.tradeLedger.length, 1);
  assert.equal(result.tradeLedger[0]!.entryPrice, 103);
  assert.equal(result.tradeLedger[0]!.exitPrice, 98, "D1 conservatively resolves the same-bar SL/TP ambiguity to the stop-loss, exactly as it does for a MARKET-entered position");
});

test("Q0.11.13: given real M15 child detail, D2_LOWER_TIMEFRAME resolves the SAME STOP-entered position's later ambiguous bar to the TRUE, more precise outcome (take-profit)", () => {
  const base = buildOrderTypeConfig(PARENT_BARS, "BUY", "STOP", { stopPrice: absolute(103) }, RISK);
  const d2Result = runMultiFidelitySimulation(PARENT_BARS, {
    base,
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider: createStaticBarDetailProvider(CHILD_BARS, "M15", "q11-test-provider"),
    detailTimeframe: "M15",
    missingDetailPolicy: "FALLBACK_TO_D1",
  });
  assert.equal(d2Result.provenance.simulationFidelity, "D2_LOWER_TIMEFRAME");
  assert.equal(d2Result.tradeLedger.length, 1);
  assert.equal(d2Result.tradeLedger[0]!.entryPrice, 103, "the STOP order's own entry fill (an unambiguous bar-level gap) is identical whether or not child data exists for a LATER bar");
  assert.equal(d2Result.tradeLedger[0]!.exitPrice, 108, "D2's real intrabar ordering on the AMBIGUOUS bar proves the take-profit was reached before the stop-loss");

  const d1Result = runMultiFidelitySimulation(PARENT_BARS, { base, fidelity: "D1_OHLC" });
  assert.notEqual(d1Result.tradeLedger[0]!.exitPrice, d2Result.tradeLedger[0]!.exitPrice, "D1 and D2 legitimately disagree here BECAUSE D2 has real information D1 does not -- documented, correct behavior, not a bug (see docs/Q0.11_GAP_EXECUTION.md)");
});
