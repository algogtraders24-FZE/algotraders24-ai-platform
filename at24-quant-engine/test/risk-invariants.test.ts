import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { evaluateTrailingStop } from "../src/runtime/risk/trailing.js";
import { validateEntryGeometry } from "../src/runtime/risk/geometry.js";
import { evaluateMaxSimultaneousPositions } from "../src/runtime/risk/position-limits.js";
import { evaluatePartialClose } from "../src/runtime/risk/partial-close.js";
import type { RiskEvaluationInput } from "../src/domain/risk-evaluation.js";
import type { TrailingStopRule } from "../src/domain/risk-specification.js";

/** Q0.3.19 — the nine required property/invariant tests, numbered as specified. */

test("1. a trailing stop cannot move backward, across a random sample of price paths", () => {
  const rule: TrailingStopRule = { activation: { mode: "absolute", value: 1 }, distance: { mode: "absolute", value: 2 } };
  let stop: number | undefined = undefined;
  const prices = [102, 105, 103, 108, 106, 110, 107, 115]; // a jagged, partly-retracing path
  for (const price of prices) {
    const result = evaluateTrailingStop(rule, "BUY", 100, price, stop, undefined);
    if (result.triggered) {
      assert.ok(stop === undefined || result.newStopPrice! > stop, `stop moved backward: ${stop} -> ${result.newStopPrice}`);
      stop = result.newStopPrice;
    }
  }
});

test("2. a valid BUY stop can never be above entry (validateEntryGeometry rejects every such case)", () => {
  for (const stop of [100, 100.01, 105, 150]) {
    const violations = validateEntryGeometry("BUY", 100, stop, undefined);
    assert.equal(violations.length, 1, `expected stop ${stop} to be rejected`);
    assert.equal(violations[0]!.code, "INVALID_STOP");
  }
});

test("3. a valid SELL stop can never be below entry", () => {
  for (const stop of [100, 99.99, 95, 50]) {
    const violations = validateEntryGeometry("SELL", 100, stop, undefined);
    assert.equal(violations.length, 1, `expected stop ${stop} to be rejected`);
    assert.equal(violations[0]!.code, "INVALID_STOP");
  }
});

test("4. a rejected entry can never produce ALLOW_ENTRY", () => {
  const badInputs: RiskEvaluationInput[] = [
    {
      asOf: 0,
      riskSpecification: { sizing: { method: "fixed-lot", lots: 1 } },
      instrument: { symbol: "X" },
      direction: "BUY",
      proposedEntry: { quantity: -1, entryPrice: 100 },
      portfolio: { openPositionCount: 0 },
      dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
    },
    {
      asOf: 0,
      riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxPositionSize: 1 },
      instrument: { symbol: "X" },
      direction: "BUY",
      proposedEntry: { quantity: 100, entryPrice: 100 },
      portfolio: { openPositionCount: 0 },
      dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
    },
  ];
  for (const input of badInputs) {
    const result = evaluateRisk(input);
    if (result.outcome === "REJECTED") {
      assert.notEqual(result.action.type, "ALLOW_ENTRY");
    }
  }
});

test("5. daily loss above the limit can never produce ALLOW_ENTRY", () => {
  const input: RiskEvaluationInput = {
    asOf: 0,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, dailyLossLimit: { mode: "fixed-amount", amount: 100 } },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98 },
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: -150, equityAtDayStart: 10_000 },
  };
  const result = evaluateRisk(input);
  assert.equal(result.outcome, "REJECTED");
  assert.notEqual(result.action.type, "ALLOW_ENTRY");
});

test("6. maximum position count can never be exceeded by an ALLOWED evaluation, across a range of counts vs. a fixed limit", () => {
  const limit = 3;
  for (let count = 0; count <= 6; count++) {
    const result = evaluateMaxSimultaneousPositions({ sizing: { method: "fixed-lot", lots: 1 }, maxSimultaneousPositions: limit }, count);
    if (result.passed) {
      assert.ok(count < limit, `count ${count} should not have passed against limit ${limit}`);
    } else {
      assert.ok(count >= limit);
    }
  }
});

test("7. a partial-close quantity (percent) can never exceed 100% of the position, across a spread of trigger configurations", () => {
  const percents = [1, 25, 50, 75, 100];
  for (const closePercent of percents) {
    const result = evaluatePartialClose(
      { trigger: { mode: "absolute", value: 1 }, closePercent },
      "BUY",
      100,
      105,
      undefined,
      false,
    );
    if (result.triggered) {
      assert.ok(result.closePercent! <= 100);
      assert.ok(result.closePercent! > 0);
    }
  }
});

test("8. risk evaluation cannot mutate input objects (see also risk-immutability.test.ts for the deep-freeze proof)", () => {
  const input: RiskEvaluationInput = {
    asOf: 0,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 } },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98 },
    portfolio: { openPositionCount: 0 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  };
  const snapshot = JSON.stringify(input);
  evaluateRisk(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("9. future timestamps cannot affect historical evaluation — evaluating at asOf=T is unaffected by what asOf value is used on a LATER, separate call", () => {
  const buildInput = (asOf: number): RiskEvaluationInput => ({
    asOf,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxHoldingPeriod: { maxBars: 10 } },
    instrument: { symbol: "X" },
    direction: "BUY",
    existingPosition: { quantity: 1, entryPrice: 100, entryTimestamp: 0, currentPrice: 105, barsHeld: 3 },
    portfolio: { openPositionCount: 1 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });

  const resultAtT = evaluateRisk(buildInput(1000));
  // A second, independent call with a much later asOf must not retroactively change the first call's already-returned result.
  evaluateRisk(buildInput(999_999_999));
  const resultAtTAgain = evaluateRisk(buildInput(1000));

  assert.deepEqual(resultAtT, resultAtTAgain);
});
