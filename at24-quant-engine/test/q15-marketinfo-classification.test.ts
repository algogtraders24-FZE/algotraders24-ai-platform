import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";

/**
 * Q1.5.5 — MQL4 `MarketInfo()` classification. See
 * docs/Q1.5_MARKETINFO_CLASSIFICATION.md for the full audit/matrix. Mirrors
 * test/q0.8.39-broker-constraint-contract.test.ts's own structure exactly —
 * small, hand-crafted, non-G01 fixtures proving the classifier's own
 * correctness directly.
 */

const OPTS = { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5" as const, importedAt: 0 };

function importSource(sourceText: string) {
  return importMQLSource({ sourceText, fileName: "x.mq4", forcedDialect: "MQL4", options: OPTS });
}

function marketInfoFixture(mode: string): string {
  return `void OnTick()\n{\ndouble v = MarketInfo(Symbol(), ${mode});\n}\nint OnInit() { return(0); }\n`;
}

// --- all five broker constraints classify correctly ---
for (const mode of ["MODE_STOPLEVEL", "MODE_FREEZELEVEL", "MODE_MINLOT", "MODE_MAXLOT", "MODE_LOTSTEP"] as const) {
  test(`Q1.5.5 matrix (${mode}): MarketInfo(symbol, ${mode}) is correctly classified BROKER_CONSTRAINT_DEPENDENCY`, () => {
    const { model } = importSource(marketInfoFixture(mode));
    assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "MarketInfo"), `${mode} must be classified BROKER_CONSTRAINT_DEPENDENCY`);
    assert.equal(model.unsupportedConstructs.filter((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo").length, 0, `${mode} must never ALSO fall through to UNRESOLVED_CROSS_FILE_CALL`);
  });
}

// --- MODE_SPREAD remains unresolved, never fabricated into a broker constraint ---
test("Q1.5.5 matrix (MODE_SPREAD): MarketInfo(symbol, MODE_SPREAD) stays UNRESOLVED_CROSS_FILE_CALL — a live/dynamic value, never fabricated as a broker constraint (mirrors MQL5's SYMBOL_SPREAD precedent, Q0.8.39)", () => {
  const { model } = importSource(marketInfoFixture("MODE_SPREAD"));
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "MarketInfo").length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo"));
});

// --- MODE_BID remains unresolved ---
test("Q1.5.5 matrix (MODE_BID): MarketInfo(symbol, MODE_BID) stays UNRESOLVED_CROSS_FILE_CALL — no new semantic category invented", () => {
  const { model } = importSource(marketInfoFixture("MODE_BID"));
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "MarketInfo").length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo"));
});

// --- MODE_ASK remains unresolved ---
test("Q1.5.5 matrix (MODE_ASK): MarketInfo(symbol, MODE_ASK) stays UNRESOLVED_CROSS_FILE_CALL — no new semantic category invented", () => {
  const { model } = importSource(marketInfoFixture("MODE_ASK"));
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "MarketInfo").length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo"));
});

// --- unrelated MarketInfo modes continue to follow existing (unresolved) behavior ---
test("Q1.5.5 matrix (MODE_DIGITS, unrelated): an unrecognized MarketInfo mode continues to fall through to the honest generic UNRESOLVED_CROSS_FILE_CALL bucket, unaffected by the broker-constraint addition", () => {
  const { model } = importSource(marketInfoFixture("MODE_DIGITS"));
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "MarketInfo").length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "MarketInfo"));
});

// --- determinism (mirrors Q0.8.39 matrix 9) ---
test("Q1.5.5: classification of the SAME MarketInfo fixture is byte-identical across 3 independent imports", () => {
  const a = importSource(marketInfoFixture("MODE_STOPLEVEL")).model.unsupportedConstructs;
  const b = importSource(marketInfoFixture("MODE_STOPLEVEL")).model.unsupportedConstructs;
  const c = importSource(marketInfoFixture("MODE_STOPLEVEL")).model.unsupportedConstructs;
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

// --- no false positives from thin air ---
test("Q1.5.5: a strategy with zero MarketInfo calls produces zero MarketInfo-attributed findings of any category", () => {
  const { model } = importSource(`void OnTick()\n{\ndouble x = 1.0;\n}\nint OnInit() { return(0); }\n`);
  assert.equal(model.unsupportedConstructs.filter((u) => u.functionName === "MarketInfo").length, 0);
});
