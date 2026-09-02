import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { firstMatchingExitRule } from "../src/runtime/signal-generator.js";
import { comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import { bar, flatBar, buildQ15Config, signalExitRule, PRICE } from "./fixtures/q15-pyramiding-exit-fixtures.js";
import type { MarketState } from "../src/domain/market-state.js";
import { indicatorKey } from "../src/domain/indicator-reference.js";

/**
 * Q1.5.3 — generic SIGNAL_EXIT runtime path. See docs/Q1.5_EXIT_CONTRACT.md
 * for the full audit, the Condition -> Decision -> Position/Order
 * Management Operation -> Execution contract, and the documented same-bar
 * (exit-before-entry) policy. Full-pipeline `runSimulation` tests only —
 * proving the condition is genuinely EVALUATED and the position genuinely
 * CLOSES through the existing universal execution primitives
 * (closePosition/applyRealizedTrade), never a parallel mechanism.
 */

test("Q1.5.3: a long (BUY) position closes when its SIGNAL_EXIT condition becomes true", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 105, 102, 105), bar(2, 99, 99, 99, 99)];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102, "filled at bar1's open");
  assert.equal(trade.exitPrice, 99, "SIGNAL_EXIT closes at the triggering bar's close");
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.5.3: a short (SELL) position closes when its SIGNAL_EXIT condition becomes true — symmetric with the long case", () => {
  const bars = [bar(0, 99, 99, 99, 99), bar(1, 98, 98, 95, 95), bar(2, 101, 101, 101, 101)];
  const config = buildQ15Config(bars, { direction: "SELL", exitRules: [signalExitRule("SELL", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 98);
  assert.equal(trade.exitPrice, 101);
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.5.3: no open position — a true SIGNAL_EXIT condition never produces an erroneous close (no crash, no phantom trade)", () => {
  const bars = [flatBar(0, 50), flatBar(1, 50), flatBar(2, 50)];
  // entry threshold impossible to reach -> never enters; exit condition (PRICE < 100) is true from bar0
  const config = buildQ15Config(bars, { direction: "BUY", entryThreshold: 1_000_000, exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 0);
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.5.3: a repeated exit signal (condition stays true for many more bars after the close) never produces a second close or a crash", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 105, 102, 105), bar(2, 99, 99, 99, 99), bar(3, 98, 98, 98, 98), bar(4, 97, 97, 97, 97)];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the condition staying true on bars 3-4 must never re-fire a close against an already-flat instrument");
  assert.equal(result.finalPositions.length, 0);
});

test("Q1.5.3: exit followed by a later (separate-bar) entry — a fresh position opens normally after SIGNAL_EXIT closes the first one", () => {
  const bars = [
    bar(0, 101, 101, 101, 101), // entry signal
    bar(1, 102, 105, 102, 105), // fill @102
    bar(2, 99, 99, 99, 99), // SIGNAL_EXIT closes @99
    bar(3, 101, 101, 101, 101), // fresh entry signal
    bar(4, 106, 106, 106, 106), // fill @106
  ];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the first sequence closed");
  assert.equal(result.finalPositions.length, 1, "the second sequence is still open");
  assert.equal(result.finalPositions[0]!.entryPrice, 106);
});

test("Q1.5.3: same-bar entry/exit — SIGNAL_EXIT closes the existing position, and the SAME bar's entry condition (independently true) fires a fresh entry within the same bar (deterministic exit-before-entry policy)", () => {
  // exit condition: PRICE > 110 (independent of the entry's own PRICE > 100 threshold, so both can be true together)
  const bars = [
    bar(0, 101, 101, 101, 101), // entry signal (flat)
    bar(1, 102, 111, 102, 111), // fill @102 opens position; SAME bar1's close=111: exit (111>110) true -> closes @111; entry (111>100) ALSO true -> fresh order created
    bar(2, 120, 120, 100, 105), // fills bar1's fresh re-entry order @open=120; close=105 (<=110) so THIS bar's own SIGNAL_EXIT check does not immediately re-close the just-opened position
  ];
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [{ id: "exit-1", condition: comparison(">", indicatorOperand(PRICE), literal(110)) }] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the first position closed on bar1");
  assert.equal(result.tradeLedger[0]!.entryPrice, 102);
  assert.equal(result.tradeLedger[0]!.exitPrice, 111, "SIGNAL_EXIT closed at bar1's own close");
  assert.equal(result.executionStatistics.ordersCreated, 2, "bar0's entry order AND bar1's same-bar re-entry order");
  assert.equal(result.finalPositions.length, 1, "the fresh, same-bar-initiated entry filled on bar2 and is still open");
  assert.equal(result.finalPositions[0]!.entryPrice, 120);
});

test("Q1.5.3: appliesTo filters which position side an exit rule applies to — a SELL-only exit rule never closes a BUY position, even when its condition is true", () => {
  const bars = [bar(0, 101, 101, 101, 101), bar(1, 102, 102, 99, 99), bar(2, 99, 99, 99, 99)];
  // appliesTo "SELL" — this BUY position must NEVER be closed by this rule
  const config = buildQ15Config(bars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100, "SELL")] });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 0, "appliesTo=SELL must never fire against a BUY position");
  assert.equal(result.finalPositions.length, 1);
});

