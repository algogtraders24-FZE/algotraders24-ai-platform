import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, buildManagementConfig } from "./fixtures/q10-position-management-fixtures.js";

/**
 * Q0.10.20 — the 12 required position-management golden fixtures. Each
 * documents its Input (the bar sequence + risk rule), Expected action
 * (which RiskAction/mapping fires and when), Expected position (the
 * resulting stopLoss/quantity/status), Expected ledger (trade count,
 * entry/exit prices, grossPnl, rMultiple), and Reason (why, in terms of
 * the exact step ordering verified in
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md / Q0.10_CONFLICT_SEMANTICS.md).
 */

// --- PM_BASIC_BREAKEVEN: proves breakeven MOVES the stop, without requiring a full exit yet ---
test("PM_BASIC_BREAKEVEN: breakeven moves the stop to entry once the trigger distance is reached, position stays open", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, breakeven: { trigger: { mode: "absolute" as const, value: 4 }, lockOffset: { mode: "absolute" as const, value: 0 } } };
  const bars = [
    bar(0, 100, 101, 99, 101), // signal: PRICE(101) > 100 -> stopLossPrice = 101-5 = 96
    bar(1, 102, 102.5, 101.5, 102), // fill at open=102, entryPrice=102, stop=96 attached
    bar(2, 103, 107, 102.5, 106), // favorable = 106-102 = 4 >= trigger(4) -> breakeven fires, newStop = 102+0 = 102
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.status, "OPEN");
  assert.equal(result.finalPositions[0]!.stopLoss, 102, "breakeven must move the stop to exactly entry (lockOffset 0)");
  assert.equal(result.finalPositions[0]!.initialStopLoss, 96, "initialStopLoss must remain the ORIGINAL stop, never overwritten by management");
  assert.equal(result.tradeLedger.length, 0, "no trade has closed yet");
});

// --- PM_LONG_BREAKEVEN: full BUY scenario through to a completed breakeven (R=0) exit ---
test("PM_LONG_BREAKEVEN: a BUY position that reaches breakeven and is then stopped out at entry closes with R=0, not a crash", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, breakeven: { trigger: { mode: "absolute" as const, value: 4 }, lockOffset: { mode: "absolute" as const, value: 0 } } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102),
    bar(2, 103, 107, 102.5, 106), // breakeven fires -> newStop = 102, takes effect starting bar 3
    bar(3, 103, 104, 101, 102), // Step 1b: OLD-loop stop is now 102 (set by bar 2's evaluation); low=101 <= 102 -> SL hit, exit at 102 (open 103 > 102)
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 102);
  assert.equal(trade.grossPnl, 0);
  assert.equal(trade.rMultiple, 0, "R-multiple must be a well-defined 0, not a thrown error, once the stop has moved to breakeven");
  assert.equal(result.finalPositions.length, 0);
});

// --- PM_SHORT_BREAKEVEN: symmetric SELL scenario ---
test("PM_SHORT_BREAKEVEN: a SELL position's breakeven/trailing semantics mirror the BUY case exactly", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, breakeven: { trigger: { mode: "absolute" as const, value: 4 }, lockOffset: { mode: "absolute" as const, value: 0 } } };
  const bars = [
    bar(0, 100, 101, 99, 99), // signal: PRICE(99) < 100 -> stopLossPrice = 99+5 = 104
    bar(1, 98, 98.5, 97.5, 98), // fill at open=98, entryPrice=98, stop=104 attached
    bar(2, 97, 97.5, 93, 94), // favorable(SELL) = 98-94 = 4 >= trigger(4) -> breakeven fires, newStop = 98-0 = 98
    bar(3, 97, 99, 96, 97), // Step 1b: stop=98 (SELL side, exit when high>=stop); high=99>=98 -> SL hit, exit at 98 (open 97 < 98)
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "SELL", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 98);
  assert.equal(trade.exitPrice, 98);
  assert.equal(trade.grossPnl, -0, "a SELL trade with zero price movement computes gross P&L as direction(-1) * 0 = -0, mathematically equal to zero");
  assert.equal(trade.rMultiple, 0, "SELL breakeven exit must also be a well-defined 0R, symmetric with the BUY case");
});

