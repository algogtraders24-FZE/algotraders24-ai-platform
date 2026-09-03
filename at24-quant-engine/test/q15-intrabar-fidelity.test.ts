import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { runMultiFidelitySimulation } from "../src/runtime/fidelity/multi-fidelity-engine.js";
import { buildQ15Config, buildQ15IntrabarConfig, Q15_INTRABAR_PARENT_BARS, Q15_INTRABAR_OPTS } from "./fixtures/q15-pyramiding-exit-fixtures.js";

/**
 * Q1.5 VERIFICATION CLOSURE (A) — genuine, NON-EMPTY D2/D3 intrabar
 * validation. The prior Q1.5_FIDELITY_PARITY.md only proved the
 * FALLBACK_TO_D1 machinery (an empty detailProvider) — this proves fills
 * actually resolve at real child-bar prices, that entryCountByPosition
 * (pyramiding) correctly threads through genuine intrabar fills, and that
 * SIGNAL_EXIT/entry-decision remain honestly parent-bar-only (never
 * silently claimed to be intrabar-resolved). See
 * docs/Q1.5_FIDELITY_PARITY.md for what is proven equal vs. what
 * legitimately differs.
 */

test("Q1.5 intrabar D2: the first entry fills at the REAL child bar's own open (105), not the parent bar's open (101) and not FALLBACK_TO_D1", () => {
  const result = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  assert.equal(result.provenance.simulationFidelity, "D2_LOWER_TIMEFRAME");
  // 2 entries accumulated (105 then 110), then SIGNAL_EXIT closes at parent bar 3's close (99).
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.quantity, 2, "both entries filled and accumulated");
  assert.equal(trade.entryPrice, (105 + 110) / 2, "volume-weighted average of the two REAL child-bar fill prices");
  assert.equal(trade.exitPrice, 99, "SIGNAL_EXIT closes at the parent bar's own close (parent-bar granularity, by design)");
});

test("Q1.5 intrabar D3: identical result to D2 for this fixture (D3_M1 and D2_LOWER_TIMEFRAME share the same runFidelityAwareSimulation code path)", () => {
  const d2 = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  const d3 = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D3_M1"));
  assert.equal(d3.provenance.simulationFidelity, "D3_M1");
  assert.equal(d3.tradeLedger.length, 1);
  assert.equal(d3.tradeLedger[0]!.entryPrice, d2.tradeLedger[0]!.entryPrice);
  assert.equal(d3.tradeLedger[0]!.exitPrice, d2.tradeLedger[0]!.exitPrice);
  assert.equal(d3.tradeLedger[0]!.quantity, d2.tradeLedger[0]!.quantity);
});

test("Q1.5 intrabar: maxEntries=2 is genuinely enforced through the real intrabar fill path — the cap-reached signal at P2 creates NO third order for the STILL-open position (the 3rd order that DOES exist is a legitimate, unrelated FRESH entry at P4, after SIGNAL_EXIT reset the position to flat at P3 — proving the cap AND the flat-reset both work correctly, together, in the same real-intrabar run)", () => {
  const result = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  assert.equal(result.executionStatistics.ordersCreated, 3, "P0 flat entry + P1 admitted pyramid entry (2, capped correctly — no 3rd pyramid order at P2) + P4's fresh, unrelated entry after the P3 SIGNAL_EXIT flat-reset");
  assert.equal(result.tradeLedger.length, 1, "only ONE closed trade exists (P0-P3's sequence) within this fixture's own bar range — P4's fresh order is still pending, unresolved at the end of the run");
});

test("Q1.5 intrabar: SIGNAL_EXIT is genuinely evaluated through the D2/D3 path — the position (opened via real intrabar fills) correctly closes", () => {
  const result = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  assert.equal(result.finalPositions.length, 0, "SIGNAL_EXIT closed the position that real intrabar fills built up");
});

test("Q1.5 intrabar vs D1: entry prices LEGITIMATELY differ (child-bar open vs parent-bar open) — this is a documented fidelity difference, never claimed as parity", () => {
  const d1 = runSimulation(Q15_INTRABAR_PARENT_BARS, buildQ15Config(Q15_INTRABAR_PARENT_BARS, Q15_INTRABAR_OPTS));
  const d2 = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  // D1 has no child data at all -> fills at the PARENT bar's own open (101 for both P1 and P2).
  assert.equal(d1.tradeLedger[0]!.entryPrice, (101 + 101) / 2);
  // D2 has real children -> fills at the CHILD bar's own open (105, 110) -- strictly more precise, legitimately different.
  assert.equal(d2.tradeLedger[0]!.entryPrice, (105 + 110) / 2);
  assert.notEqual(d1.tradeLedger[0]!.entryPrice, d2.tradeLedger[0]!.entryPrice, "D1 and D2 entry prices must NOT be equal here -- claiming they were would misrepresent the fidelity difference");
  // What DOES stay equal: trade count, quantity, and the exit outcome (SIGNAL_EXIT is parent-bar-only in both).
  assert.equal(d1.tradeLedger.length, d2.tradeLedger.length);
  assert.equal(d1.tradeLedger[0]!.quantity, d2.tradeLedger[0]!.quantity);
  assert.equal(d1.tradeLedger[0]!.exitPrice, d2.tradeLedger[0]!.exitPrice);
});

test("Q1.5 intrabar look-ahead: appending a LATER parent bar's real child data to the SAME provider array never changes P0-P3's own outcome", () => {
  const withoutBait = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME", false));
  const withBait = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME", true));
  assert.deepEqual(withoutBait.tradeLedger, withBait.tradeLedger, "parent bar 4's own (huge, price=500) child data existing in the provider's backing array must never leak backward into parent bars 0-3's already-computed fills/decisions");
});

test("Q1.5 intrabar look-ahead: FidelityQuality correctly reports which parents had real detail vs. fell back", () => {
  const result = runMultiFidelitySimulation(Q15_INTRABAR_PARENT_BARS, buildQ15IntrabarConfig("D2_LOWER_TIMEFRAME"));
  const quality = result.provenance.fidelityQuality;
  assert.equal(quality.detailCoverage.totalParents, 5);
  assert.equal(quality.detailCoverage.completeParents, 2, "parents 1 and 2 have real 4/4 child coverage");
  assert.equal(quality.detailCoverage.missingParents, 3, "parents 0, 3, 4 have no child data -> honestly reported as falling back, never silently assumed");
});
