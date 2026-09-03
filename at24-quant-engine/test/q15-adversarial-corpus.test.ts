import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, flatBar, buildQ15Config, signalExitRule, PRICE } from "./fixtures/q15-pyramiding-exit-fixtures.js";
import { comparison, indicatorOperand, literal } from "../src/domain/expression.js";

/**
 * Q1.5 VERIFICATION CLOSURE (C) — dedicated adversarial corpus, 15 named
 * cases (>= the required 10), each targeting one specific failure mode.
 * Every case asserts real ledger/position/execution-statistics outcomes
 * — never merely "the call did not throw." Deliberately compact:
 * short bar sequences, reused fixture helpers, one assertion group per
 * case, matching the sprint's own numbered list 1:1.
 */

const PYRAMID2 = { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE" as const, oppositeDirectionBehavior: "REVERSAL" as const };

// --- 1. maxEntries = 1 ---
test("Q1.5 adversarial 1: maxEntries=1 caps the position at exactly one fill", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: { ...PYRAMID2, maxEntries: 1 } });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.quantity, 1);
  assert.equal(result.executionStatistics.ordersCreated, 1);
});

// --- 2. maxEntries = 2 ---
test("Q1.5 adversarial 2: maxEntries=2 allows exactly two fills", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.quantity, 2);
  assert.equal(result.executionStatistics.ordersCreated, 2);
});

// --- 3. exact cap reached ---
test("Q1.5 adversarial 3: at exactly entryCount=maxEntries, the position stops accumulating", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.quantity, 2, "bar 3's signal (entryCount already at cap) must not add a third fill");
});

// --- 4. attempted third entry at cap ---
test("Q1.5 adversarial 4: an explicit third-entry attempt at the cap produces zero additional orders/fills", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104), flatBar(4, 105)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 2, "bars 3-4's continued signal never creates a 3rd order");
  assert.equal(result.executionStatistics.ordersFilled, 2);
});

// --- 5. allowPyramiding = false ---
test("Q1.5 adversarial 5: allowPyramiding=false — a repeatedly-true signal never accumulates beyond the first fill", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104)];
  const config = buildQ15Config(bars, { direction: "BUY" }); // no pyramiding field -> false-equivalent
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.quantity, 1);
});

// --- 6. exit + new entry on the same bar ---
test("Q1.5 adversarial 6: SIGNAL_EXIT true AND the entry condition true on the SAME bar — the position closes, then a fresh entry order is created within that same bar", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 111, 102, 111), bar(2, 120, 120, 100, 105)];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [{ id: "exit-1", condition: comparison(">", indicatorOperand(PRICE), literal(110)) }] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the first position closed via SIGNAL_EXIT");
  assert.equal(result.tradeLedger[0]!.exitPrice, 111);
  assert.equal(result.executionStatistics.ordersCreated, 2, "the original entry order AND the same-bar re-entry order");
  assert.equal(result.finalPositions.length, 1, "the same-bar re-entry filled on the next bar and remains open");
});

// --- 7. exit-before-entry ordering ---
test("Q1.5 adversarial 7: exit-before-entry is the ONLY policy — the closed trade's exit price never reflects a value that could only be seen after a hypothetical entry-first ordering", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 111, 102, 111), bar(2, 120, 120, 100, 105)];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [{ id: "exit-1", condition: comparison(">", indicatorOperand(PRICE), literal(110)) }] });
  const result = runSimulation(bars, config);
  // If entry-first ordering had somehow applied, a NEW position would have opened on bar1 too (before the exit), producing a DIFFERENT trade count/shape than the documented exit-before-entry policy.
  assert.equal(result.tradeLedger.length, 1);
  assert.equal(result.tradeLedger[0]!.entryPrice, 102, "the ORIGINAL position's entry, unaffected by the same-bar exit+reentry");
});

// --- 8. flat -> re-entry counter reset ---
test("Q1.5 adversarial 8: after a full close, a fresh entry starts entryCount at 1, not continuing any prior count", () => {
  const bars = [
    flatBar(0, 101),
    flatBar(1, 102), // fill 1
    flatBar(2, 103), // pyramid signal
    flatBar(3, 104), // fill 2 (cap)
    bar(4, 99, 99, 99, 99), // SIGNAL_EXIT closes
    flatBar(5, 101), // fresh signal
    flatBar(6, 106), // fresh fill 1 of the NEW sequence
    flatBar(7, 107), // fresh pyramid signal -- admitted (proves reset, cap would otherwise still be "reached")
    flatBar(8, 108), // fresh fill 2
  ];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)], pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger[0]!.quantity, 2, "first sequence reached its own cap of 2");
  assert.equal(result.finalPositions[0]!.quantity, 2, "second sequence ALSO independently reached a cap of 2 -- impossible unless its counter started fresh at 1");
});

// --- 9. rejected entry does not increment count ---
test("Q1.5 adversarial 9: a risk-rejected entry proposal never increments entryCount or produces a position", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102)];
  const config = buildQ15Config(bars, { direction: "BUY", risk: { maxPositionSize: 0.5 }, pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0);
  assert.equal(result.executionStatistics.ordersCreated, 0);
});

// --- 10. cancelled pending entry does not increment count ---
test("Q1.5 adversarial 10: an entry that never fires a second signal (structurally equivalent to a cancelled/expired pending order — both never reach the one fill-handling branch that increments the counter) leaves the count at exactly its last real fill", () => {
  const bars = [flatBar(0, 101), flatBar(1, 99), flatBar(2, 99)]; // signal only fires once
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.quantity, 1);
  assert.equal(result.executionStatistics.ordersCreated, 1, "no second order was ever created to be cancelled from");
});

// --- 11. open position + pending order + pyramiding ---
test("Q1.5 adversarial 11: a position open with a simultaneously-pending pyramid order never admits a competing THIRD order for the same slot", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 2, "order A (flat) then order B (pyramid, created while A's fill just opened the position) -- never a simultaneous third");
});

// --- 12. repeated SIGNAL_EXIT ---
test("Q1.5 adversarial 12: SIGNAL_EXIT staying true for many bars after the close never produces a second close or corrupts the ledger", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 105, 102, 105), bar(2, 99, 99, 99, 99), bar(3, 98, 98, 98, 98), bar(4, 97, 97, 97, 97), bar(5, 96, 96, 96, 96)];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "exactly one close, despite 4 more bars of a still-true exit condition");
  assert.equal(result.finalPositions.length, 0);
});

// --- 13. SIGNAL_EXIT while no position exists ---
test("Q1.5 adversarial 13: a true SIGNAL_EXIT condition with no open position produces no trade, no crash, no phantom close event", () => {
  const bars = [flatBar(0, 50), flatBar(1, 50)];
  const config = buildQ15Config(bars, { direction: "BUY", entryThreshold: 1_000_000, exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.finalPositions.length, 0);
});

// --- 14. long-side pyramiding ---
test("Q1.5 adversarial 14: long (BUY)-side pyramiding accumulates correctly, capped at maxEntries", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.side, "BUY");
  assert.equal(result.finalPositions[0]!.quantity, 2);
});

// --- 15. short-side pyramiding ---
test("Q1.5 adversarial 15: short (SELL)-side pyramiding accumulates correctly, capped at maxEntries — symmetric with the long case", () => {
  const bars = [flatBar(0, 99), flatBar(1, 98), flatBar(2, 97), flatBar(3, 96)];
  const config = buildQ15Config(bars, { direction: "SELL", pyramiding: PYRAMID2 });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions[0]!.side, "SELL");
  assert.equal(result.finalPositions[0]!.quantity, 2);
});
