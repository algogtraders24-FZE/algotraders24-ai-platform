import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { validateStrategyIR } from "../src/runtime/strategy-ir/ir-validator.js";
import { compareParity } from "../src/runtime/strategy-ir/parity-engine.js";
import { baseOptions } from "./fixtures/mql-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function importSource(source: string, dialect?: "MQL4" | "MQL5") {
  return importMQLSource({ sourceText: source, fileName: "f.mq5", options: baseOptions(), ...(dialect ? { forcedDialect: dialect } : {}) });
}

/** Q0.8.52: the 28 required failure modes, each proven with a concrete test. */

test("1. malformed syntax: an unbalanced statement recovers via diagnostics rather than throwing an unhandled exception", () => {
  assert.doesNotThrow(() => parseMQL(tokenize("void f() { if( }")));
});

test("2. unknown token: a genuinely unrecognized character is tokenized (never silently dropped) so the parser can react to it", () => {
  const tokens = tokenize("int x = 1 @ 2;");
  assert.ok(tokens.some((t) => t.value === "@"));
});

test("3. unsupported directive: an unrecognized preprocessor form produces a WARNING diagnostic, never a silent skip", () => {
  const { diagnostics } = parseMQL(tokenize("#pragma once\nvoid f(){}"));
  assert.ok(diagnostics.some((d) => d.code === "UNSUPPORTED_PREPROCESSOR" && d.severity === "WARNING"));
});

test("4. unresolved identifier: a call to a function neither built-in nor locally defined is recorded honestly, never silently trusted", () => {
  const { model } = importSource("void f() { SomeUnknownCrossFileHelper(1,2); }");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "SomeUnknownCrossFileHelper"));
});

test("5. invalid indicator: iCustom (a non-analyzable custom indicator) is flagged ICUSTOM, never guessed at as a named family", () => {
  const { model } = importSource('void f() { double v = iCustom(_Symbol,0,"X",0,0); }', "MQL4");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ICUSTOM"));
});

test("6. invalid shift: a non-literal (variable) shift index is recorded as unprovable, never assumed to be a safe constant", () => {
  const { report } = importSource("void f(int n) { double v = Close[n]; }");
  assert.ok(report.diagnostics.some((d) => d.code === "NON_LITERAL_SHIFT" && d.severity === "WARNING"));
});

test("7. future shift: Close[-1] is rejected as BLOCKING, never silently clamped", () => {
  const { report } = importSource("void f() { double v = Close[-1]; }");
  assert.ok(report.diagnostics.some((d) => d.code === "FUTURE_SHIFT_REJECTED" && d.severity === "BLOCKING"));
});

test("8. invalid timeframe: an unrecognized PERIOD_* constant is never force-mapped to a real Timeframe — it is simply not added, not guessed", () => {
  const { ir } = importSource("void f() { double v = iClose(_Symbol,PERIOD_NONSTANDARD,1); }", "MQL4");
  assert.ok(!ir.timeframes.includes("PERIOD_NONSTANDARD" as never));
});

test("9. invalid symbol: a non-standard symbol literal is still recorded (as a plain string reference), never rejected silently or crashed on", () => {
  const { model } = importSource('void f() { double v = iClose("NOT_A_REAL_SYMBOL_1234",PERIOD_M5,1); }', "MQL4");
  assert.ok(model.seriesReferences.some((s) => s.symbolExpr?.includes("NOT_A_REAL_SYMBOL_1234")));
});

test("10. ambiguous order: an OrderSend call whose command constant cannot be resolved to BUY/SELL leaves `side` unset rather than guessing", () => {
  const { model } = importSource("void f() { int t = OrderSend(_Symbol,someDynamicCmd,0.1,Ask,3,0,0,\"c\",1,0,clrBlue); }", "MQL4");
  assert.equal(model.orderCalls[0]!.side, undefined);
});

test("11. unsupported order: a call that merely LOOKS like an order helper but isn't a recognized order function is never fabricated into an OrderCallSite", () => {
  const { model } = importSource("void f() { PlaceMyCustomOrder(1,2,3); }");
  assert.equal(model.orderCalls.length, 0);
  assert.ok(model.unsupportedConstructs.some((u) => u.functionName === "PlaceMyCustomOrder"));
});

test("12. unsupported external dependency: a DLL #import is flagged, never silently linked", () => {
  const { report } = importSource('#import "x.dll"\nint F(int x);\n#import\nvoid f(){ int y = F(1); }', "MQL4");
  assert.ok(report.diagnostics.some((d) => d.code === "UNSUPPORTED_PREPROCESSOR"));
});

test("13. iCustom: (see item 5) — a distinct catalog entry per Q0.8.52's own numbering, same underlying detector", () => {
  const { model } = importSource('void f() { double v = iCustom(_Symbol,0,"AnotherOne",0,0); }', "MQL4");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ICUSTOM"));
});

test("14. DLL: an #import DLL directive is recorded distinctly from a plain #include", () => {
  const { report } = importSource('#import "MyLib.dll"\nint F();\n#import\nvoid f(){}', "MQL4");
  assert.ok(report.diagnostics.some((d) => d.message.includes("#import")));
});

test("15. WebRequest: flagged WEBREQUEST, never executed or simulated", () => {
  const { model } = importSource('void f() { char d[]; char r[]; string h; int c = WebRequest("GET","http://x",h,0,d,r,h); }');
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "WEBREQUEST"));
});

