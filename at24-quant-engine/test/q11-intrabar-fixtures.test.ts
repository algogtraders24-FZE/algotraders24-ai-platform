import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";

/** Q0.11.35 — same-bar order-vs-protective-level ambiguity, proven against a non-MARKET entry (a genuinely new reachable scenario, since only MARKET entries existed before Q0.11). */

test("SAME_BAR_TRIGGER_FILL: a STOP_LIMIT order whose bar opens strictly between the stop and the limit fills unambiguously at the open, same bar, no multi-bar TRIGGERED state needed", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 104, 106, 103.5, 105)]; // open(104) is >= stop(103) and <= limit(105) -- unambiguous
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(105) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 104, "an unambiguous same-bar gap fills immediately, without ever passing through a separate TRIGGERED bar");
  assert.equal(result.eventStatistics.eventsByType["ORDER_TRIGGERED"] ?? 0, 0, "the unambiguous one-step fill never needs the two-stage TRIGGERED transition at all");
});

test("PENDING_ORDER_PLUS_SL: a LIMIT order that fills and is IMMEDIATELY stopped out within the SAME bar closes correctly, with a well-defined R-multiple", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, stopLoss: { type: "fixed-distance" as const, distance: 3 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 99, 99.5, 95, 96), // limit(99) fills at open(99) [entry=99, stop=99-3=96]; the SAME bar's low(95) <= 96 -> protective stop ALSO hit this bar
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }, risk));
  assert.equal(result.tradeLedger.length, 1, "the same-bar entry+exit must be a single, complete, well-defined trade, never a dangling open position or a crash");
  assert.equal(result.tradeLedger[0]!.entryPrice, 99);
  assert.equal(result.tradeLedger[0]!.exitPrice, 96);
  assert.equal(result.tradeLedger[0]!.rMultiple, -1);
});

test("PENDING_ORDER_PLUS_TP: a STOP order that fills and immediately reaches its take-profit within the SAME bar closes correctly", () => {
  const risk = { sizing: { method: "fixed-quantity" as const, quantity: 1 }, takeProfit: { type: "fixed-distance" as const, distance: 3 } };
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 103, 108, 102.5, 106), // stop(103) fills at open(103) [entry=103, tp=103+3=106]; the SAME bar's high(108) >= 106 -> take-profit ALSO reached this bar
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }, risk));
  assert.equal(result.tradeLedger.length, 1);
  assert.equal(result.tradeLedger[0]!.entryPrice, 103);
  assert.equal(result.tradeLedger[0]!.exitPrice, 106);
  assert.equal(result.tradeLedger[0]!.grossPnl, 3);
});

test("MULTIPLE_PENDING_ORDERS: the entry condition staying true for many bars while a LIMIT order remains unfilled never creates more than ONE pending order (Q0.11.24's phantom-position/duplicate-fill protection)", () => {
  const bars = [bar(0, 105, 106, 104, 105), bar(1, 105, 106, 104, 105), bar(2, 105, 106, 104, 105), bar(3, 100.5, 101, 99, 99.5)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(100) }));
  assert.equal(result.executionStatistics.ordersCreated, 1, "only one order may ever be created, even though the entry condition (PRICE>100) stayed true for 3 bars before the limit finally filled");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.quantity, 1);
});