// --- PM_TRAILING: fixed-distance trailing stop, profitable exit ---
test("PM_TRAILING: a fixed-distance trailing stop only ever moves the stop favorably and locks in profit on exit", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, trailingStop: { activation: { mode: "absolute" as const, value: 3 }, distance: { mode: "absolute" as const, value: 2 } } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, stop=96
    bar(2, 103, 106, 102.5, 105), // favorable=3>=3 -> trail proposes 105-2=103 > 96 -> newStop=103
    bar(3, 106, 109, 105.5, 108), // favorable=6, trail proposes 108-2=106 > 103 -> newStop=106
    bar(4, 107, 107.5, 105, 106), // Step1b: stop=106, low=105<=106 -> SL hit, exit=106 (open 107 > 106)
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 106);
  assert.equal(trade.grossPnl, 4);
  assert.equal(trade.rMultiple, 4 / 6, "R is computed from the ORIGINAL risk distance (6), not the trailed stop");
});

// --- PM_ATR_TRAILING: same shape, but the distances are ATR-multiple, proving atrByIndex resolution works ---
test("PM_ATR_TRAILING: an atr-multiple trailing distance resolves via the supplied atrByIndex series, identically to the fixed-distance case", () => {
  const risk = {
    sizing: { method: "fixed-quantity" as const, quantity: 1 },
    stopLoss: { type: "fixed-distance" as const, distance: 5 },
    trailingStop: { activation: { mode: "atr-multiple" as const, atrMultiple: 1, atrPeriod: 14 }, distance: { mode: "atr-multiple" as const, atrMultiple: 1, atrPeriod: 14 } },
  };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102),
    bar(2, 103, 106, 102.5, 105),
    bar(3, 106, 109, 105.5, 108),
    bar(4, 107, 107.5, 105, 106),
  ];
  const atrByIndex = bars.map(() => 2); // constant ATR=2 -> activation=1*2=2, distance=1*2=2 (chosen to reproduce PM_TRAILING's exact numbers via the ATR path instead of the fixed-distance path)
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk, atrByIndex));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 106);
  assert.equal(trade.rMultiple, 4 / 6);
});

// --- PM_PARTIAL_CLOSE: a real partial close followed by a full stop-out of the remainder ---
test("PM_PARTIAL_CLOSE: closes exactly the configured percent once, then the remainder is managed independently", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 2 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, partialClose: { trigger: { mode: "absolute" as const, value: 3 }, closePercent: 50 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, qty=2, stop=96
    bar(2, 103, 106, 102.5, 105), // favorable=3>=3 -> partial close 50% of 2 = 1 unit at bar.close=105
    bar(3, 104, 104, 90, 92), // Step1b: stop=96 (unchanged), low=90<=96 -> remaining 1 unit stops out at 96
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 2, "one partial-close trade + one final stop-out trade");
  const [partial, final] = result.tradeLedger;
  assert.equal(partial!.quantity, 1);
  assert.equal(partial!.exitPrice, 105);
  assert.equal(partial!.grossPnl, 3);
  assert.equal(final!.quantity, 1);
  assert.equal(final!.exitPrice, 96);
  assert.equal(final!.grossPnl, -6);
  assert.equal(result.finalPositions.length, 0, "the remainder must also be fully closed, no quantity left dangling");
});

// --- PM_MAX_HOLDING: highest-priority forced exit, independent of price ---
test("PM_MAX_HOLDING: a position held for maxBars is force-exited at the evaluation bar's close, regardless of price", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, maxHoldingPeriod: { maxBars: 2 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry at barIndex=1, entryBarIndex=1
    bar(2, 103, 104, 101, 103), // barsHeld = 2-1 = 1 < 2, no force exit
    bar(3, 104, 108, 102, 107), // barsHeld = 3-1 = 2 >= 2 -> FORCE_EXIT at bar.close=107
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.exitPrice, 107);
  assert.equal(trade.grossPnl, 5);
  assert.equal(result.finalPositions.length, 0);
});

// --- PM_SL_TRAILING_CONFLICT: the OLD (pre-trail) stop wins when it is reachable the same bar a NEW trail level would otherwise apply ---
test("PM_SL_TRAILING_CONFLICT: a stop hit is resolved against the stop level AS OF THE START of the bar, never an improved level computed later that same bar", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, trailingStop: { activation: { mode: "absolute" as const, value: 3 }, distance: { mode: "absolute" as const, value: 2 } } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, stop=96
    bar(2, 103, 106, 102.5, 105), // trail proposes 103, newStop=103 (takes effect bar 3)
    bar(3, 104, 110, 102, 109), // Step1b uses stop=103: low=102<=103 -> SL hit at 103, even though the SAME bar's high(110) would have justified trailing much further
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.exitPrice, 103, "the stop that was already in place at the START of the bar decides the exit, not a hypothetical further trail from the same bar's high");
  assert.equal(trade.grossPnl, 1);
});

