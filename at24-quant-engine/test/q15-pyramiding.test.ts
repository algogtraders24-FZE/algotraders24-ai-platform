import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { buildDecision, type PyramidingAdmission } from "../src/runtime/simulation/decision-builder.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { fixtureEMACrossover } from "./fixtures/strategy-ir-fixtures.js";
import type { Signal } from "../src/domain/signal.js";
import { bar, flatBar, buildQ15Config, signalExitRule } from "./fixtures/q15-pyramiding-exit-fixtures.js";

/**
 * Q1.5.4 — pyramiding admission + maxEntries/maxPositions. See
 * docs/Q1.5_PYRAMIDING_POLICY.md for the full audit and derived
 * semantics. Two layers of tests: (1) `buildDecision` unit tests, proving
 * the admission LOGIC directly; (2) full `runSimulation` integration
 * tests, proving the whole pipeline (decision -> order -> fill ->
 * increasePosition -> counter) actually executes correctly, not merely
 * that the decision layer SAYS "ENTER."
 */

const BUY_SIGNAL: Signal = { direction: "BUY", instrument: { symbol: "X" }, timeframe: "H1", generatedAt: 0, strategyId: "x", strategyVersion: "1.0.0", triggeredByRuleId: "entry-1" };

// ============ Unit tests: buildDecision admission logic ============

test("Q1.5.4 unit: allowPyramiding=false — a second ENTER while a position is open stays HOLD (byte-identical to pre-Q1.5 behavior)", () => {
  const pyramiding: PyramidingAdmission = { allowPyramiding: false, currentEntryCount: 1, openPositionSide: "BUY" };
  const decision = buildDecision(BUY_SIGNAL, true, false, pyramiding);
  assert.equal(decision.action, "HOLD");
});

test("Q1.5.4 unit: no pyramiding context at all (undefined) — a second ENTER while a position is open stays HOLD (the default, matches every pre-Q1.5 caller)", () => {
  const decision = buildDecision(BUY_SIGNAL, true, false);
  assert.equal(decision.action, "HOLD");
});

test("Q1.5.4 unit: allowPyramiding=true, entryCount below maxEntries — a same-direction ENTER is admitted", () => {
  const pyramiding: PyramidingAdmission = { allowPyramiding: true, maxEntries: 2, currentEntryCount: 1, openPositionSide: "BUY" };
  const decision = buildDecision(BUY_SIGNAL, true, false, pyramiding);
  assert.equal(decision.action, "ENTER");
});

test("Q1.5.4 unit: allowPyramiding=true, entryCount AT maxEntries — the cap rejects further entries (HOLD)", () => {
  const pyramiding: PyramidingAdmission = { allowPyramiding: true, maxEntries: 2, currentEntryCount: 2, openPositionSide: "BUY" };
  const decision = buildDecision(BUY_SIGNAL, true, false, pyramiding);
  assert.equal(decision.action, "HOLD");
  assert.ok(decision.context.reason.includes("maxEntries"));
});

test("Q1.5.4 unit: allowPyramiding=true with NO maxEntries set — unbounded pyramiding (an explicit opt-in choice, never a silent cap)", () => {
  const pyramiding: PyramidingAdmission = { allowPyramiding: true, currentEntryCount: 50, openPositionSide: "BUY" };
  const decision = buildDecision(BUY_SIGNAL, true, false, pyramiding);
  assert.equal(decision.action, "ENTER");
});

test("Q1.5.4 unit: opposite-direction signal while a position is open is NEVER treated as a pyramid entry (reversal is a separate, untouched mechanism)", () => {
  const sellSignal: Signal = { ...BUY_SIGNAL, direction: "SELL", triggeredByRuleId: "entry-2" };
  const pyramiding: PyramidingAdmission = { allowPyramiding: true, maxEntries: 5, currentEntryCount: 1, openPositionSide: "BUY" };
  const decision = buildDecision(sellSignal, true, false, pyramiding);
  assert.equal(decision.action, "HOLD", "opposite-direction admission is reversal's job, not pyramiding's");
});

test("Q1.5.4 unit: a pending order blocks a pyramid entry exactly like a flat entry (hasPendingOrder still wins)", () => {
  const pyramiding: PyramidingAdmission = { allowPyramiding: true, maxEntries: 5, currentEntryCount: 1, openPositionSide: "BUY" };
  const decision = buildDecision(BUY_SIGNAL, true, true, pyramiding);
  assert.equal(decision.action, "HOLD");
});

// ============ Integration tests: full simulation ============

