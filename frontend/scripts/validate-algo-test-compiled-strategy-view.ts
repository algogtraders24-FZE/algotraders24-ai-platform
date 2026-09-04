// scripts/validate-algo-test-compiled-strategy-view.ts
// P4.3 (docs/P4.3-SURFACE-THE-FOUNDATION.md, acceptance criterion H:
// genericity). Proves toCompiledStrategyView() - the ONE projection
// function AlgoTestPanel.tsx's "Compiled Strategy" card renders for
// every strategy source - produces a real, non-fabricated,
// human-readable view for a REGISTRY StrategySpec (golden,
// ref-ema-crossover) with no AI/network/database involved at all. The
// AI-compiled side of the exact same function is already proven end to
// end by validate-ai-run-backtest-wiring.ts (through the real
// compileAndRunAiStrategy() response). Together the two scripts prove
// one function handles both sources - never a strategy-specific branch.
import assert from "node:assert/strict";
import { computeSemanticStrategyHash } from "at24-quant-engine";
import { getStrategyDefinition } from "../services/algo-test/strategy-registry";
import { toCompiledStrategyView } from "../services/algo-test/algo-test.service";

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

test("golden's real StrategySpec projects to a real, non-fabricated compiled-strategy view", () => {
  const golden = getStrategyDefinition("golden")!;
  const spec = golden.buildSpec({});
  const view = toCompiledStrategyView(spec);
  assert.equal(view.name, spec.identity.name);
  assert.equal(view.version, spec.version);
  assert.equal(view.symbol, spec.instruments[0]?.symbol);
  assert.ok(view.positionSizing.length > 0, "positionSizing must describe the real RiskSpecification.sizing, never be blank");
  assert.ok(view.longEntry !== undefined || view.shortEntry !== undefined, "golden declares real entry rules - at least one direction must be described");
  // The real StrategySpec has no distinct "filters" field (see the type's
  // own doc comment) - proving this view never fabricates one.
  assert.ok(!("filters" in view), "must never invent a filters field the real StrategySpec does not have");
});

test("ref-ema-crossover's real, MQL5-imported StrategySpec projects correctly too - the SAME function, a genuinely different strategy source (import, not engine-reference)", () => {
  const refEma = getStrategyDefinition("ref-ema-crossover")!;
  const spec = refEma.buildSpec({});
  const view = toCompiledStrategyView(spec);
  assert.equal(view.name, spec.identity.name);
  // Its real MQL5 source (ref-ema-crossover-strategy.ts) declares no exit
  // rule - the view must say so explicitly, never render an empty string.
  assert.ok(view.exit.length > 0 && view.exit !== "", "an empty exitRules array must still produce an honest, non-empty description");
  assert.ok(view.longEntry?.includes("EMA(9") && view.shortEntry?.includes("EMA(9"), "the real EMA(9)/EMA(21) entry conditions must appear verbatim, not paraphrased into something unverifiable");
});

test("two structurally different registry strategies produce different semantic hashes through the exact same computeSemanticStrategyHash() the AI path uses", () => {
  const goldenHash = computeSemanticStrategyHash(getStrategyDefinition("golden")!.buildSpec({}));
  const refEmaHash = computeSemanticStrategyHash(getStrategyDefinition("ref-ema-crossover")!.buildSpec({}));
  assert.equal(goldenHash.length, 64, "a SHA-256 hex digest is always 64 characters");
  assert.notEqual(goldenHash, refEmaHash);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