// --- PM_SL_TP_CONFLICT: both reachable within one bar -> conservative rule (stop-loss wins) ---
test("PM_SL_TP_CONFLICT: when both stop-loss and take-profit are reachable within the same bar, the stop-loss always wins", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, takeProfit: { type: "fixed-distance" as const, distance: 10 } };
  const bars = [
    bar(0, 100, 101, 99, 101), // stop=96, TP=101+10=111
    bar(1, 102, 102.5, 101.5, 102), // entry=102, stop=96, TP=111
    bar(2, 103, 115, 90, 105), // both SL(96) and TP(111) reachable within this bar
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.exitPrice, 96, "the conservative rule (never the favorable outcome) must resolve to the stop-loss");
  assert.equal(trade.grossPnl, -6);
});

// --- PM_PARTIAL_SL_CONFLICT: a same-bar stop-loss hit prevents that bar's partial-close from ever being evaluated ---
test("PM_PARTIAL_SL_CONFLICT: a stop-loss hit closes the FULL position; a same-bar partial-close trigger never gets a chance to fire on top of it", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 2 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, partialClose: { trigger: { mode: "absolute" as const, value: 3 }, closePercent: 50 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, qty=2, stop=96
    bar(2, 103, 108, 90, 95), // high=108 would satisfy partial-close's trigger(3) if evaluated, but low=90<=96 hits the stop FIRST (Step 1b runs before Step 5)
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1, "exactly one trade — a full close, never a partial-close followed by a second exit");
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.quantity, 2, "the FULL quantity closes via the stop, not the 50% the partial-close rule would have proposed");
  assert.equal(trade.exitPrice, 96);
  assert.equal(result.finalPositions.length, 0);
});

// --- PM_EXPIRY_CONFLICT: a same-bar stop-loss hit prevents that bar's max-holding-expiry force-exit from also firing ---
test("PM_EXPIRY_CONFLICT: a stop-loss hit on the same bar a holding-period would expire is the ONLY exit recorded — no duplicate/second force-exit", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 }, maxHoldingPeriod: { maxBars: 2 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry at barIndex=1
    bar(2, 103, 104, 100, 103), // barsHeld=1 < 2, survives
    bar(3, 104, 105, 90, 95), // barsHeld=2 >= 2 (would force-exit) AND low=90<=96 hits the stop first
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1, "exactly one exit event, not a stop-loss exit AND a separate forced exit");
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.exitPrice, 96, "the protective stop-loss (Step 1b) resolves the position before max-holding (Step 5) is ever evaluated");
});

// --- PM_MULTI_ACTION: breakeven and trailing on the SAME strategy, proving priority order + at-most-one-action-per-bar ---
test("PM_MULTI_ACTION: breakeven fires first while it still improves the stop; once it stops improving, trailing correctly takes over on a later bar", () => {
  const risk = {
    sizing: { method: "fixed-quantity" as const, quantity: 1 },
    stopLoss: { type: "fixed-distance" as const, distance: 5 },
    breakeven: { trigger: { mode: "absolute" as const, value: 3 }, lockOffset: { mode: "absolute" as const, value: 0 } },
    trailingStop: { activation: { mode: "absolute" as const, value: 5 }, distance: { mode: "absolute" as const, value: 2 } },
  };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, stop=96
    bar(2, 103, 106, 102.5, 105), // favorable=3 -> breakeven trigger met (3), trailing activation(5) NOT met -> breakeven fires, newStop=102
    bar(3, 106, 109, 105.5, 108), // favorable=6 -> breakeven proposes 102 again, but 102 does NOT improve on current stop 102 -> falls through to trailing: proposes 108-2=106 > 102 -> trailing fires, newStop=106
    bar(4, 107, 107.5, 105, 106), // Step1b: stop=106, low=105<=106 -> SL hit at 106
  ];

  const afterBreakeven = runSimulation(bars.slice(0, 3), buildManagementConfig(bars, "BUY", risk));
  assert.equal(afterBreakeven.finalPositions[0]!.stopLoss, 102, "bar 2 must produce the BREAKEVEN result (checked first in pipeline.ts's priority order)");

  const afterTrailingTakesOver = runSimulation(bars.slice(0, 4), buildManagementConfig(bars, "BUY", risk));
  assert.equal(afterTrailingTakesOver.finalPositions[0]!.stopLoss, 106, "bar 3 must fall through to TRAILING once breakeven's own proposal stops improving the stop");

  const full = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(full.tradeLedger.length, 1);
  assert.equal(full.tradeLedger[0]!.exitPrice, 106);
  assert.equal(full.tradeLedger[0]!.grossPnl, 4);
  assert.equal(full.tradeLedger[0]!.rMultiple, 4 / 6);
});
