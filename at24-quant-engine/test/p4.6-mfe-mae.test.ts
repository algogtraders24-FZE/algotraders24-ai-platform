import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { updateExcursion } from "../src/runtime/simulation/position-engine.js";
import { tryComputeR } from "../src/runtime/risk/r-multiple.js";
import { buildTrade } from "../src/runtime/simulation/trade-ledger.js";
import type { Position } from "../src/domain/position.js";
import { bar, buildManagementConfig } from "./fixtures/q10-position-management-fixtures.js";
import { bar as q15bar, buildQ15Config, signalExitRule } from "./fixtures/q15-pyramiding-exit-fixtures.js";

/**
 * P4.6 — MFE/MAE & Trade Excursion Analytics (docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md).
 * Locked semantic contract: R-multiple canonical (never a raw price
 * field), entry bar included, exit bar included with no look-ahead,
 * per-trade-row (never a synthetic position-level aggregate), pyramiding
 * preserves existing trade-row identity, intrabar precision explicitly
 * out of scope.
 *
 * Three-part test contract (per the locked refinement after this phase's
 * own audit proved riskDistance<=0 is a SINGLE underlying condition that
 * the pre-existing, deliberately out-of-scope `rMultiple` throw currently
 * masks end-to-end — see r-multiple.ts's `tryComputeR` doc comment):
 *   A. Isolated excursion normalization (tryComputeR) — proven directly,
 *      never through runSimulation().
 *   B. A CLEAN end-to-end pyramid (riskDistance stays positive) — proven
 *      through runSimulation(), mfeR/maeR correctly populated.
 *   C. The invalid-risk-distance case is NOT claimed to survive
 *      end-to-end (it does not, today) — documented as a known,
 *      disclosed negative-path coverage limitation, not silently
 *      asserted away.
 */

// ============================================================================
// A. Isolated excursion normalization — tryComputeR, direct, no simulation.
// ============================================================================

test("A1: tryComputeR — BUY, positive risk distance, favorable move returns a positive R", () => {
  // entry=102, stop=97 (riskDistance=5), price=112 -> (112-102)/5 = 2
  assert.equal(tryComputeR("BUY", 102, 97, 112), 2);
});

test("A2: tryComputeR — BUY, positive risk distance, adverse move returns a negative R", () => {
  // entry=102, stop=97 (riskDistance=5), price=92 -> (92-102)/5 = -2
  assert.equal(tryComputeR("BUY", 102, 97, 92), -2);
});

test("A3: tryComputeR — SELL mirrors BUY (favorable = price below entry)", () => {
  // entry=98, stop=103 (riskDistance=5), price=88 -> (98-88)/5 = 2
  assert.equal(tryComputeR("SELL", 98, 103, 88), 2);
  // adverse: price=108 -> (98-108)/5 = -2
  assert.equal(tryComputeR("SELL", 98, 103, 108), -2);
});

test("A4: tryComputeR — riskDistance == 0 (entry equals stop) returns null, never throws", () => {
  assert.equal(tryComputeR("BUY", 100, 100, 150), null);
});

test("A5: tryComputeR — riskDistance < 0 (entry crossed past the stop, the pyramiding case) returns null, never throws", () => {
  // BUY: entry=76 is BELOW stop=96 -> riskDistance = 76-96 = -20
  assert.doesNotThrow(() => tryComputeR("BUY", 76, 96, 50));
  assert.equal(tryComputeR("BUY", 76, 96, 50), null);
});

test("A6: tryComputeR — SELL riskDistance < 0 also returns null, never throws (symmetry)", () => {
  // SELL: entry=120 is ABOVE stop=100 -> for SELL, riskDistance = stop-entry = 100-120 = -20
  assert.doesNotThrow(() => tryComputeR("SELL", 120, 100, 110));
  assert.equal(tryComputeR("SELL", 120, 100, 110), null);
});

// ============================================================================
// A (continued): updateExcursion — pure, incremental, idempotent.
// ============================================================================

function fakePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    originatingOrderIntentId: "order-1",
    instrument: { symbol: "TEST" },
    side: "BUY",
    quantity: 1,
    entryPrice: 100,
    entryTimestamp: 0,
    status: "OPEN",
    highestPriceSinceEntry: 100,
    highestPriceSinceEntryTimestamp: 0,
    lowestPriceSinceEntry: 100,
    lowestPriceSinceEntryTimestamp: 0,
    ...overrides,
  };
}
function fakeBar(timestamp: number, high: number, low: number) {
  return { timestamp, instrument: { symbol: "TEST" }, timeframe: "H1" as const, open: (high + low) / 2, high, low, close: (high + low) / 2, volume: 1000 };
}

test("A7: updateExcursion — a bar with a new high raises highestPriceSinceEntry and records its own timestamp", () => {
  const updated = updateExcursion(fakePosition(), fakeBar(1000, 110, 99));
  assert.equal(updated.highestPriceSinceEntry, 110);
  assert.equal(updated.highestPriceSinceEntryTimestamp, 1000);
  assert.equal(updated.lowestPriceSinceEntry, 99);
  assert.equal(updated.lowestPriceSinceEntryTimestamp, 1000);
});

test("A8: updateExcursion — a bar entirely within the current range changes nothing (not even re-stamping the timestamp)", () => {
  const seeded = fakePosition({ highestPriceSinceEntry: 110, highestPriceSinceEntryTimestamp: 1000, lowestPriceSinceEntry: 90, lowestPriceSinceEntryTimestamp: 1000 });
  const updated = updateExcursion(seeded, fakeBar(2000, 105, 95));
  assert.equal(updated.highestPriceSinceEntry, 110);
  assert.equal(updated.highestPriceSinceEntryTimestamp, 1000, "must NOT be re-stamped to bar 2000 just because that bar was also processed");
  assert.equal(updated.lowestPriceSinceEntry, 90);
  assert.equal(updated.lowestPriceSinceEntryTimestamp, 1000);
});

test("A9: updateExcursion — applying the SAME bar twice is idempotent (the exact property Step 1's opposite-fill-close path and Step 1.5's general update both rely on)", () => {
  const once = updateExcursion(fakePosition(), fakeBar(500, 120, 80));
  const twice = updateExcursion(once, fakeBar(500, 120, 80));
  assert.deepEqual(once, twice);
});

// ============================================================================
// B. Clean end-to-end tests through runSimulation() — entry bar, exit bar,
//    no-lookahead, BUY/SELL asymmetry, partial-close row-level, and a
//    pyramid where riskDistance stays POSITIVE throughout.
// ============================================================================

test("B1: entry bar inclusion — the fill bar's OWN high (not just later bars) drives mfeR, matching resolveProtectiveExit's established 'the rest of the bar's range still applies' precedent", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 } };
  const bars = [
    bar(0, 100, 101, 99, 101), // signal bar, PRICE>100
    bar(1, 102, 115, 101, 103), // ENTRY bar: fills at open=102; its OWN high=115 must count
    bar(2, 103, 104, 102, 103), // unremarkable
    bar(3, 100, 101, 90, 91), // stop (96) hit: low=90<=96, open=100>96 (no gap) -> exits at 96
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.entryPrice, 102);
  assert.equal(trade.exitPrice, 96);
  // riskDistance = 102-96 = 6; mfe favorable price = 115 (the ENTRY bar's own high) -> (115-102)/6
  assert.equal(trade.mfeR, (115 - 102) / 6);
  assert.equal(trade.mfeTimestamp, bars[1]!.timestamp, "the entry bar's own timestamp, not a later one");
});

test("B2: exit bar inclusion + no-lookahead in one scenario — the exit bar's own extreme counts; a LATER bar's even-more-extreme price must never leak backward into the already-closed trade", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 103, 101, 102), // entry, modest range
    bar(2, 102, 104, 101, 102), // modest
    bar(3, 100, 200, 90, 91), // EXIT bar: low=90 hits stop(96, open=100 no gap -> exits at 96); its OWN high=200 must count toward mfe
    bar(4, 500, 999, 498, 500), // AFTER exit — must NEVER affect the already-closed trade
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 1);
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.exitTimestamp, bars[3]!.timestamp, "closed on the exit bar, never bar 4");
  // riskDistance=6; mfe should reflect 200 (exit bar's own high), never 999 (post-exit bait)
  assert.equal(trade.mfeR, (200 - 102) / 6, "the exit bar's own high must count");
  assert.notEqual(trade.mfeR, (999 - 102) / 6, "a bar AFTER the close must never leak into this trade's excursion");
  assert.equal(trade.mfeTimestamp, bars[3]!.timestamp);
});

