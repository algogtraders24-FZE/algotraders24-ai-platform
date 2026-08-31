import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileAIStrategyToIR } from "../src/runtime/strategy-ir/ai-compiler.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { SIM_INSTRUMENT, SIM_TIMEFRAME } from "./fixtures/simulation-fixtures.js";
import { comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import { indicator } from "../src/domain/indicator-reference.js";
import type { AIStrategyCompilerInput } from "../src/domain/strategy-ir/ai-boundary.js";

function buildInput(): AIStrategyCompilerInput {
  return {
    intent: "buy when RSI(14) < 30",
    instruments: [SIM_INSTRUMENT],
    timeframes: [SIM_TIMEFRAME],
    indicators: [{ kind: "named", family: "RSI", params: [14] }],
    entryConditions: [{ direction: "BUY", condition: comparison("<", indicatorOperand(indicator("RSI", 14)), literal(30)) }],
    exitConditions: [{ condition: comparison(">", indicatorOperand(indicator("RSI", 14)), literal(70)) }],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 } },
    executionAssumptions: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };
}

test("Q0.7.46: compileAIStrategyToIR produces a structurally valid, execution-eligible StrategyIR", () => {
  const ir = compileAIStrategyToIR(buildInput(), { strategyId: "ai-1", strategyVersion: "1.0.0", name: "AI RSI Strategy", strategyTimezone: "UTC", createdAt: 1000 });
  const result = validateStrategyIR(ir);
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.equal(result.executionEligible, true, result.blockingReasons.join("; "));
  assert.equal(ir.sourcePlatform, "AI_GENERATED");
});

test("Q0.7.47: AIStrategyCompilerInput has NO confidence/probability/score field anywhere in its own shape", () => {
  const input = buildInput();
  const serialized = JSON.stringify(input).toLowerCase();
  assert.ok(!serialized.includes("confidence"));
  assert.ok(!serialized.includes("probability"));
});

test("Q0.7.47: the compiled StrategyIR carries no confidence/probability field anywhere in its own shape", () => {
  const ir = compileAIStrategyToIR(buildInput(), { strategyId: "ai-1", strategyVersion: "1.0.0", name: "AI RSI Strategy", strategyTimezone: "UTC", createdAt: 1000 });
  const serialized = JSON.stringify(ir).toLowerCase();
  assert.ok(!serialized.includes("confidence"));
  assert.ok(!serialized.includes("probability"));
});

test("Q0.7.47: no file in src/domain/strategy-ir or src/runtime/strategy-ir declares a confidence/probability FIELD (doc-comment prose mentioning the concept, e.g. explaining its deliberate absence, is fine — an actual `confidence:`/`confidence?:` field declaration is not)", () => {
  const fieldPattern = /\b(confidence|probability)\s*[?]?\s*:/i;
  for (const dir of ["src/domain/strategy-ir", "src/runtime/strategy-ir"]) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const contents = fs.readFileSync(`${dir}/${file}`, "utf8");
      assert.ok(!fieldPattern.test(contents), `${dir}/${file} must never declare a confidence/probability field — Q0.7.47's explicit AI boundary`);
    }
  }
});

test("compileAIStrategyToIR is pure: identical input+identity produces byte-identical IR objects (deepEqual)", () => {
  const input = buildInput();
  const identity = { strategyId: "ai-1", strategyVersion: "1.0.0", name: "AI RSI Strategy", strategyTimezone: "UTC", createdAt: 1000 };
  const a = compileAIStrategyToIR(input, identity);
  const b = compileAIStrategyToIR(input, identity);
  assert.deepEqual(a, b);
});

test("compileAIStrategyToIR requires an explicit strategyTimezone in identity — TypeScript enforces this at the call site (Q0.7.18)", () => {
  const identity = { strategyId: "ai-1", strategyVersion: "1.0.0", name: "AI RSI Strategy", strategyTimezone: "Asia/Tokyo", createdAt: 1000 };
  const ir = compileAIStrategyToIR(buildInput(), identity);
  assert.equal(ir.timezone.strategyTimezone, "Asia/Tokyo");
});
