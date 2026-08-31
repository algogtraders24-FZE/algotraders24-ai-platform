import { test } from "node:test";
import assert from "node:assert/strict";
import { TimeFrontier } from "../src/runtime/time-frontier.js";
import { FIXTURE_TREND } from "./fixtures/golden-fixtures.js";

test("at cursor T, bar T+1 is not visible", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  frontier.advanceTo(FIXTURE_TREND.bars[10]!.timestamp);
  const available = frontier.availableBars();
  assert.equal(available.length, 11);
  assert.equal(available[available.length - 1]!.timestamp, FIXTURE_TREND.bars[10]!.timestamp);
  assert.ok(!available.some((b) => b.timestamp > FIXTURE_TREND.bars[10]!.timestamp));
});

test("at cursor T, a future bar's data (including its volume field) is not visible at all", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  frontier.advanceTo(FIXTURE_TREND.bars[5]!.timestamp);
  const available = frontier.availableBars();
  assert.equal(available.length, 6);
  // FIXTURE_TREND.bars[6] (a future bar relative to cursor) must not appear
  // in availableBars() by reference or by equivalent timestamp — proving
  // the frontier withholds the whole bar, not just price fields.
  assert.ok(!available.includes(FIXTURE_TREND.bars[6]!));
  assert.ok(!available.some((b) => b.timestamp === FIXTURE_TREND.bars[6]!.timestamp));
});

test("before any advanceTo() call, no bars are available", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  assert.deepEqual(frontier.availableBars(), []);
});

test("advancing the frontier monotonically reveals bars in the same deterministic order every run", () => {
  const cursors = [0, 5, 10, 15].map((i) => FIXTURE_TREND.bars[i]!.timestamp);

  function runSequence(): number[] {
    const frontier = new TimeFrontier(FIXTURE_TREND);
    const counts: number[] = [];
    for (const c of cursors) {
      frontier.advanceTo(c);
      counts.push(frontier.availableBars().length);
    }
    return counts;
  }

  assert.deepEqual(runSequence(), runSequence());
  assert.deepEqual(runSequence(), [1, 6, 11, 16]);
});

test("resetting the frontier reproduces identical state to a fresh frontier at the same cursor", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  frontier.advanceTo(FIXTURE_TREND.bars[20]!.timestamp);
  const before = frontier.availableBars();

  frontier.reset();
  assert.deepEqual(frontier.availableBars(), []);

  frontier.advanceTo(FIXTURE_TREND.bars[20]!.timestamp);
  assert.deepEqual(frontier.availableBars(), before);
});

test("advancing the cursor backward is honored literally (fewer bars become available)", () => {
  const frontier = new TimeFrontier(FIXTURE_TREND);
  frontier.advanceTo(FIXTURE_TREND.bars[20]!.timestamp);
  assert.equal(frontier.availableBars().length, 21);
  frontier.advanceTo(FIXTURE_TREND.bars[5]!.timestamp);
  assert.equal(frontier.availableBars().length, 6);
});
