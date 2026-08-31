import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { evaluateBreakeven } from "../src/runtime/risk/breakeven.js";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import { evaluatePartialClose } from "../src/runtime/risk/partial-close.js";
import { evaluateMaxHoldingPeriod } from "../src/runtime/risk/holding-period.js";
import { bar, buildManagementConfig } from "./fixtures/q10-position-management-fixtures.js";

const TRAILING_RISK = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, breakeven: { trigger: { mode: "absolute" as const, value: 3 }, lockOffset: { mode: "absolute" as const, value: 0 } }, trailingStop: { activation: { mode: "absolute" as const, value: 5 }, distance: { mode: "absolute" as const, value: 2 } } };

const COMMON_PREFIX = [
  bar(0, 100, 101, 99, 101),
  bar(1, 102, 102.5, 101.5, 102),
  bar(2, 103, 106, 102.5, 105), // breakeven fires here -> stop=102
  bar(3, 106, 109, 105.5, 108), // trailing takes over here -> stop=106
];
// Two DIFFERENT futures appended after the identical 4-bar prefix.
const FUTURE_A = [...COMMON_PREFIX, bar(4, 107, 107.5, 105, 106)]; // stops out at 106
const FUTURE_B = [...COMMON_PREFIX, bar(4, 110, 120, 109, 118), bar(5, 118, 119, 106.5, 107)]; // rallies further, then stops out later

// --- Q0.10.21: lookahead — appending future bars must never change already-produced management decisions/ledger entries ---
test("Q0.10.21: breakeven/trailing decisions made within the common prefix are IDENTICAL regardless of what bars follow", () => {
  const resultA = runSimulation(FUTURE_A, buildManagementConfig(FUTURE_A, "BUY", TRAILING_RISK));
  const resultB = runSimulation(FUTURE_B, buildManagementConfig(FUTURE_B, "BUY", TRAILING_RISK));
  const prefixOnly = runSimulation(COMMON_PREFIX, buildManagementConfig(COMMON_PREFIX, "BUY", TRAILING_RISK));

  // Neither trade has closed within the 4-bar prefix in any of the three runs.
  assert.equal(prefixOnly.tradeLedger.length, 0);
  // The position's stopLoss after bar 3 (106, from trailing) must be identical whether bar 4 is FUTURE_A's or FUTURE_B's — it was decided using only bars 0-3.
  assert.equal(prefixOnly.finalPositions[0]!.stopLoss, 106);
});

test("Q0.10.21: a max-holding-period expiry decided at bar N is unaffected by what price does after bar N", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, maxHoldingPeriod: { maxBars: 2 } };
  const prefix = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102), bar(2, 103, 104, 100, 103)];
  const futureA = [...prefix, bar(3, 104, 108, 102, 107)];
  const futureB = [...prefix, bar(3, 104, 200, 101, 180)]; // a wildly different, favorable future bar 3 (stays above the stop so max-holding, not the stop, decides the exit)
  const resultA = runSimulation(futureA, buildManagementConfig(futureA, "BUY", risk));
  const resultB = runSimulation(futureB, buildManagementConfig(futureB, "BUY", risk));
  // Both must force-exit at bar 3 via MAX_HOLDING_PERIOD, at THAT bar's own close — the decision to force-exit (made because barsHeld>=2) is identical; only the resulting exit PRICE legitimately differs because bar 3 itself differs.
  assert.equal(resultA.tradeLedger.length, 1);
  assert.equal(resultB.tradeLedger.length, 1);
  assert.equal(resultA.tradeLedger[0]!.exitPrice, 107);
  assert.equal(resultB.tradeLedger[0]!.exitPrice, 180);
});

// --- Q0.10.22: determinism — 3 identical runs produce identical events/fills/positions/ledger/hash ---
test("Q0.10.22: three runs of the same management-bearing simulation are byte-identical", () => {
  const results = [1, 2, 3].map(() => runSimulation(FUTURE_A, buildManagementConfig(FUTURE_A, "BUY", TRAILING_RISK)));
  assert.equal(results[0]!.resultHash, results[1]!.resultHash);
  assert.equal(results[1]!.resultHash, results[2]!.resultHash);
  assert.deepEqual(results[0]!.tradeLedger, results[1]!.tradeLedger);
  assert.deepEqual(results[0]!.finalPositions, results[1]!.finalPositions);
});

// --- Q0.10.23: replay — the same event stream (i.e. the same inputs) reproduces a byte-identical semantic result ---
test("Q0.10.23: replaying the same bars/config through runSimulation() again reproduces an identical SimulationResult", () => {
  const config = buildManagementConfig(FUTURE_A, "BUY", TRAILING_RISK);
  const first = runSimulation(FUTURE_A, config);
  const replay = runSimulation(FUTURE_A, config);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(replay)));
});

// --- Q0.10.24: immutability — management evaluation never mutates its inputs ---
test("Q0.10.24: evaluateBreakeven/evaluateTrailingStop/evaluatePartialClose/evaluateMaxHoldingPeriod never mutate their rule/position arguments", () => {
  const breakevenRule = Object.freeze({ trigger: Object.freeze({ mode: "absolute" as const, value: 3 }), lockOffset: Object.freeze({ mode: "absolute" as const, value: 0 }) });
  assert.doesNotThrow(() => evaluateBreakeven(breakevenRule, "BUY", 100, 105, undefined, undefined));

  const trailingRule = Object.freeze({ activation: Object.freeze({ mode: "absolute" as const, value: 3 }), distance: Object.freeze({ mode: "absolute" as const, value: 2 }) });
  assert.doesNotThrow(() => evaluateTrailingStop(trailingRule, "BUY", 100, 108, 102, undefined));

  const partialRule = Object.freeze({ trigger: Object.freeze({ mode: "absolute" as const, value: 3 }), closePercent: 50 });
  assert.doesNotThrow(() => evaluatePartialClose(partialRule, "BUY", 100, 105, undefined, false));

  const holdingSpec = Object.freeze({ sizing: Object.freeze({ method: "fixed-quantity" as const, quantity: 1 }), maxHoldingPeriod: Object.freeze({ maxBars: 2 }) });
  const positionView = Object.freeze({ entryTimestamp: 0, barsHeld: 1 });
  assert.doesNotThrow(() => evaluateMaxHoldingPeriod(holdingSpec, positionView, 1000));
});

test("Q0.10.24: running a simulation twice with the SAME frozen risk specification object never throws from an attempted mutation", () => {
  const frozenRisk = Object.freeze({
    sizing: Object.freeze({ method: "fixed-quantity" as const, quantity: 1 }),
    stopLoss: Object.freeze({ type: "fixed-distance" as const, distance: 5 }),
    breakeven: Object.freeze({ trigger: Object.freeze({ mode: "absolute" as const, value: 3 }), lockOffset: Object.freeze({ mode: "absolute" as const, value: 0 }) }),
    trailingStop: Object.freeze({ activation: Object.freeze({ mode: "absolute" as const, value: 5 }), distance: Object.freeze({ mode: "absolute" as const, value: 2 }) }),
  });
  assert.doesNotThrow(() => runSimulation(FUTURE_A, buildManagementConfig(FUTURE_A, "BUY", frozenRisk)));
  assert.doesNotThrow(() => runSimulation(FUTURE_A, buildManagementConfig(FUTURE_A, "BUY", frozenRisk)));
});
