import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { bar, buildQ15Config, buildQ15MultiFidelityConfig, signalExitRule } from "./fixtures/q15-pyramiding-exit-fixtures.js";

/**
 * Q1.5.6/7 — D1/D2/D3 fidelity parity for the two new Q1.5 capabilities
 * (pyramiding admission, SIGNAL_EXIT). Verifies the manually-duplicated
 * multi-fidelity-engine.ts logic (Q0.6's own established "duplicate outer
 * control-flow shape" pattern — this file has never called
 * simulation-engine.ts's internals) produces IDENTICAL trade-level outcomes
 * to D1, subject only to Q0.6's own already-documented fidelity
 * differences (none of which are exercised here — these fixtures use
 * `missingDetailPolicy: "FALLBACK_TO_D1"`, so every parent bar resolves at
 * parent-bar granularity, honestly tracked in FidelityQuality).
 */

test("Q1.5 parity: pyramiding (maxEntries=2, cap reached, SIGNAL_EXIT close) — D1 and D2/D3 (fallback) produce identical trades", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 102, 102, 102), bar(2, 103, 103, 103, 103), bar(3, 99, 99, 99, 99)];
  const opts = {
    direction: "BUY" as const,
    exitRules: [signalExitRule("BUY", 100)],
    pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE" as const, oppositeDirectionBehavior: "REVERSAL" as const },
  };
  const d1 = runSimulation(bars, buildQ15Config(bars, opts));
  const d2 = runMultiFidelitySimulation(bars, buildQ15MultiFidelityConfig(bars, opts));

  assert.equal(d2.tradeLedger.length, d1.tradeLedger.length);
  assert.equal(d2.tradeLedger[0]!.entryPrice, d1.tradeLedger[0]!.entryPrice);
  assert.equal(d2.tradeLedger[0]!.exitPrice, d1.tradeLedger[0]!.exitPrice);
  assert.equal(d2.tradeLedger[0]!.quantity, d1.tradeLedger[0]!.quantity, "both fidelities must accumulate the SAME 2 entries, never a divergent cap enforcement");
  assert.equal(d2.finalPositions.length, d1.finalPositions.length);
});

test("Q1.5 parity: SIGNAL_EXIT (long close) — D1 and D2/D3 (fallback) produce identical trades", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 105, 102, 105), bar(2, 99, 99, 99, 99)];
  const opts = { direction: "BUY" as const, exitRules: [signalExitRule("BUY", 100)] };
  const d1 = runSimulation(bars, buildQ15Config(bars, opts));
  const d2 = runMultiFidelitySimulation(bars, buildQ15MultiFidelityConfig(bars, opts));

  assert.equal(d2.tradeLedger.length, 1);
  assert.equal(d1.tradeLedger.length, 1);
  assert.equal(d2.tradeLedger[0]!.entryPrice, d1.tradeLedger[0]!.entryPrice);
  assert.equal(d2.tradeLedger[0]!.exitPrice, d1.tradeLedger[0]!.exitPrice);
  assert.equal(d2.finalPositions.length, d1.finalPositions.length);
});

test("Q1.5 parity: SIGNAL_EXIT (short close) — D1 and D2/D3 (fallback) produce identical trades", () => {
  const bars = [bar(0, 99, 99, 99, 99), bar(1, 98, 98, 95, 95), bar(2, 101, 101, 101, 101)];
  const opts = { direction: "SELL" as const, exitRules: [signalExitRule("SELL", 100)] };
  const d1 = runSimulation(bars, buildQ15Config(bars, opts));
  const d2 = runMultiFidelitySimulation(bars, buildQ15MultiFidelityConfig(bars, opts));

  assert.equal(d2.tradeLedger.length, 1);
  assert.equal(d2.tradeLedger[0]!.entryPrice, d1.tradeLedger[0]!.entryPrice);
  assert.equal(d2.tradeLedger[0]!.exitPrice, d1.tradeLedger[0]!.exitPrice);
});

test("Q1.5 parity: allowPyramiding=false — D1 and D2/D3 both cap at exactly one entry, identically", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 102, 102, 102), bar(2, 103, 103, 103, 103)];
  const opts = { direction: "BUY" as const };
  const d1 = runSimulation(bars, buildQ15Config(bars, opts));
  const d2 = runMultiFidelitySimulation(bars, buildQ15MultiFidelityConfig(bars, opts));

  assert.equal(d1.finalPositions[0]!.quantity, 1);
  assert.equal(d2.finalPositions[0]!.quantity, 1);
});
