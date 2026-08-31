import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { computeCanonicalHash } from "../src/runtime/determinism.js";
import { findFixture } from "./fixtures/q13-mql-fixtures.js";

function importFixture(id: string) {
  const fx = findFixture(id);
  return importMQLSource({ sourceText: fx.source, fileName: `${id}.mq${fx.dialect === "MQL4" ? "4" : "5"}`, forcedDialect: fx.dialect, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
}

test("Q0.13.21: importing the SAME fixture 3 times produces byte-identical ir.pendingOrderManagement and identical translationHash", () => {
  const runs = [0, 1, 2].map(() => importFixture("mql4-08-price-modification-executable"));
  const hashes = runs.map((r) => r.ir.provenance.translationHash);
  assert.equal(hashes[0], hashes[1]);
  assert.equal(hashes[1], hashes[2]);
  const rules = runs.map((r) => JSON.stringify(r.ir.pendingOrderManagement));
  assert.equal(rules[0], rules[1]);
  assert.equal(rules[1], rules[2]);
});

test("Q0.13.21: changing ONLY the pending-order-management source (same entry logic) changes the IR's translationHash deterministically", () => {
  const withCancel = importFixture("mql4-05-delete-pending-by-type").ir;
  const withoutCancel = importMQLSource({
    sourceText: `int OP_BUYSTOP = 4;\nvoid start()\n{\nint ticket = 1;\n}\nint init() { return(0); }\n`,
    fileName: "no-mgmt.mq4",
    forcedDialect: "MQL4",
    options: { strategyId: "no-mgmt", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 },
  }).ir;
  assert.notEqual(withCancel.provenance.translationHash, withoutCancel.provenance.translationHash);
});

test("Q0.13.21: two rules that differ ONLY in their compiled operation's distance produce different canonical hashes (the modification policy is part of the strategy's identity)", () => {
  const a = computeCanonicalHash({ rules: [{ id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 1 } }, semanticFidelity: "EXACT" }] });
  const b = computeCanonicalHash({ rules: [{ id: "r", target: { kind: "SYMBOL", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 2 } }, semanticFidelity: "EXACT" }] });
  assert.notEqual(a, b);
});

test("Q0.13.28/31: provenance retains source line, original operation, target, and semantic fidelity for every compiled rule", () => {
  const { ir } = importFixture("mql4-08-price-modification-executable");
  const rule = ir.pendingOrderManagement!.rules[0]!;
  assert.ok(rule.sourceLine !== undefined);
  assert.ok(rule.sourceExpr !== undefined);
  assert.equal(rule.semanticFidelity, "EXACT");
  assert.ok(rule.target.provable);
  assert.ok(rule.condition.provable);
});
