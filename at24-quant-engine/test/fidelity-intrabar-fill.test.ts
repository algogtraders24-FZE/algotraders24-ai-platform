import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIntrabarOrderFill, resolveIntrabarProtectiveExit } from "../src/runtime/fidelity/intrabar-fill.js";
import { reconstructIntrabarSequence } from "../src/runtime/fidelity/bar-magnifier.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { parentBarIdentity } from "../src/runtime/fidelity/parent-bar-identity.js";
import { createOrder } from "../src/runtime/simulation/order-engine.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { SIM_INSTRUMENT } from "./fixtures/simulation-fixtures.js";
import {
  CHILD_TIMEFRAME,
  FIXTURE_A_PARENT_BARS,
  FIXTURE_A_CHILD_BARS,
  FIXTURE_B_PARENT_BAR,
  FIXTURE_B_CHILD_BARS,
  FIXTURE_C_PARENT_BAR,
  FIXTURE_C_CHILD_BARS,
  FIXTURE_D_PARENT_BAR,
  FIXTURE_D_CHILD_BARS,
} from "./fixtures/fidelity-fixtures.js";

function sequenceFor(parentTimeframeBar: typeof FIXTURE_B_PARENT_BAR, childBars: readonly (typeof FIXTURE_B_CHILD_BARS)[number][]) {
  const provider = createStaticBarDetailProvider(childBars, CHILD_TIMEFRAME);
  const parent = parentBarIdentity(parentTimeframeBar);
  const detail = provider.getDetail({ parent, childTimeframe: CHILD_TIMEFRAME });
  return reconstructIntrabarSequence(parent, SIM_INSTRUMENT, CHILD_TIMEFRAME, detail);
}

test("resolveIntrabarProtectiveExit (Fixture A): resolves cleanly to the take-profit via child 0, never touching the later stop-level dip", () => {
  const sequence = sequenceFor(FIXTURE_A_PARENT_BARS[4]!, FIXTURE_A_CHILD_BARS);
  const outcome = resolveIntrabarProtectiveExit("BUY", 96, 111, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME);
  assert.equal(outcome.exited, true);
  assert.equal(outcome.exitPrice, 111);
  assert.equal(outcome.ambiguous, undefined);
});

test("resolveIntrabarOrderFill (Fixture B): a BUY LIMIT@100 fills at the LATER child bar that actually trades through, not the parent's aggregate", () => {
  const sequence = sequenceFor(FIXTURE_B_PARENT_BAR, FIXTURE_B_CHILD_BARS);
  const order = createOrder(
    { strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: 100, creationTimestamp: sequence.parent.openTimestamp - 1 },
    1,
  );
  const outcome = resolveIntrabarOrderFill(order, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME, ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 100);
});

test("resolveIntrabarOrderFill (Fixture C): a SELL STOP@95 gap-through fills at the worse child open (90), never at the nominal stop price, despite a MISSING middle child", () => {
  const sequence = sequenceFor(FIXTURE_C_PARENT_BAR, FIXTURE_C_CHILD_BARS);
  assert.equal(sequence.coverage, "PARTIAL");
  const order = createOrder(
    { strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "SELL", quantity: 1, orderType: "STOP", stopPrice: 95, creationTimestamp: sequence.parent.openTimestamp - 1 },
    1,
  );
  const outcome = resolveIntrabarOrderFill(order, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME, ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 90);
});

test("resolveIntrabarOrderFill (Fixture D): a BUY STOP_LIMIT triggers on child 0, stays TRIGGERED through child 1, and fills as a LIMIT on child 2 — all within the same parent bar", () => {
  const sequence = sequenceFor(FIXTURE_D_PARENT_BAR, FIXTURE_D_CHILD_BARS);
  const order = createOrder(
    { strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "STOP_LIMIT", stopPrice: 105, limitPrice: 108, creationTimestamp: sequence.parent.openTimestamp - 1 },
    1,
  );
  const outcome = resolveIntrabarOrderFill(order, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME, ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.fillPrice, 108);
});

test("resolveIntrabarOrderFill: a STOP_LIMIT that never trades through the limit within this parent's children returns triggeredOnly, not a fabricated fill", () => {
  const sequence = sequenceFor(FIXTURE_D_PARENT_BAR, [FIXTURE_D_CHILD_BARS[0]!, FIXTURE_D_CHILD_BARS[1]!]);
  const order = createOrder(
    { strategyVersion: "1.0.0", instrument: SIM_INSTRUMENT, side: "BUY", quantity: 1, orderType: "STOP_LIMIT", stopPrice: 105, limitPrice: 108, creationTimestamp: sequence.parent.openTimestamp - 1 },
    1,
  );
  const outcome = resolveIntrabarOrderFill(order, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME, ZeroSpread, ZeroSlippage);
  assert.equal(outcome.filled, false);
  assert.equal(outcome.triggeredOnly, true);
});

test("resolveIntrabarProtectiveExit: no protective levels set -> not exited, no child bars consulted", () => {
  const sequence = sequenceFor(FIXTURE_A_PARENT_BARS[4]!, FIXTURE_A_CHILD_BARS);
  const outcome = resolveIntrabarProtectiveExit("BUY", undefined, undefined, sequence, SIM_INSTRUMENT, CHILD_TIMEFRAME);
  assert.equal(outcome.exited, false);
});