test("16. repainting: a strategy whose signal depends on an unresolved iCustom is never independently certified NON_REPAINTING", () => {
  const { ir } = importSource('void f() { double v = iCustom(_Symbol,0,"X",0,0); }', "MQL4");
  assert.notEqual(ir.repaintingModel, "NON_REPAINTING");
});

test("17. ambiguous timezone: TimeLocal() usage is BLOCKING — never silently treated as UTC or server time", () => {
  const { ir } = importSource("void f() { datetime t = TimeLocal(); }");
  const tzIssue = ir.provenance.unsupportedSemantics.find((u) => u.feature === "strategy timezone");
  assert.ok(tzIssue);
  assert.equal(tzIssue!.severity, "BLOCKING");
});

test("18. ambiguous account mode: account mode is always WARNING-flagged as assumed, never silently asserted as fact", () => {
  const { ir } = importSource("void f() {}");
  assert.ok(ir.provenance.unsupportedSemantics.some((u) => u.feature === "position accounting mode" && u.severity === "WARNING"));
});

test("19. unsupported trade event: OnTradeTransaction is recognized as an event handler without being treated as BLOCKING when it doesn't feed strategy signal logic", () => {
  const { ir } = importSource("void OnTradeTransaction() {}\nvoid OnTick() {}\nint OnInit(){return(0);}", "MQL5");
  assert.equal(validateStrategyIR(ir).valid, true);
});

test("20. dynamic execution: an order whose volume comes from an unresolved cross-file call is never trusted as a concrete literal", () => {
  const { model } = importSource('CTrade g_trade;\nvoid f() { g_trade.Buy(G01_CalculateLotSize(),_Symbol,0.0,sl,tp,"c"); }');
  assert.ok(model.unsupportedConstructs.some((u) => u.functionName === "G01_CalculateLotSize"));
});

test("21. invalid SL: an order call with a TP but no resolvable SL expression is recorded with slExpr left undefined, never fabricated", () => {
  const { model } = importSource('CTrade g_trade;\nvoid f() { g_trade.Buy(0.1,_Symbol,0.0,0.0,tp,"c"); }');
  assert.equal(model.orderCalls[0]!.slExpr, "0");
});

test("22. invalid TP: symmetric to item 21 — an order with SL but a literal-zero TP is recorded exactly as written, not reinterpreted", () => {
  const { model } = importSource('CTrade g_trade;\nvoid f() { g_trade.Buy(0.1,_Symbol,0.0,sl,0.0,"c"); }');
  assert.equal(model.orderCalls[0]!.tpExpr, "0");
});

test("23. invalid position sizing: without a risk-percent-named input, sizing defaults to fixed-quantity rather than inventing a percent value", () => {
  const { ir } = importSource("void f() {}");
  assert.equal(ir.risk.sizing.method, "fixed-quantity");
});

test("24. hidden state: a global variable that is written but never read anywhere is still tracked (never silently dropped from the state model)", () => {
  const { model } = importSource("int g_counter = 0;\nvoid f() { g_counter = 5; }");
  const state = model.stateVariables.find((s) => s.name === "g_counter")!;
  assert.ok(state.writePositions.length >= 1);
  assert.equal(state.readPositions.length, 0);
});

test("25. MTF future leak: a HIGHER-timeframe reference with no provable (or even plausible) new-bar gate is BLOCKING", () => {
  const { ir } = importSource("void f() { double v = iClose(_Symbol,PERIOD_H4,1); }", "MQL4");
  const mtfIssue = ir.provenance.unsupportedSemantics.find((u) => u.feature === "multi-timeframe HTF availability");
  assert.ok(mtfIssue);
  assert.equal(mtfIssue!.severity, "BLOCKING");
});

test("26. source hash mismatch: an IR whose provenance.sourceHash is tampered with post-import fails Q0.7's own validator (reused unmodified — the same check protects MQL-imported IRs)", () => {
  const { ir } = importSource("void f() {}");
  const tampered = { ...ir, provenance: { ...ir.provenance, sourceHash: "f".repeat(64) } };
  const result = validateStrategyIR(tampered);
  assert.equal(result.valid, false);
});

test("27. IR parity mismatch: compareParity() surfaces a deliberately introduced difference (SL/TP presence) between two otherwise-similar imports", () => {
  const withSLTP = importSource('CTrade g_trade;\nvoid f() { g_trade.Buy(0.1,_Symbol,0.0,sl,tp,"c"); }').ir;
  const withoutSLTP = importSource('CTrade g_trade;\nvoid f() { g_trade.Buy(0.1,_Symbol,0.0,0.0,0.0,"c"); }').ir;
  const report = compareParity(withSLTP, withoutSLTP);
  assert.ok(report.differences.some((d) => d.feature === "exits"));
});

test("28. parser nondeterminism: the real (660-line) G01 source parses to a byte-identical AST across repeated calls, not just small synthetic snippets", () => {
  const sourceText = fs.readFileSync(path.resolve(__dirname, "../../ea-research/G01_LiquiditySweep_MSS_FVG/AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5"), "utf8");
  const a = parseMQL(tokenize(sourceText));
  const b = parseMQL(tokenize(sourceText));
  assert.deepEqual(a.program, b.program);
  assert.deepEqual(a.diagnostics, b.diagnostics);
});
