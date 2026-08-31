import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";
import { canonicalizeStrategyIR } from "../src/runtime/strategy-ir/canonicalize.js";
import { compileAIStrategyToIR } from "../src/runtime/strategy-ir/ai-compiler.js";
import { ALL_GOLDEN_IR_FIXTURES, fixtureEMACrossover } from "./fixtures/strategy-ir-fixtures.js";
import { SIM_INSTRUMENT, SIM_TIMEFRAME } from "./fixtures/simulation-fixtures.js";
import { comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import { indicator } from "../src/domain/indicator-reference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGY_IR_RUNTIME_DIR = path.resolve(__dirname, "../src/runtime/strategy-ir");

const FORBIDDEN_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /Date\.now\s*\(/, label: "Date.now()" },
  { pattern: /Math\.random\s*\(/, label: "Math.random()" },
  { pattern: /process\.env/, label: "process.env" },
  { pattern: /new Date\s*\(/, label: "new Date()" },
  { pattern: /crypto\.randomUUID/, label: "crypto.randomUUID" },
];

test("Q0.7.53: no wall-clock, randomness, or environment access anywhere in src/runtime/strategy-ir", () => {
  const files = fs.readdirSync(STRATEGY_IR_RUNTIME_DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const contents = fs.readFileSync(path.join(STRATEGY_IR_RUNTIME_DIR, file), "utf8");
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      assert.ok(!pattern.test(contents), `${file} must never use ${label}`);
    }
  }
});

test("Q0.7.53: 3 independent validations of the same IR produce the identical result", () => {
  const ir = fixtureEMACrossover();
  const r1 = validateStrategyIR(ir);
  const r2 = validateStrategyIR(ir);
  const r3 = validateStrategyIR(ir);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
});

test("Q0.7.53: 3 independent AI compilations of the same input+identity produce the identical IR hash", () => {
  const input = {
    intent: "buy when SMA(20) crosses above SMA(50)",
    instruments: [SIM_INSTRUMENT],
    timeframes: [SIM_TIMEFRAME],
    indicators: [{ kind: "named" as const, family: "SMA" as const, params: [20] }, { kind: "named" as const, family: "SMA" as const, params: [50] }],
    entryConditions: [{ direction: "BUY" as const, condition: comparison("cross_above", indicatorOperand(indicator("SMA", 20)), indicatorOperand(indicator("SMA", 50))) }],
    exitConditions: [{ condition: comparison("cross_below", indicatorOperand(indicator("SMA", 20)), indicatorOperand(indicator("SMA", 50))) }],
    risk: { sizing: { method: "fixed-quantity" as const, quantity: 1 } },
    executionAssumptions: { fillModel: "next-bar-open" as const, costsExplicitlyZero: true as const },
  };
  const identity = { strategyId: "ai-strat-1", strategyVersion: "1.0.0", name: "AI SMA Cross", strategyTimezone: "UTC", createdAt: 1000 };

  const h1 = computeCanonicalIRHash(compileAIStrategyToIR(input, identity));
  const h2 = computeCanonicalIRHash(compileAIStrategyToIR(input, identity));
  const h3 = computeCanonicalIRHash(compileAIStrategyToIR(input, identity));
  assert.equal(h1, h2);
  assert.equal(h2, h3);
});

test("Q0.7.54: canonicalizeStrategyIR never mutates its input", () => {
  const ir = fixtureEMACrossover();
  const frozen = Object.freeze(structuredClone(ir));
  assert.doesNotThrow(() => canonicalizeStrategyIR(frozen));
});

test("Q0.7.54: a frozen StrategyIR passed to validateStrategyIR is never mutated (throws on any attempted write)", () => {
  const ir = fixtureEMACrossover();
  const frozen = Object.freeze(structuredClone(ir));
  assert.doesNotThrow(() => validateStrategyIR(frozen));
});

test("all 23 golden fixtures produce a stable hash across 3 repeated computations", () => {
  for (const build of ALL_GOLDEN_IR_FIXTURES) {
    const ir = build();
    const h1 = computeCanonicalIRHash(ir);
    const h2 = computeCanonicalIRHash(ir);
    assert.equal(h1, h2, `${ir.strategyId}: hash must be stable across repeated computation`);
  }
});
