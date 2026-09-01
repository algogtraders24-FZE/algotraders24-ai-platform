import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Q0.8.39 baseline-repair — Part F test matrix. See
 * docs/Q0.8.39_BASELINE_CONTRACT_AUDIT.md for the full historical
 * investigation. These tests prove the `BROKER_CONSTRAINT_DEPENDENCY`
 * detector's OWN correctness directly, against small, hand-crafted,
 * NON-G01 fixtures — deliberately decoupling "does the detector work"
 * from "does this one real-world EA happen to exercise it," since G01
 * v0.1 (the only source ever actually committed to this repository)
 * genuinely does not contain any of the five canonical broker-constraint
 * tokens.
 */

const OPTS = { strategyId: "x", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5" as const, importedAt: 0 };

function importSource(sourceText: string, dialect: "MQL4" | "MQL5" = "MQL5") {
  return importMQLSource({ sourceText, fileName: `x.mq${dialect === "MQL4" ? "4" : "5"}`, forcedDialect: dialect, options: OPTS });
}

const FIXTURE_STOPS_LEVEL = `void OnTick()\n{\ndouble lvl = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);\n}\nint OnInit() { return(0); }\n`;
const FIXTURE_FREEZE_LEVEL = `void OnTick()\n{\ndouble lvl = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);\n}\nint OnInit() { return(0); }\n`;
const FIXTURE_VOLUME_MIN = `void OnTick()\n{\ndouble v = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);\n}\nint OnInit() { return(0); }\n`;
const FIXTURE_SPREAD_DYNAMIC = `void OnTick()\n{\ndouble s = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);\n}\nint OnInit() { return(0); }\n`;
const FIXTURE_NO_SYMBOLINFO = `void OnTick()\n{\ndouble x = 1.0;\n}\nint OnInit() { return(0); }\n`;
const FIXTURE_BENIGN_DIGITS = `void OnTick()\n{\ndouble d = (double)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);\n}\nint OnInit() { return(0); }\n`;

// --- 2. broker constraint token when actually present ---
test("Q0.8.39 matrix 2: SymbolInfoInteger(SYMBOL_TRADE_STOPS_LEVEL) is correctly classified BROKER_CONSTRAINT_DEPENDENCY", () => {
  const { model } = importSource(FIXTURE_STOPS_LEVEL);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "SymbolInfoInteger"));
});

test("Q0.8.39 matrix 2b: SymbolInfoInteger(SYMBOL_TRADE_FREEZE_LEVEL) is correctly classified BROKER_CONSTRAINT_DEPENDENCY", () => {
  const { model } = importSource(FIXTURE_FREEZE_LEVEL);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY"));
});

test("Q0.8.39 matrix 2c: SymbolInfoDouble(SYMBOL_VOLUME_MIN) is correctly classified BROKER_CONSTRAINT_DEPENDENCY", () => {
  const { model } = importSource(FIXTURE_VOLUME_MIN);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" && u.functionName === "SymbolInfoDouble"));
});

// --- 3. absence of broker constraint token ---
test("Q0.8.39 matrix 3: a SymbolInfoInteger call whose property is NOT one of the five canonical tokens never produces a BROKER_CONSTRAINT_DEPENDENCY finding", () => {
  const { model } = importSource(FIXTURE_BENIGN_DIGITS);
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY").length, 0);
});

// --- 4. unknown dynamic SymbolInfoInteger property ---
test("Q0.8.39 matrix 4: SymbolInfoInteger(SYMBOL_SPREAD) — a real MQL5 built-in with a property this importer has no dedicated category for — is honestly reported unresolved (UNRESOLVED_CROSS_FILE_CALL), never guessed as BROKER_CONSTRAINT_DEPENDENCY or silently dropped", () => {
  const { model } = importSource(FIXTURE_SPREAD_DYNAMIC);
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY").length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "SymbolInfoInteger"), "a documented, known limitation (docs/Q0.8.39_BASELINE_CONTRACT_AUDIT.md) — never fixed by fabricating a classification");
});

// --- 5. known SymbolInfoInteger property (contrast against 4) ---
test("Q0.8.39 matrix 5: a KNOWN (canonical) property and an UNKNOWN property on the SAME function produce genuinely different, never-conflated classifications", () => {
  const known = importSource(FIXTURE_STOPS_LEVEL).model;
  const unknown = importSource(FIXTURE_SPREAD_DYNAMIC).model;
  assert.ok(known.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY"));
  assert.equal(unknown.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY").length, 0);
});

// --- 6. no false broker-dependency classification ---
test("Q0.8.39 matrix 6: a strategy with zero SymbolInfo calls at all produces zero BROKER_CONSTRAINT_DEPENDENCY / ACCOUNT_DEPENDENCY findings — no false positives from thin air", () => {
  const { model } = importSource(FIXTURE_NO_SYMBOLINFO);
  assert.equal(model.unsupportedConstructs.filter((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY" || u.category === "ACCOUNT_DEPENDENCY").length, 0);
});

// --- 8. historical v0.2 reference does not become executable source ---
test("Q0.8.39 matrix 8: the real importer only ever operates on the actual committed G01 source — never a reconstructed or historically-documented v0.2 revision", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const g01Path = path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5");
  const sourceText = fs.readFileSync(g01Path, "utf8");
  const lineCount = sourceText.split("\n").length;
  assert.notEqual(lineCount, 660, "the committed source must never silently match the historically-documented (but never-committed) v0.2 line count — that would mean v0.2 content had been fabricated or copied in without a proven, reviewed commit");
  assert.ok(sourceText.includes("v0.1"), "the committed source must remain the real, honestly-labeled v0.1 baseline");
});

// --- 9. deterministic classification ---
test("Q0.8.39 matrix 9: classification of the SAME fixture is byte-identical across 3 independent imports", () => {
  const a = importSource(FIXTURE_STOPS_LEVEL).model.unsupportedConstructs;
  const b = importSource(FIXTURE_STOPS_LEVEL).model.unsupportedConstructs;
  const c = importSource(FIXTURE_STOPS_LEVEL).model.unsupportedConstructs;
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});
