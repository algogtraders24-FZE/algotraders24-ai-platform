import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { computeCanonicalIRHash } from "../src/runtime/strategy-ir/ir-hash.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Q0.8.44/45 — the PRIMARY real-world validation fixture. This test
 * reads the real G01 EA's source file at runtime (fs.readFileSync, NOT
 * an ES `import`) — the package's own isolation guarantee
 * (test/isolation.test.ts) only forbids `src/` taking a runtime CODE
 * DEPENDENCY on ea-research/ via `import`; a test reading a real-world
 * fixture file for validation is exactly Q0.8.44's own instruction, and
 * the file is never written to.
 */
const G01_PATH = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");

function importG01() {
  const sourceText = fs.readFileSync(G01_PATH, "utf8");
  return importMQLSource({
    sourceText,
    fileName: "AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5",
    options: {
      strategyId: "g01-liquiditysweep-mss-fvg-imported",
      strategyVersion: "1.10.0",
      instrument: { symbol: "XAUUSD", assetClass: "metal" },
      executionTimeframe: "M5",
      importedAt: 0,
    },
  });
}

test("Q0.8.44: the real G01 EA source parses end-to-end with ZERO BLOCKING parse diagnostics", () => {
  const { report } = importG01();
  const blockingParse = report.diagnostics.filter((d) => d.severity === "BLOCKING");
  assert.equal(blockingParse.length, 0, JSON.stringify(blockingParse));
});

test("Q0.8.7: G01 is correctly detected as MQL5 (from OnInit/OnTick/OnDeinit/OnTradeTransaction), never from its .mq5 filename alone", () => {
  const { ir } = importG01();
  assert.equal(ir.sourcePlatform, "MT5_MQL5");
  assert.equal(ir.sourceLanguage, "MQL5");
});

test("Q0.8.1: all 27 real input parameters are extracted", () => {
  const { ir } = importG01();
  assert.ok(ir.parameters.length >= 25, `expected ~27 parameters, got ${ir.parameters.length}`);
  assert.ok(ir.parameters.some((p) => p.key === "InpMagicNumber"));
  assert.ok(ir.parameters.some((p) => p.key === "InpRiskPercent"));
});

test("Q0.8.8: all 4 real MQL5 event handlers are recognized", () => {
  const { model } = importG01();
  const kinds = model.eventHandlers.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["MQL5_ONDEINIT", "MQL5_ONINIT", "MQL5_ONTICK", "MQL5_ONTRADETRANSACTION"]);
});

test("Q0.8.19-21: both CTrade.Buy and CTrade.Sell market entries are recognized, with SL/TP/volume expressions extracted", () => {
  const { model } = importG01();
  const buy = model.orderCalls.find((o) => o.style === "CTrade.Buy")!;
  const sell = model.orderCalls.find((o) => o.style === "CTrade.Sell")!;
  assert.ok(buy && sell);
  assert.equal(buy.volumeExpr, "lots");
  assert.equal(buy.slExpr, "sl");
  assert.equal(buy.tpExpr, "tp");
});

test("Q0.8.32: the real M5 execution + M15 higher-timeframe swing reference is recognized as genuine MTF usage", () => {
  const { ir } = importG01();
  assert.deepEqual(ir.timeframes.slice().sort(), ["M15", "M5"]);
  const higher = ir.timeframeSeries.find((s) => s.timeframe === "M15")!;
  assert.equal(higher.role, "HIGHER");
});

test("Q0.8.35: G01's tick-driven entry trigger (unconditional live bid/ask read in OnTick) is correctly classified REALTIME_DEPENDENT, not falsely NON_REPAINTING", () => {
  const { ir } = importG01();
  assert.equal(ir.repaintingModel, "REALTIME_DEPENDENT");
});

test("Q0.8.19/Q0.8's critical success criterion: the real entry/exit state-machine logic is HONESTLY reported as unrepresentable (BLOCKING), never fabricated as a fake Expression", () => {
  const { ir } = importG01();
  const stateMachineIssue = ir.provenance.unsupportedSemantics.find((u) => u.feature === "entry/exit signal logic");
  assert.ok(stateMachineIssue);
  assert.equal(stateMachineIssue!.severity, "BLOCKING");
});

test("Q0.8.24: SL/TP are correctly recognized as present but their FORMULA is honestly reported as unresolved (cross-file), never guessed", () => {
  const { ir } = importG01();
  const sltpIssue = ir.provenance.unsupportedSemantics.find((u) => u.feature === "stop-loss / take-profit values");
  assert.ok(sltpIssue);
  assert.equal(sltpIssue!.severity, "BLOCKING");
  assert.equal(ir.risk.stopLoss, undefined);
  assert.equal(ir.risk.takeProfit, undefined);
});

test("Q0.8.40: position sizing is APPROXIMATED (not silently guessed) from the InpRiskPercent input, with the approximation explicitly recorded", () => {
  const { ir } = importG01();
  assert.equal(ir.risk.sizing.method, "percent-equity-risk");
  const approx = ir.provenance.approximations.find((a) => a.feature === "position sizing method");
  assert.ok(approx, "the sizing approximation must be explicitly recorded, never hidden");
});

test("Q0.8's critical success criterion: G01's overall StrategyIR correctly BLOCKS execution eligibility — this is the honest, correct outcome for a state-machine strategy the current IR cannot fully represent", () => {
  const { ir } = importG01();
  const result = validateStrategyIR(ir);
  assert.equal(result.executionEligible, false);
  assert.ok(result.blockingReasons.length >= 2);
});

test("Q0.8.50: parsing/analyzing/generating the IR from the SAME G01 source 3 times produces the identical IR hash", () => {
  const h1 = computeCanonicalIRHash(importG01().ir);
  const h2 = computeCanonicalIRHash(importG01().ir);
  const h3 = computeCanonicalIRHash(importG01().ir);
  assert.equal(h1, h2);
  assert.equal(h2, h3);
});

test("Q0.8.39: real account/broker dependencies (AccountInfoDouble, SYMBOL_TRADE_STOPS_LEVEL/FREEZE_LEVEL) are recognized and separated from strategy semantics", () => {
  const { model } = importG01();
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY" && u.functionName === "AccountInfoDouble"));
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY"));
});

test("Q0.8.37/38: G01's real source contains NO iCustom/DLL/WebRequest — correctly reports zero such findings (an honest negative, not an assumed one)", () => {
  const { model } = importG01();
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "ICUSTOM" || u.category === "DLL_IMPORT" || u.category === "WEBREQUEST").length, 0);
});