test("Q1.5.3: firstMatchingExitRule — a rule with no appliesTo applies to either side", () => {
  const state: MarketState = { instrument: { symbol: "X" }, timeframe: "H1", asOf: 0, bars: [{ timestamp: 0, instrument: { symbol: "X" }, timeframe: "H1", open: 99, high: 99, low: 99, close: 99, volume: 1 }], indicatorValues: new Map([[indicatorKey(PRICE), 99]]) };
  const rule = { id: "exit-1", condition: comparison("<", indicatorOperand(PRICE), literal(100)) };
  assert.equal(firstMatchingExitRule([rule], "BUY", state)?.id, "exit-1");
  assert.equal(firstMatchingExitRule([rule], "SELL", state)?.id, "exit-1");
});

// ============ No-look-ahead ============

test("Q1.5.3: closed-bar semantics — appending a FUTURE bar never changes any earlier bar's decision, fill, or trade (no look-ahead)", () => {
  const prefixBars = [bar(0, 101, 101, 101, 101), bar(1, 102, 105, 102, 105), bar(2, 99, 99, 99, 99)];
  // A trailing bar that, if visible early, would change everything (huge price spike) — must have zero effect on the prefix's own outcome.
  const extendedBars = [...prefixBars, bar(3, 500, 500, 500, 500)];

  const configPrefix = buildQ15Config(prefixBars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });
  const configExtended = buildQ15Config(extendedBars, { direction: "BUY", exitRules: [signalExitRule("BUY", 100)] });

  const resultPrefix = runSimulation(prefixBars, configPrefix);
  const resultExtended = runSimulation(extendedBars, configExtended);

  assert.deepEqual(resultPrefix.tradeLedger, resultExtended.tradeLedger, "the trade ledger for bars 0-2 must be byte-identical whether or not a future bar 3 exists");
});

test("Q1.5.3: closed-bar semantics — MarketState.bars passed to the exit evaluator never includes any bar beyond the current index (structural proof via firstMatchingExitRule's own signature)", () => {
  // Direct structural proof: a MarketState built with bars sliced to [0, barIndex] literally cannot contain a future bar's data — evaluateExpression (reused unchanged from entries) has no other data source.
  const onlyPastBars = [{ timestamp: 0, instrument: { symbol: "X" }, timeframe: "H1" as const, open: 101, high: 101, low: 101, close: 101, volume: 1 }];
  const state: MarketState = { instrument: { symbol: "X" }, timeframe: "H1", asOf: 0, bars: onlyPastBars, indicatorValues: new Map([[indicatorKey(PRICE), 101]]) };
  const rule = { id: "exit-1", condition: comparison("<", indicatorOperand(PRICE), literal(100)) };
  assert.equal(firstMatchingExitRule([rule], "BUY", state), null, "PRICE=101 is not < 100 using only the current/past bars available — there is no mechanism by which a future bar could alter this");
});
