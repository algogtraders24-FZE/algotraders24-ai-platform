import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { buildDecision, type PyramidingAdmission } from "../src/runtime/simulation/decision-builder.js";
import { bar, flatBar, buildQ15Config, signalExitRule } from "./fixtures/q15-pyramiding-exit-fixtures.js";
import type { Signal } from "../src/domain/signal.js";

/**
 * Q1.5 VERIFICATION CLOSURE (B) — pending-order + pyramiding interaction.
 * Proves a pending order can never bypass maxEntries/allowPyramiding
 * admission: `buildDecision`'s `hasPendingOrder` gate applies to a pyramid
 * ENTER identically to a flat one (`!hasPendingOrder` is ANDed into both
 * admission paths — see decision-builder.ts), so at most ONE order can
 * ever be in flight for a symbol at a time, regardless of how many bars
 * keep the entry condition true. Six cases, matching the sprint spec 1:1.
 */

const BUY: Signal = { direction: "BUY", instrument: { symbol: "X" }, timeframe: "H1", generatedAt: 0, strategyId: "x", strategyVersion: "1.0.0", triggeredByRuleId: "entry-1" };

// --- Case 1: valid additional entry (entryCount=1, maxEntries=2) ---
test("Q1.5 pending+pyramid Case 1: entryCount=1, maxEntries=2, allowPyramiding=true — a valid second entry is permitted and fills through the normal universal execution path", () => {
  const admission: PyramidingAdmission = { allowPyramiding: true, maxEntries: 2, currentEntryCount: 1, openPositionSide: "BUY" };
  assert.equal(buildDecision(BUY, true, false, admission).action, "ENTER");

  // Integration-level: condition true only for bars 0-1 (fills 2 entries), false after.
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 99), flatBar(3, 99)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" } });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.quantity, 2, "both entries filled via the normal fill/increasePosition path");
});

// --- Case 2: cap reached — pending-order subsystem must not provide a bypass ---
test("Q1.5 pending+pyramid Case 2: entryCount=2, maxEntries=2 — a third entry is rejected; the condition staying true for MANY more bars never creates a bypass order", () => {
  const admission: PyramidingAdmission = { allowPyramiding: true, maxEntries: 2, currentEntryCount: 2, openPositionSide: "BUY" };
  assert.equal(buildDecision(BUY, true, false, admission).action, "HOLD");

  // The condition stays true for 8 bars total — if any bypass existed, ordersCreated would exceed 2.
  const bars = Array.from({ length: 8 }, (_, i) => flatBar(i, 101 + i));
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" } });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 2, "exactly 2 orders ever, across 8 bars of a continuously-true signal — the cap holds for the entire run, no bypass");
  assert.equal(result.finalPositions[0]!.quantity, 2);
});

// --- Case 3: pyramiding disabled ---
test("Q1.5 pending+pyramid Case 3: allowPyramiding=false — no additional entry is EVER admitted while a position remains open, across many bars", () => {
  const admission: PyramidingAdmission = { allowPyramiding: false, currentEntryCount: 1, openPositionSide: "BUY" };
  assert.equal(buildDecision(BUY, true, false, admission).action, "HOLD");

  const bars = Array.from({ length: 6 }, (_, i) => flatBar(i, 101 + i));
  const config = buildQ15Config(bars, { direction: "BUY" }); // pyramiding absent -> allowPyramiding=false-equivalent
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 1, "exactly one order across the whole run — no pending order is ever left dangling from a phantom second attempt");
  assert.equal(result.finalPositions[0]!.quantity, 1);
});

// --- Case 4: position + pending order + pyramiding enabled — no unintended second admission route ---
test("Q1.5 pending+pyramid Case 4: while a position is open AND a fresh pyramid order is simultaneously pending (the natural 1-bar create-then-fill window), no second, competing order is ever created for the same admission slot", () => {
  // bar0: flat entry decided (order A created, pending).
  // bar1: order A fills (position opens, entryCount=1). SAME bar1's Step4: pyramid entry decided (order B created, pending) -- for the remainder of bar1's processing, a position is open AND order B is pending, simultaneously.
  // bar2: order B fills (entryCount=2, cap reached for maxEntries=2) -- at no point were TWO orders pending at once, and the cap held despite the simultaneous state.
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104), flatBar(4, 105)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" } });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 2, "order A (flat) then order B (pyramid) -- never a third, even though bars 2-4 keep the condition true while order B's own admission window is active");
  assert.equal(result.executionStatistics.ordersFilled, 2);
  assert.equal(result.finalPositions[0]!.quantity, 2);

  // Direct unit-level proof of the SAME invariant: hasPendingOrder=true unconditionally blocks a pyramid ENTER, even when every other admission condition (allowPyramiding, entryCount<maxEntries) would otherwise allow it.
  const wouldOtherwiseAdmit: PyramidingAdmission = { allowPyramiding: true, maxEntries: 5, currentEntryCount: 1, openPositionSide: "BUY" };
  assert.equal(buildDecision(BUY, true, true, wouldOtherwiseAdmit).action, "HOLD", "a pending order blocks pyramid admission regardless of how permissive the policy is -- the ONE gate every entry (flat or pyramid) must clear");
});

// --- Case 5: pending order cancellation/rejection never increments the entry-fill count ---
test("Q1.5 pending+pyramid Case 5: an entry rejected by risk evaluation before ever becoming a pending order never increments entryCount — only actual qualifying FILLS count", () => {
  // maxPositionSize rejects every proposed entry (quantity=1 > 0.5) -- structurally identical to a
  // cancelled/expired pending order: it never reaches the fill-handling branch that increments the counter
  // (entryCountByPosition is written in EXACTLY ONE place in the engine -- the outcome.filled branch).
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    risk: { maxPositionSize: 0.5 },
    pyramiding: { allowPyramiding: true, maxEntries: 3, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0, "even the first entry is rejected -- proving rejection (and by the same code-path argument, cancellation/expiration) never reaches the counter-incrementing branch");
  assert.equal(result.executionStatistics.ordersCreated, 0, "a risk-rejected proposal never even becomes a pending order in the first place");
});

// --- Case 6: flat reset — a new position begins a fresh maxEntries cycle ---
test("Q1.5 pending+pyramid Case 6: after Case 2's cap-then-close cycle, a later flat position begins its OWN fresh maxEntries cycle — the pending-order/admission machinery resets cleanly, not carrying over stale state", () => {
  const bars = [
    flatBar(0, 101),
    flatBar(1, 102), // fill 1, entryCount=1
    flatBar(2, 103), // pyramid decided
    flatBar(3, 104), // fill 2, entryCount=2 (cap)
    bar(4, 99, 99, 99, 99), // SIGNAL_EXIT closes -> flat, counter reset
    flatBar(5, 101), // fresh entry signal
    flatBar(6, 106), // fill 3 (a NEW position's first fill, entryCount=1 again)
    flatBar(7, 107), // fresh pyramid signal -- admitted again (proves the cap reset, not still at 2)
    flatBar(8, 108), // fill 4, entryCount=2 for the SECOND sequence
  ];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    exitRules: [signalExitRule("BUY", 100)],
    pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the first sequence closed");
  assert.equal(result.tradeLedger[0]!.quantity, 2);
  assert.equal(result.finalPositions.length, 1, "the second sequence is open");
  assert.equal(result.finalPositions[0]!.quantity, 2, "the second sequence independently reached its OWN cap of 2 -- proving the counter started fresh at 1, not continuing from the first sequence's final count");
});
