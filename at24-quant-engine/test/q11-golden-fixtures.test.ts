import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/runtime/simulation/simulation-engine.js";
import { bar, absolute, buildOrderTypeConfig } from "./fixtures/q11-order-fixtures.js";

/** Q0.11.33 — the 8 required order-type golden fixtures. */

test("MARKET_BUY: a BUY entry with no executionType fills at the very next bar's open, unchanged Q0.5 behavior", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 102, 102.5, 101.5, 102)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "MARKET"));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 102);
});

test("MARKET_SELL: a SELL entry fills at the very next bar's open", () => {
  const bars = [bar(0, 100, 101, 99, 99), bar(1, 98, 98.5, 97.5, 98)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "SELL", "MARKET"));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 98);
});

test("LIMIT_BUY: a BUY limit below current price only fills once price trades through it (strict trade-through)", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 100, 100.5, 98, 99)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "LIMIT", { limitPrice: absolute(99) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 99, "fills exactly at the limit, never better or worse, on a strict trade-through");
});

test("LIMIT_SELL: a SELL limit above current price only fills once price trades through it", () => {
  const bars = [bar(0, 100, 101, 99, 99), bar(1, 100, 102, 99.5, 101)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "SELL", "LIMIT", { limitPrice: absolute(101) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 101);
});

test("STOP_BUY: a BUY stop above current price fills once price breaks out through it", () => {
  const bars = [bar(0, 100, 101, 99, 101), bar(1, 101, 104, 100.5, 103)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP", { stopPrice: absolute(103) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 103, "an unambiguous (no-gap) stop fills exactly at the stop level");
});

test("STOP_SELL: a SELL stop below current price fills once price breaks down through it", () => {
  const bars = [bar(0, 100, 101, 99, 99), bar(1, 99, 99.5, 96, 97)];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "SELL", "STOP", { stopPrice: absolute(97) }));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 97);
});

test("STOP_LIMIT_BUY: the two-stage lifecycle — stop triggers on one bar, limit fills on a later bar", () => {
  const bars = [
    bar(0, 100, 101, 99, 101),
    bar(1, 102, 103.5, 101.5, 103), // stop(103) triggers intrabar (high>=103), but open(102) proves neither the gap-through-both nor the limit(104) -> TRIGGERED only
    bar(2, 103, 105, 102, 104), // now evaluated as a plain BUY limit(104): open(103) <= 104 -> favorable-gap fill at 103
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "BUY", "STOP_LIMIT", { stopPrice: absolute(103), limitPrice: absolute(104) }));
  assert.ok(result.eventStatistics.eventsByType["ORDER_TRIGGERED"], "the stop trigger must be a recorded, visible event even though no fill happened on that bar");
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 103);
});

test("STOP_LIMIT_SELL: the two-stage lifecycle mirrors BUY for a SELL stop-limit", () => {
  const bars = [
    bar(0, 100, 101, 99, 99),
    bar(1, 98, 98.5, 96.5, 97), // stop(97) triggers intrabar (low<=97), open(98) proves neither gap-through-both nor limit(96) -> TRIGGERED only
    bar(2, 97, 97.5, 94, 96), // now evaluated as a plain SELL limit(96): open(97) >= 96 -> favorable-gap fill at 97
  ];
  const result = runSimulation(bars, buildOrderTypeConfig(bars, "SELL", "STOP_LIMIT", { stopPrice: absolute(97), limitPrice: absolute(96) }));
  assert.ok(result.eventStatistics.eventsByType["ORDER_TRIGGERED"]);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]!.entryPrice, 97);
});
