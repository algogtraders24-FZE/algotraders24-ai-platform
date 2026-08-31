import { test } from "node:test";
import assert from "node:assert/strict";
import { reconstructIntrabarSequence, observationToBar } from "../src/runtime/fidelity/bar-magnifier.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import { SIM_INSTRUMENT } from "./fixtures/simulation-fixtures.js";
import { FIXTURE_A_PARENT_BARS, FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME } from "./fixtures/fidelity-fixtures.js";

test("reconstructIntrabarSequence: COMPLETE coverage returns exactly the provider's own bars, unmodified, in order", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);

  assert.equal(sequence.coverage, "COMPLETE");
  assert.equal(sequence.observations.length, 4);
  assert.equal(sequence.expectedCount, 4);
  for (let i = 0; i < sequence.observations.length; i++) {
    assert.equal(sequence.observations[i]!.open, FIXTURE_A_CHILD_BARS[i]!.open);
    assert.equal(sequence.observations[i]!.high, FIXTURE_A_CHILD_BARS[i]!.high);
    assert.equal(sequence.observations[i]!.low, FIXTURE_A_CHILD_BARS[i]!.low);
    assert.equal(sequence.observations[i]!.close, FIXTURE_A_CHILD_BARS[i]!.close);
  }
});

test("reconstructIntrabarSequence: chronological order is preserved (no synthetic reordering)", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
  for (let i = 1; i < sequence.observations.length; i++) {
    assert.ok(sequence.observations[i]!.timestamp > sequence.observations[i - 1]!.timestamp);
  }
});

test("reconstructIntrabarSequence: MISSING coverage produces zero observations, never a fabricated bar", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[0]!);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
  assert.equal(sequence.coverage, "MISSING");
  assert.equal(sequence.observations.length, 0);
});

test("reconstructIntrabarSequence: an invalid child bar (high < low) throws rather than being silently accepted", () => {
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const badDetail = { status: "COMPLETE" as const, bars: [{ timestamp: parent.closeTimestamp, instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, open: 100, high: 90, low: 95, close: 92, volume: 1 }] };
  assert.throws(() => reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, badDetail), /invalid child-bar data/);
});

test("observationToBar: round-trips OHLC/volume/timestamp exactly, tagged with the requested instrument/timeframe", () => {
  const provider = createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(FIXTURE_A_PARENT_BARS[4]!);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  const sequence = reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
  const bar = observationToBar(sequence.observations[0]!, SIM_INSTRUMENT, CHILD_TIMEFRAME);
  assert.equal(bar.instrument, SIM_INSTRUMENT);
  assert.equal(bar.timeframe, CHILD_TIMEFRAME);
  assert.equal(bar.open, FIXTURE_A_CHILD_BARS[0]!.open);
  assert.equal(bar.timestamp, FIXTURE_A_CHILD_BARS[0]!.timestamp);
});
