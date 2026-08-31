import { test } from "node:test";
import assert from "node:assert/strict";
import { mapRiskAction } from "../src/runtime/simulation/risk-action-mapping.js";
import type { RiskAction } from "../src/domain/risk-evaluation.js";

test("ALLOW_ENTRY -> CREATE_ENTRY_ORDER (MARKET)", () => {
  const mapping = mapRiskAction({ type: "ALLOW_ENTRY" });
  assert.deepEqual(mapping, { kind: "CREATE_ENTRY_ORDER", orderType: "MARKET" });
});

test("REJECT_ENTRY -> NO_OP", () => {
  assert.deepEqual(mapRiskAction({ type: "REJECT_ENTRY" }), { kind: "NO_OP" });
});

test("NO_ACTION -> NO_OP", () => {
  assert.deepEqual(mapRiskAction({ type: "NO_ACTION" }), { kind: "NO_OP" });
});

test("MOVE_STOP -> MODIFY_STOP carrying the new stop price", () => {
  const mapping = mapRiskAction({ type: "MOVE_STOP", newStopPrice: 123.45 });
  assert.deepEqual(mapping, { kind: "MODIFY_STOP", newStopPrice: 123.45 });
});

test("PARTIAL_CLOSE -> REDUCE_POSITION carrying the close percent", () => {
  const mapping = mapRiskAction({ type: "PARTIAL_CLOSE", closePercent: 50 });
  assert.deepEqual(mapping, { kind: "REDUCE_POSITION", closePercent: 50 });
});

test("FORCE_EXIT_REQUIRED -> FORCE_EXIT", () => {
  const mapping = mapRiskAction({ type: "FORCE_EXIT_REQUIRED", reasonCode: "MAX_HOLDING_PERIOD" });
  assert.deepEqual(mapping, { kind: "FORCE_EXIT" });
});

test("an unrecognized action shape fails explicitly rather than silently mapping to NO_OP", () => {
  const bogus = { type: "SOMETHING_ELSE" } as unknown as RiskAction;
  assert.throws(() => mapRiskAction(bogus));
});
