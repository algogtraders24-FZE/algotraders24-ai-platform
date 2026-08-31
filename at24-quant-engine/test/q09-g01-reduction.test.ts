import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { checkReductionEligibility } from "../src/runtime/reduction/eligibility-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Q0.9's own explicit instruction: G01 must remain BLOCKED, and that
 * blocking IS the pass condition — never something to work around by
 * altering G01. Reuses Q0.8's own established read-only fs.readFileSync
 * pattern (test/mql-g01-import.test.ts) — the real G01 source is never
 * written to, and never imported as a code dependency.
 */
const G01_PATH = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");

function compileG01() {
  const sourceText = fs.readFileSync(G01_PATH, "utf8");
  const { ir } = importMQLSource({
    sourceText,
    fileName: "AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5",
    options: {
      strategyId: "g01-liquiditysweep-mss-fvg-q09",
      strategyVersion: "1.10.0",
      instrument: { symbol: "XAUUSD", assetClass: "metal" },
      executionTimeframe: "M5",
      importedAt: 0,
    },
  });
  return compileStrategy(ir);
}

test("Q0.9 critical rule: G01's real EA remains BLOCKED at the reduction/compilation layer — this IS the pass condition, not a defect", () => {
  const compilation = compileG01();
  assert.equal(compilation.reductionReport.status, "BLOCKED");
  assert.equal(compilation.strategySpec, undefined);
});

test("Q0.9: G01's block is for the SAME independently-sufficient reasons Q0.8 already found — the unresolvable state-machine entry condition — never a new, unrelated reason introduced by the Q0.9 layer", () => {
  const compilation = compileG01();
  assert.ok(compilation.reductionReport.diagnostics.some((d) => d.toLowerCase().includes("entry/exit signal logic") || d.toLowerCase().includes("unsupported semantic")));
});

test("Q0.9: G01's SL/TP cross-file formula is still honestly unresolved — the reducer never guesses a fixed-distance or ATR-multiple rule for it", () => {
  const { ir } = importMQLSource({
    sourceText: fs.readFileSync(G01_PATH, "utf8"),
    fileName: "g01.mq5",
    options: { strategyId: "g01-sltp-check", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  assert.equal(ir.risk.stopLoss, undefined);
  assert.equal(ir.risk.takeProfit, undefined);
});

test("Q0.9: G01's own 17 detected position-management/query calls keep it on the conservative (non-assumed) pyramiding/reversal path — the Q0.9 'no custom position code' relaxation never applies to it", () => {
  const { ir, model } = importMQLSource({
    sourceText: fs.readFileSync(G01_PATH, "utf8"),
    fileName: "g01.mq5",
    options: { strategyId: "g01-posmgmt-check", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  assert.ok(model.positionQueries.length > 0, "G01 must have real detected position-management calls for this test to be meaningful");
  assert.equal(ir.positionManagement.pyramiding.sameDirectionBehavior, "REJECT");
});

test("Q0.9: compiling G01 three times produces the identical BLOCKED status and identical diagnostics — determinism holds even for a blocked strategy", () => {
  const c1 = compileG01();
  const c2 = compileG01();
  assert.equal(c1.reductionReport.status, c2.reductionReport.status);
  assert.deepEqual(c1.reductionReport.diagnostics, c2.reductionReport.diagnostics);
});

test("Q0.9: checkReductionEligibility on G01 reports at least 2 independently-sufficient blocking reasons (never a single fragile check)", () => {
  const { ir } = importMQLSource({
    sourceText: fs.readFileSync(G01_PATH, "utf8"),
    fileName: "g01.mq5",
    options: { strategyId: "g01-eligibility-check", strategyVersion: "1.0.0", instrument: { symbol: "XAUUSD", assetClass: "metal" }, executionTimeframe: "M5", importedAt: 0 },
  });
  const result = checkReductionEligibility(ir);
  assert.equal(result.eligible, false);
  assert.ok(result.blockingReasons.length >= 2, JSON.stringify(result.blockingReasons));
});