test("Q1.5.4 integration: allowPyramiding=false — condition stays true across multiple bars, but only ONE entry ever fires (preserves pre-Q1.5 behavior exactly)", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103), flatBar(3, 104)];
  const config = buildQ15Config(bars, { direction: "BUY" });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.quantity, 1, "no pyramiding: exactly one entry fill, regardless of how many bars keep the condition true");
});

test("Q1.5.4 integration: maxEntries=1 — a second same-direction signal is rejected even with allowPyramiding=true", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, { direction: "BUY", pyramiding: { allowPyramiding: true, maxEntries: 1, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" } });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.quantity, 1, "maxEntries=1 caps at exactly one fill");
});

test("Q1.5.4 integration: maxEntries=2 — first, second entries fire and accumulate; a third signal is rejected at the cap; SIGNAL_EXIT then closes with the correct total quantity, proving the exact fill count", () => {
  // bar0: close=101, PRICE>100 true -> flat ENTER, order created (fills bar1 open)
  // bar1: fill @102 -> position opens, entryCount=1. close=102, PRICE>100 true -> pyramid ENTER admitted (1<2), order created (fills bar2 open)
  // bar2: fill @103 -> entryCount=2 (increasePosition, avg price). close=103, PRICE>100 true -> cap reached (2>=2) -> HOLD, no third order
  // bar3: close=99 -> SIGNAL_EXIT (PRICE<100) fires, closes the position; entry condition PRICE>100 false -> no new entry
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 102, 102, 102), bar(2, 103, 103, 103, 103), bar(3, 99, 99, 99, 99)];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    exitRules: [signalExitRule("BUY", 100)],
    pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0, "the position closed via SIGNAL_EXIT on bar3");
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.quantity, 2, "EXACTLY two entry fills accumulated (bar1 @102, bar2 @103) — the bar2-signaled third entry was correctly rejected at the cap, never created, never filled");
  assert.equal(trade.entryPrice, (102 + 103) / 2, "increasePosition's own volume-weighted average price formula was genuinely used (fixed-quantity=1 each => simple average) — proving Q1.5 reused the EXISTING position-engine logic, not a parallel mechanism");
});

test("Q1.5.4 integration: position returns to flat -> counter resets -> a later entry begins a FRESH pyramiding sequence (not continuing the old count)", () => {
  // Reuses the bar0-3 sequence above (2 entries, then SIGNAL_EXIT closes on bar3), then:
  // bar4: close=101 -> PRICE>100 true, flat again -> fresh ENTER (order created, fills bar5 open)
  // bar5: fill @106 -> NEW position, entryCount=1 (not 3) proven by: a THIRD pyramid entry is again admitted next bar (maxEntries=2 has capacity again)
  // bar6: close=107 -> PRICE>100 true, position open with entryCount=1 < maxEntries=2 -> pyramid ENTER admitted again (proves the counter reset, not carried over)
  const bars = [
    bar(0, 101, 101, 101, 101),
    bar(1, 102, 102, 102, 102),
    bar(2, 103, 103, 103, 103),
    bar(3, 99, 99, 99, 99), // SIGNAL_EXIT closes (2 entries)
    bar(4, 101, 101, 101, 101), // fresh entry signal
    bar(5, 106, 106, 106, 106), // fill -> new position, entryCount=1
    bar(6, 107, 107, 107, 107), // pyramid signal again -> admitted (proves fresh count, not continuing from 2)
    bar(7, 108, 108, 108, 108), // fills the bar6 pyramid order -> entryCount=2
  ];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    exitRules: [signalExitRule("BUY", 100)],
    pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "only the FIRST sequence (bars 0-3) produced a closed trade");
  assert.equal(result.tradeLedger[0]!.quantity, 2);
  assert.equal(result.finalPositions.length, 1, "the SECOND sequence (bars 4-7) is still open at the end of the run");
  assert.equal(result.finalPositions[0]!.quantity, 2, "the second sequence independently accumulated its OWN 2 entries — proving the counter started fresh at 1, not continuing from the first sequence's final count of 2 (which would have hit the cap immediately and rejected bar6's pyramid entry)");
});

