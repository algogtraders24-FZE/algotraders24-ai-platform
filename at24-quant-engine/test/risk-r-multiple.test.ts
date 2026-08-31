import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRMultiple, computeCurrentR, computeRealizedR, computeTargetR } from "../src/runtime/risk/r-multiple.js";

test("computeRMultiple: a favorable move equal to the risk distance is exactly 1R", () => {
  assert.equal(computeRMultiple(2, 2), 1);
});

test("computeRMultiple: an adverse move equal to the risk distance is exactly -1R", () => {
  assert.equal(computeRMultiple(2, -2), -1);
});

test("computeRMultiple: no movement is 0R", () => {
  assert.equal(computeRMultiple(2, 0), 0);
});

test("computeRMultiple throws for a non-positive risk distance", () => {
  assert.throws(() => computeRMultiple(0, 5));
  assert.throws(() => computeRMultiple(-1, 5));
});

test("computeCurrentR: BUY at 2R favorable", () => {
  // entry 100, stop 98 (risk distance 2), current 104 -> +4 move -> 2R
  assert.equal(computeCurrentR("BUY", 100, 98, 104), 2);
});

test("computeCurrentR: SELL at 2R favorable", () => {
  // entry 100, stop 102 (risk distance 2), current 96 -> +4 favorable move -> 2R
  assert.equal(computeCurrentR("SELL", 100, 102, 96), 2);
});

test("computeCurrentR: BUY at -1R (price at the stop)", () => {
  assert.equal(computeCurrentR("BUY", 100, 98, 98), -1);
});

test("computeRealizedR and computeCurrentR agree (same formula, different call timing)", () => {
  assert.equal(computeRealizedR("BUY", 100, 98, 106), computeCurrentR("BUY", 100, 98, 106));
});

test("computeTargetR: a 2R take-profit target", () => {
  // entry 100, stop 98 (risk 2), target 104 -> +4 move -> 2R
  assert.equal(computeTargetR("BUY", 100, 98, 104), 2);
});
