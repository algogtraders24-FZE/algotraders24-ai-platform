import { test } from "node:test";
import assert from "node:assert/strict";
import { timeframeDurationMs, isValidChildTimeframe, expectedChildCount } from "../src/runtime/fidelity/timeframe-duration.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import type { OHLCVBar } from "../src/domain/market-data.js";

test("timeframeDurationMs: fixed durations for M1..W1", () => {
  assert.equal(timeframeDurationMs("M1"), 60_000);
  assert.equal(timeframeDurationMs("M5"), 300_000);
  assert.equal(timeframeDurationMs("H1"), 3_600_000);
  assert.equal(timeframeDurationMs("D1"), 86_400_000);
  assert.equal(timeframeDurationMs("W1"), 604_800_000);
});

test("timeframeDurationMs: MN1 has no fixed duration and throws", () => {
  assert.throws(() => timeframeDurationMs("MN1"), /no fixed duration/);
});

test("isValidChildTimeframe: exact-multiple relationships are valid", () => {
  assert.equal(isValidChildTimeframe("H1", "M5"), true);
  assert.equal(isValidChildTimeframe("H1", "M1"), true);
  assert.equal(isValidChildTimeframe("H4", "M15"), true);
  assert.equal(isValidChildTimeframe("M5", "M1"), true);
});

test("isValidChildTimeframe: non-multiple or non-shorter relationships are invalid", () => {
  assert.equal(isValidChildTimeframe("H1", "M30"), true); // exact multiple (2x) — still valid
  assert.equal(isValidChildTimeframe("H1", "H1"), false); // not strictly shorter
  assert.equal(isValidChildTimeframe("M15", "H1"), false); // child longer than parent
  assert.equal(isValidChildTimeframe("D1", "W1"), false); // child longer than parent (reversed)
});

test("isValidChildTimeframe: H4 to M30 is a valid exact multiple (8x)", () => {
  assert.equal(isValidChildTimeframe("H4", "M30"), true);
  assert.equal(expectedChildCount("H4", "M30"), 8);
});

test("expectedChildCount: matches duration ratio exactly", () => {
  assert.equal(expectedChildCount("H1", "M15"), 4);
  assert.equal(expectedChildCount("H1", "M5"), 12);
  assert.equal(expectedChildCount("H1", "M1"), 60);
});

test("expectedChildCount: throws for an invalid child timeframe", () => {
  assert.throws(() => expectedChildCount("M15", "H1"), /not a valid detail timeframe/);
});

test("parentBarIdentity: derives (open, close] from the bar's own close-instant timestamp", () => {
  const bar: OHLCVBar = { timestamp: 1_000_000_000_000, instrument: { symbol: "X" }, timeframe: "H1", open: 1, high: 2, low: 0, close: 1.5, volume: 1 };
  const identity = parentBarIdentity(bar);
  assert.equal(identity.closeTimestamp, 1_000_000_000_000);
  assert.equal(identity.openTimestamp, 1_000_000_000_000 - 3_600_000);
  assert.equal(identity.symbol, "X");
  assert.equal(identity.timeframe, "H1");
});
