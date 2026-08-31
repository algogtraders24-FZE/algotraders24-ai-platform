import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { GOLDEN_BARS, buildGoldenConfig } from "./fixtures/simulation-fixtures.js";

/**
 * Q0.5.38: historical Order/ExecutionResult/Trade/Ledger/Provenance
 * records must never be silently mutated after creation. Proven by
 * deep-freezing the INPUT bars before the run — Object.freeze causes a
 * TypeError on any attempted mutation in strict-mode ESM, so a silent
 * write would surface as a thrown error rather than passing unnoticed
 * (the same pattern Q0.3's risk-immutability.test.ts established).
 */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
  }
  return obj;
}

test("runSimulation does not mutate a deep-frozen bars array or config", () => {
  // Only `bars` is deep-frozen via structuredClone (plain data, safely
  // cloneable). `config` carries model objects with function properties
  // (computeSpread/computeFee/etc.) that structuredClone cannot clone —
  // it is frozen directly instead (Object.freeze works fine on functions
  // too), accepting that this freezes the shared singleton model
  // instances for the rest of the process, which is harmless since
  // nothing anywhere ever mutates them.
  const frozenBars = deepFreeze(structuredClone(GOLDEN_BARS));
  const frozenConfig = deepFreeze(buildGoldenConfig(frozenBars));
  assert.doesNotThrow(() => runSimulation(frozenBars, frozenConfig));
});

test("input bars object is byte-identical before and after a run (no in-place mutation)", () => {
  const bars = structuredClone(GOLDEN_BARS);
  const before = JSON.stringify(bars);
  runSimulation(bars, buildGoldenConfig(bars));
  assert.equal(JSON.stringify(bars), before);
});

test("every recorded Trade in the ledger is frozen (TradeLedger.record() freezes each record)", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  for (const trade of result.tradeLedger) {
    assert.ok(Object.isFrozen(trade));
  }
});

test("attempting to mutate a returned Trade throws rather than silently succeeding", () => {
  const result = runSimulation(GOLDEN_BARS, buildGoldenConfig());
  const trade = result.tradeLedger[0]!;
  assert.throws(() => {
    (trade as { netPnl: number }).netPnl = -99999;
  });
});

test("calling runSimulation twice with the same bars array does not accumulate state across calls", () => {
  const bars = [...GOLDEN_BARS];
  const first = runSimulation(bars, buildGoldenConfig(bars));
  const second = runSimulation(bars, buildGoldenConfig(bars));
  assert.equal(first.tradeLedger.length, second.tradeLedger.length);
  assert.deepEqual(first.finalAccount, second.finalAccount);
});