test("B3: BUY vs SELL asymmetry — favorable/adverse correctly swap (BUY: favorable=high/adverse=low; SELL: favorable=low/adverse=high)", () => {
  const riskBuy = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 } };
  const buyBars = [bar(0, 100, 101, 99, 101), bar(1, 102, 112, 98, 103), bar(2, 100, 101, 90, 91)];
  const buyResult = runSimulation(buyBars, buildManagementConfig(buyBars, "BUY", riskBuy));
  const buyTrade = buyResult.tradeLedger[0]!;
  assert.ok(buyTrade.mfeR! > 0, "BUY favorable move (price went up to 112) must be a positive mfeR");
  assert.ok(buyTrade.maeR! < 0, "BUY adverse move (price went down) must be a negative maeR");

  const riskSell = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 5 } };
  const sellBars = [bar(0, 100, 101, 99, 99), bar(1, 98, 102, 88, 92), bar(2, 100, 110, 99, 105)];
  const sellResult = runSimulation(sellBars, buildManagementConfig(sellBars, "SELL", riskSell));
  const sellTrade = sellResult.tradeLedger[0]!;
  assert.ok(sellTrade.mfeR! > 0, "SELL favorable move (price went DOWN to 88) must be a positive mfeR");
  assert.ok(sellTrade.maeR! < 0, "SELL adverse move (price went UP) must be a negative maeR");
});

test("B4: partial close — each SimulationTrade row gets its OWN mfeR/maeR reflecting excursion up to THAT row's own exit; the later row's excursion correctly CONTINUES the position's full history, never resets or redistributes", () => {
  // Mirrors q10-golden-fixtures.test.ts's own PM_PARTIAL_CLOSE fixture exactly (entry=102, stop=96, riskDistance=6).
  const risk = {
    sizing: { method: "fixed-quantity" as const, quantity: 2 },
    stopLoss: { type: "fixed-distance" as const, distance: 5 },
    partialClose: { trigger: { mode: "absolute" as const, value: 3 }, closePercent: 50 },
  };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 102.5, 101.5, 102), // entry=102, qty=2, stop=96
    bar(2, 103, 106, 102.5, 105), // favorable=3>=3 -> partial close 50% of 2 = 1 unit at close=105; this bar's high=106 is the running max at this point
    bar(3, 104, 104, 90, 92), // remaining 1 unit stops out at 96; this bar's low=90 is a NEW running min
  ];
  const result = runSimulation(bars, buildManagementConfig(bars, "BUY", risk));
  assert.equal(result.tradeLedger.length, 2, "one partial-close row + one final row");
  const [partial, final] = result.tradeLedger;

  assert.equal(partial!.quantity, 1);
  assert.equal(partial!.exitPrice, 105);
  // Up through bar2 (the partial-close bar): high=106, low=101.5 -> riskDistance=6
  assert.equal(partial!.mfeR, (106 - 102) / 6, "the partial row's own mfeR reflects excursion up to ITS OWN exit bar (bar2), not the final row's later history");
  assert.equal(partial!.maeR, (101.5 - 102) / 6);

  assert.equal(final!.quantity, 1);
  assert.equal(final!.exitPrice, 96);
  // Up through bar3: high is STILL 106 (bar3's own high=104 < 106, no new max) - the position's
  // history from BEFORE the partial close correctly carries forward, never reset.
  assert.equal(final!.mfeR, (106 - 102) / 6, "the final row's mfeR still reflects bar2's 106 high, proving a partial close does not reset or forget prior excursion history");
  // low updates to bar3's own 90 - a NEW extreme reached after the partial close.
  assert.equal(final!.maeR, (90 - 102) / 6, "the final row's maeR reflects the NEW, worse extreme reached after the partial close");
});

