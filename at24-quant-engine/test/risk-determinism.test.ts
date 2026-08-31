import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRisk } from "../src/runtime/risk/pipeline.js";
import { RISK_BREAKEVEN, RISK_CONFLICT, RISK_BASIC_BUY } from "./fixtures/risk-fixtures.js";
import type { RiskEvaluationInput } from "../src/domain/risk-evaluation.js";

test("Q0.3.18: repeated evaluation of the same input produces identical results", () => {
  const results = Array.from({ length: 5 }, () => evaluateRisk(RISK_BREAKEVEN.input));
  const serialized = results.map((r) => JSON.stringify(r));
  assert.ok(serialized.every((s) => s === serialized[0]));
});

test("Q0.3.18: reordering irrelevant object-key metadata does not change the result", () => {
  const input = RISK_BASIC_BUY.input;
  const reordered: RiskEvaluationInput = {
    dailyLoss: input.dailyLoss,
    portfolio: input.portfolio,
    proposedEntry: input.proposedEntry!,
    direction: input.direction,
    instrument: input.instrument,
    riskSpecification: input.riskSpecification,
    asOf: input.asOf,
  };
  assert.deepEqual(evaluateRisk(input), evaluateRisk(reordered));
});

test("Q0.3.18: serialization/deserialization round-trip through JSON produces an identical result", () => {
  const roundTripped: RiskEvaluationInput = JSON.parse(JSON.stringify(RISK_CONFLICT.input));
  assert.deepEqual(evaluateRisk(RISK_CONFLICT.input), evaluateRisk(roundTripped));
});

test("Q0.3.18: identical timestamps and identical configuration across two freshly-constructed inputs produce identical results", () => {
  const build = (): RiskEvaluationInput => ({
    asOf: 1_000_000,
    riskSpecification: { sizing: { method: "fixed-lot", lots: 1 }, maxSimultaneousPositions: 2 },
    instrument: { symbol: "X" },
    direction: "BUY",
    proposedEntry: { quantity: 1, entryPrice: 100, stopLoss: 98 },
    portfolio: { openPositionCount: 1 },
    dailyLoss: { realizedPnlToday: 0, equityAtDayStart: 1000 },
  });
  assert.deepEqual(evaluateRisk(build()), evaluateRisk(build()));
});

test("Q0.3.18: no wall-clock, no random-number, no environment-dependent source anywhere in the risk runtime (static scan)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const riskDir = join(here, "..", "src", "runtime", "risk");
  const files = readdirSync(riskDir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length > 0);

  const forbidden = [/Date\.now\(\)/, /Math\.random\(\)/, /process\.env/, /new Date\(\)(?!\.)/];
  for (const file of files) {
    const content = readFileSync(join(riskDir, file), "utf-8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${file} must not use ${pattern} (wall-clock/random/env access is forbidden in the risk runtime)`);
    }
  }
});