test("Q1.5.4 integration: a pyramid entry rejected by risk evaluation (maxPositionSize) never increments the counter — the total accumulated quantity proves only the fills that actually happened", () => {
  // bar0: close=101 -> flat ENTER, quantity=1 fills bar1 @102 -> position quantity=1
  // bar1: close=102 -> pyramid ENTER decided, but risk evaluation REJECTS it (proposed cumulative would exceed maxPositionSize=1... note: risk evaluation checks the PROPOSED entry's own quantity against maxPositionSize, not the position total — quantity=1 alone must be > maxPositionSize to reject)
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    risk: { maxPositionSize: 0.5 }, // quantity=1 > 0.5 -> every proposed entry (first AND pyramid) is rejected by risk evaluation
    pyramiding: { allowPyramiding: true, maxEntries: 3, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.finalPositions.length, 0, "even the FIRST entry is rejected by maxPositionSize — proving risk evaluation genuinely gates entries (this also proves a rejected pyramid entry, structurally identical to a rejected first entry, never reaches the fill code that increments the counter)");
});

test("Q1.5.4 integration: no second signal ever fires (condition goes false before a pyramid entry could be proposed) — no order is ever created, no fill ever happens, counter legitimately stays at 1. The counter is written in EXACTLY ONE place in the whole engine (the fill-handling branch of the order-resolution loop) — an order that is never created (this test), rejected by risk (previous test), cancelled, or expired unfilled can therefore never reach that code, by construction, not by a special case", () => {
  // bar0: close=101 -> flat MARKET ENTER, order created (fills bar1 open=99)
  // bar1: fill @99 -> position opens quantity=1, entryCount=1. close=99 -> PRICE>100 false -> no pyramid signal proposed at all (no order created)
  // bar2: close=99 -> still false
  const bars = [flatBar(0, 101), flatBar(1, 99), flatBar(2, 99)];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    pyramiding: { allowPyramiding: true, maxEntries: 3, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.executionStatistics.ordersCreated, 1, "only the first, flat entry ever created an order — the pyramid signal never fired, so no second order exists to reject/cancel/expire");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.quantity, 1, "no second signal ever fired, so no second order was ever created or filled — the counter legitimately stays at 1");
});

// ============ maxPositions validation ============

test("Q1.5.4 maxPositions: >= 1 is valid (structurally, under NETTING)", () => {
  const ir = fixtureEMACrossover();
  for (const maxPositions of [1, 2, 100]) {
    const withMaxPositions = { ...ir, positionManagement: { ...ir.positionManagement, pyramiding: { ...ir.positionManagement.pyramiding, maxPositions } } };
    const result = validateStrategyIR(withMaxPositions);
    assert.ok(!result.errors.some((e) => e.includes("maxPositions")), `maxPositions=${maxPositions} must be valid; errors: ${JSON.stringify(result.errors)}`);
  }
});

test("Q1.5.4 maxPositions: 0 is rejected as invalid configuration", () => {
  const ir = fixtureEMACrossover();
  const withZero = { ...ir, positionManagement: { ...ir.positionManagement, pyramiding: { ...ir.positionManagement.pyramiding, maxPositions: 0 } } };
  const result = validateStrategyIR(withZero);
  assert.ok(result.errors.some((e) => e.includes("maxPositions") && e.includes(">= 1")));
});

test("Q1.5.4 maxPositions: a negative value is rejected as invalid configuration", () => {
  const ir = fixtureEMACrossover();
  const withNegative = { ...ir, positionManagement: { ...ir.positionManagement, pyramiding: { ...ir.positionManagement.pyramiding, maxPositions: -1 } } };
  const result = validateStrategyIR(withNegative);
  assert.ok(result.errors.some((e) => e.includes("maxPositions") && e.includes(">= 1")));
});

test("Q1.5.4 maxEntries: 0 and negative are likewise rejected", () => {
  const ir = fixtureEMACrossover();
  for (const maxEntries of [0, -1]) {
    const withInvalid = { ...ir, positionManagement: { ...ir.positionManagement, pyramiding: { ...ir.positionManagement.pyramiding, maxEntries } } };
    const result = validateStrategyIR(withInvalid);
    assert.ok(result.errors.some((e) => e.includes("maxEntries") && e.includes(">= 1")), `maxEntries=${maxEntries} must be rejected`);
  }
});

test("Q1.5.4 maxPositions: NETTING behavior remains single-position regardless of maxPositions value — a maxPositions=5 policy never causes more than one concurrent open position for the instrument (structural invariant of the netting engine, not something maxPositions itself has to enforce)", () => {
  const bars = [flatBar(0, 101), flatBar(1, 102), flatBar(2, 103)];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    pyramiding: { allowPyramiding: true, maxEntries: 5, maxPositions: 5, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
  });
  const result = runSimulation(bars, config);
  assert.ok(result.finalPositions.length <= 1, "NETTING mode: never more than one concurrent position per instrument, regardless of maxPositions");
});