test("B5: a CLEAN pyramid (riskDistance stays POSITIVE throughout) — mfeR/maeR attach correctly to the resulting trade row, no crash, no synthetic aggregate position", () => {
  const bars = [
    q15bar(0, 101, 101, 101, 101), // signal
    q15bar(1, 102, 103, 101, 102), // entry fill @102, qty=1; still true at close -> pyramid ENTER admitted
    q15bar(2, 104, 118, 103, 105), // pyramid fill @104 (a MODEST add, stays well clear of the stop) -> avg entry = (102+104)/2 = 103; this bar's own high=118 is a new max
    q15bar(3, 99, 99, 90, 99), // SIGNAL_EXIT (PRICE<100) fires at close=99
  ];
  const config = buildQ15Config(bars, {
    direction: "BUY",
    exitRules: [signalExitRule("BUY", 100)],
    pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
    risk: { stopLoss: { type: "fixed-distance", distance: 5 } },
  });
  const result = runSimulation(bars, config);
  assert.equal(result.tradeLedger.length, 1, "the pyramid + exit produces ONE trade row for the whole (now 2-unit) position — no synthetic per-leg aggregate");
  const trade = result.tradeLedger[0]!;
  assert.equal(trade.quantity, 2);
  assert.equal(trade.entryPrice, 103, "volume-weighted average of the two fills (102, 104)");
  // stop resolved at signal time from bar0's close (101): 101-5=96. riskDistance = 103-96 = 7 > 0 - a CLEAN pyramid.
  assert.ok(trade.rMultiple !== null, "a sanity check that this specific scenario does NOT hit the deferred rMultiple defect - riskDistance stays positive");
  assert.notEqual(trade.mfeR, null, "mfeR must be populated for a clean pyramid, not null");
  assert.equal(trade.mfeR, (118 - 103) / 7, "reflects bar2's own 118 high (the pyramid/entry bar for the second leg), using the POST-pyramid weighted-average entry as the R basis - the same basis rMultiple itself uses");
});

// ============================================================================
// C. Documented negative-path coverage limitation (NOT a false "does not
//    crash" claim). See r-multiple.ts's tryComputeR doc comment and this
//    phase's own audit for the full explanation of WHY this is a real,
//    disclosed architectural coupling — not something P4.6 silently works
//    around or claims to have solved.
// ============================================================================

test("C1 (documents a known limitation, does not claim it is fixed): a pyramid that pushes the weighted-average entryPrice past the fixed initialStopLoss makes riskDistance <= 0 for BOTH rMultiple and mfeR/maeR (they share the identical risk-distance computation) - and rMultiple's own pre-existing, unguarded computation throws FIRST, before mfeR/maeR's own null-guard is ever reached. This is the deferred rMultiple defect this phase's audit found and explicitly declined to fix; it is NOT a P4.6 regression, and this test does not claim runSimulation() completes in this scenario - only that buildTrade(), called directly, throws at the expected line, for the expected reason.", () => {
  const pyramidedPosition: Position = fakePosition({
    side: "BUY",
    entryPrice: 76, // volume-weighted average AFTER a pyramid add at a low price
    initialStopLoss: 96, // fixed since entry - never moves
    stopLoss: 96,
    highestPriceSinceEntry: 80,
    lowestPriceSinceEntry: 48,
  });
  assert.throws(
    () =>
      buildTrade({
        tradeId: "t1",
        strategyVersion: "1.0.0",
        position: pyramidedPosition,
        exitPrice: 50,
        exitTimestamp: 1000,
        quantity: 2,
        grossPnl: -52,
        fees: 0,
        fillModel: "BarFillModel",
        spreadModel: "ZeroSpread",
        slippageModel: "ZeroSlippage",
        feeModel: "ZeroFee",
      }),
    /riskDistance must be > 0/,
    "buildTrade() throws via the PRE-EXISTING rMultiple computation, before mfeR/maeR's own tryComputeR-based guard ever runs - proving the coupling this phase disclosed, not silently working around it",
  );
});

test("C2 (the guard itself, in isolation): tryComputeR alone - the exact same entry/stop pair from C1 - correctly returns null and never throws, proving mfeR/maeR's OWN logic is correct even though it cannot be observed through buildTrade() today", () => {
  assert.doesNotThrow(() => tryComputeR("BUY", 76, 96, 80));
  assert.equal(tryComputeR("BUY", 76, 96, 80), null);
  assert.equal(tryComputeR("BUY", 76, 96, 48), null);
});
