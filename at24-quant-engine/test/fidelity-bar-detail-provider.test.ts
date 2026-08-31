import { test } from "node:test";
import assert from "node:assert/strict";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import { FIXTURE_A_PARENT_BARS, FIXTURE_A_CHILD_BARS, FIXTURE_C_PARENT_BAR, FIXTURE_C_CHILD_BARS, CHILD_TIMEFRAME } from "./fixtures/fidelity-fixtures.js";

test("createStaticBarDetailProvider: COMPLETE when all 4 expected M15 children are present", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const result = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.bars.length, 4);
});

test("createStaticBarDetailProvider: MISSING when no children fall inside the parent's window", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[0]!); // bar 0 has no supplied children
  const result = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "MISSING");
  assert.equal(result.bars.length, 0);
});

test("createStaticBarDetailProvider: PARTIAL when fewer than the expected count is present", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_C_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_C_PARENT_BAR);
  const result = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.bars.length, 3);
});

test("createStaticBarDetailProvider: a mismatched requested childTimeframe is MISSING, never silently substituted", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const result = provider.getDetail({ parent, childTimeframe: "M1" });
  assert.equal(result.status, "MISSING");
});

test("createStaticBarDetailProvider: children belonging to a DIFFERENT (later) parent never leak into this parent's query, regardless of what else the backing array holds (Q0.6.23)", () => {
  // The backing array holds children for parent 4 only, but querying an
  // earlier, empty-of-data parent (bar 0) must not accidentally return
  // parent 4's children even though they are chronologically later.
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent0 = parentBarIdentity(FIXTURE_A_PARENT_BARS[0]!);
  const result = provider.getDetail({ parent: parent0, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "MISSING");
  assert.equal(result.bars.length, 0, "parent 4's children must never appear in parent 0's result");
});
