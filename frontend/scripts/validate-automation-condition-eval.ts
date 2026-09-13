// scripts/validate-automation-condition-eval.ts
// AT24 Automation (MVP) - deterministic condition evaluation.
// House style, pure/in-memory. `npm run validate:automation-condition-eval`.
// Covers AUTOMATION_TEST_PLAN.md §1 "validate-automation-condition-eval".

import assert from "node:assert/strict";
import { evaluateCondition } from "../services/automation/condition-eval";
import { emptyRunContext, type AutomationRunContext } from "../services/automation/context-path";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

function ctxWith(steps: AutomationRunContext["steps"]): AutomationRunContext {
  const c = emptyRunContext({ type: "daily" });
  c.steps = steps;
  return c;
}

async function main(): Promise<void> {
  console.log("validate-automation-condition-eval\n");

  test("78 gte 75 -> true", () => {
    const r = evaluateCondition({ left: "$.steps.s1.confidence", op: "gte", right: 75 }, ctxWith({ s1: { confidence: 78 } }));
    assert.equal(r.result, true);
    assert.deepEqual({ left: r.left, op: r.op, right: r.right }, { left: 78, op: "gte", right: 75 });
  });

  test("71 gte 75 -> false (step still evaluable)", () => {
    const r = evaluateCondition({ left: "$.steps.s1.confidence", op: "gte", right: 75 }, ctxWith({ s1: { confidence: 71 } }));
    assert.equal(r.result, false);
    assert.equal(r.note, undefined);
  });

  test('"LOW" eq "LOW" -> true', () => {
    const r = evaluateCondition({ left: "$.steps.s1.risk", op: "eq", right: "LOW" }, ctxWith({ s1: { risk: "LOW" } }));
    assert.equal(r.result, true);
  });

  test('"LOW" eq "MEDIUM" -> false', () => {
    const r = evaluateCondition({ left: "$.steps.s1.risk", op: "eq", right: "MEDIUM" }, ctxWith({ s1: { risk: "LOW" } }));
    assert.equal(r.result, false);
  });

  test('status neq "SUCCESS" -> true when different', () => {
    const r = evaluateCondition({ left: "$.steps.s1.status", op: "neq", right: "SUCCESS" }, ctxWith({ s1: { status: "PARTIAL" } }));
    assert.equal(r.result, true);
  });

  test("missing left path -> result:false with a note (not an error)", () => {
    const r = evaluateCondition({ left: "$.steps.s1.missing", op: "gte", right: 10 }, ctxWith({ s1: { confidence: 78 } }));
    assert.equal(r.result, false);
    assert.ok(r.note && r.note.includes("undefined"));
  });

  test("NaN operand -> fail closed", () => {
    const r = evaluateCondition({ left: "$.steps.s1.label", op: "gte", right: 10 }, ctxWith({ s1: { label: "abc" } }));
    assert.equal(r.result, false);
    assert.ok(r.note);
  });

  test("type mismatch on eq (number vs string) -> false", () => {
    const r = evaluateCondition({ left: "$.steps.s1.n", op: "eq", right: "5" }, ctxWith({ s1: { n: 5 } }));
    assert.equal(r.result, false);
  });

  test("boolean is never numerically compared", () => {
    const r = evaluateCondition({ left: "$.steps.s1.flag", op: "gt", right: 0 }, ctxWith({ s1: { flag: true } }));
    assert.equal(r.result, false);
    assert.ok(r.note);
  });

  test("neq on a missing path -> true (undefined != right)", () => {
    const r = evaluateCondition({ left: "$.steps.s1.missing", op: "neq", right: "X" }, ctxWith({ s1: {} }));
    assert.equal(r.result, true);
  });

  test("trigger path resolves", () => {
    const r = evaluateCondition({ left: "$.trigger.type", op: "eq", right: "daily" }, ctxWith({}));
    assert.equal(r.result, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
