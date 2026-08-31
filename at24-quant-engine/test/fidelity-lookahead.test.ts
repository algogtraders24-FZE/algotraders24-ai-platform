import { test } from "node:test";
import assert from "node:assert/strict";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import { TimeFrontier } from "../src/runtime/time-frontier.js";
import { SIM_INSTRUMENT, SIM_TIMEFRAME } from "./fixtures/simulation-fixtures.js";
import { CHILD_TIMEFRAME, FIXTURE_EF_PARENT_BAR_40, FIXTURE_EF_PARENT_BAR_41, FIXTURE_EF_CHILDREN_40, FIXTURE_EF_CHILDREN_41 } from "./fixtures/fidelity-fixtures.js";

test("Q0.6.23: a BarDetailProvider whose backing array ALSO holds a later parent's children never returns them for an earlier parent's query", () => {
  const provider = createStaticBarDetailProvider([...FIXTURE_EF_CHILDREN_40, ...FIXTURE_EF_CHILDREN_41], CHILD_TIMEFRAME);
  const parent40 = parentBarIdentity(FIXTURE_EF_PARENT_BAR_40);
  const result = provider.getDetail({ parent: parent40, childTimeframe: CHILD_TIMEFRAME });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.bars.length, 4);
  for (const b of result.bars) {
    assert.ok(b.timestamp <= parent40.closeTimestamp, "no child of parent 41 (all of which have timestamp > parent 40's close) may appear in parent 40's result");
  }
});

test("Q0.6.24: appending a LATER parent's children to the provider's backing array does not change an EARLIER parent's already-computed detail result", () => {
  const providerBefore = createStaticBarDetailProvider(FIXTURE_EF_CHILDREN_40, CHILD_TIMEFRAME);
  const providerAfter = createStaticBarDetailProvider([...FIXTURE_EF_CHILDREN_40, ...FIXTURE_EF_CHILDREN_41], CHILD_TIMEFRAME);
  const parent40 = parentBarIdentity(FIXTURE_EF_PARENT_BAR_40);

  const before = providerBefore.getDetail({ parent: parent40, childTimeframe: CHILD_TIMEFRAME });
  const after = providerAfter.getDetail({ parent: parent40, childTimeframe: CHILD_TIMEFRAME });

  assert.deepEqual(before, after);
});

test("Q0.6.25/26: TimeFrontier (Q0.2, reused not duplicated) applies identically to a lower-timeframe child series — at cursor T, a future child bar is not visible, exactly as it is for parent bars", () => {
  const series = { instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, bars: FIXTURE_EF_CHILDREN_40 };
  const frontier = new TimeFrontier(series);
  frontier.advanceTo(FIXTURE_EF_CHILDREN_40[1]!.timestamp);
  const available = frontier.availableBars();
  assert.equal(available.length, 2);
  assert.ok(available.every((b) => b.timestamp <= FIXTURE_EF_CHILDREN_40[1]!.timestamp));
});

test("parentBarIdentity's own (open, close] boundary is what structurally prevents lookahead: parent 41's window starts exactly where parent 40's ends", () => {
  const parent40 = parentBarIdentity(FIXTURE_EF_PARENT_BAR_40);
  const parent41 = parentBarIdentity(FIXTURE_EF_PARENT_BAR_41);
  assert.equal(parent41.openTimestamp, parent40.closeTimestamp);
  assert.equal(SIM_TIMEFRAME, "H1");
});
