import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "../src/runtime/mql-importer/lexer.js";
import { parseMQL } from "../src/runtime/mql-importer/parser.js";
import { detectDialect } from "../src/runtime/mql-importer/dialect-detector.js";
import { analyzeMQLSemantics } from "../src/runtime/mql-importer/semantic-analyzer.js";

function analyze(source: string, forcedDialect?: "MQL4" | "MQL5") {
  const { program } = parseMQL(tokenize(source));
  const { dialect } = detectDialect(program, forcedDialect);
  return { ...analyzeMQLSemantics(program, dialect), dialect };
}

test("Q0.8.7: MQL5 dialect is detected from OnInit/OnTick constructs, never from a filename", () => {
  const { dialect } = analyze("void OnTick() {}\nint OnInit() { return(0); }\n");
  assert.equal(dialect, "MQL5");
});

test("Q0.8.7: MQL4 dialect is detected from bare init/start/deinit constructs", () => {
  const { dialect } = analyze("int init() { return(0); }\nvoid start() {}\nvoid deinit() {}\n");
  assert.equal(dialect, "MQL4");
});

test("Q0.8.8: all 4 MQL5 event handlers are recognized and tagged with the correct MQLEventKind", () => {
  const { model } = analyze("int OnInit(){return(0);}\nvoid OnDeinit(const int r){}\nvoid OnTick(){}\nvoid OnTradeTransaction(){}\n");
  const kinds = model.eventHandlers.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["MQL5_ONDEINIT", "MQL5_ONINIT", "MQL5_ONTICK", "MQL5_ONTRADETRANSACTION"]);
});

test("Q0.8.10: Time[0] != lastTime is recognized as a provable TIME_COMPARISON new-bar pattern", () => {
  const { model } = analyze("void f(datetime lastTime) { if(Time[0] != lastTime) { lastTime = Time[0]; } }");
  assert.equal(model.newBarDetectionSites.length, 1);
  assert.equal(model.newBarDetectionSites[0]!.pattern, "TIME_COMPARISON");
  assert.equal(model.newBarDetectionSites[0]!.provable, true);
});

test("Q0.8.10: a custom cross-file-looking new-bar function is recognized by name but marked UNPROVABLE, with a WARNING", () => {
  const { model, diagnostics } = analyze("void OnTick() { if(G01_IsNewBar(_Symbol,PERIOD_M5,g_last)) { } }");
  assert.equal(model.newBarDetectionSites.length, 1);
  assert.equal(model.newBarDetectionSites[0]!.pattern, "CUSTOM_FUNCTION_CALL");
  assert.equal(model.newBarDetectionSites[0]!.provable, false);
  assert.ok(diagnostics.some((d) => d.code === "NEW_BAR_UNPROVABLE" && d.severity === "WARNING"));
});

test("Q0.8.11/12: Close[1] is recognized as a series reference at offset 1; Close[-1] is BLOCKING (future offset)", () => {
  const { model, diagnostics } = analyze("void f() { double a = Close[1]; double b = Close[-1]; }");
  assert.equal(model.seriesReferences.length, 1);
  assert.equal(model.seriesReferences[0]!.series, "CLOSE");
  assert.equal(model.seriesReferences[0]!.offset, 1);
  assert.ok(diagnostics.some((d) => d.code === "FUTURE_SHIFT_REJECTED" && d.severity === "BLOCKING"));
});

test("Q0.8.13/14: iMA (MQL4-style, direct read) and CopyBuffer (MQL5-style, buffer copy) are correctly distinguished", () => {
  const mql4 = analyze("void f() { double v = iMA(_Symbol,PERIOD_M5,20,0,MODE_SMA,PRICE_CLOSE,0); }", "MQL4");
  assert.equal(mql4.model.indicatorCalls[0]!.recognizedFamily, "SMA");
  assert.equal(mql4.model.indicatorCalls[0]!.role, "DIRECT_READ");

  const mql5 = analyze("int handle;\nvoid f() { double buf[]; CopyBuffer(handle,0,0,3,buf); }", "MQL5");
  assert.equal(mql5.model.indicatorCalls[0]!.functionName, "CopyBuffer");
  assert.equal(mql5.model.indicatorCalls[0]!.role, "BUFFER_COPY");
  assert.equal(mql5.model.indicatorCalls[0]!.handleVariable, "handle");
  assert.equal(mql5.model.indicatorCalls[0]!.bufferIndex, 0);
});

test("Q0.8.14: handle CREATION (iATR assigned once at init) is distinguished from a later buffer COPY — never confused with each other", () => {
  const { model } = analyze("int h;\nvoid OnInit() { h = iATR(_Symbol,PERIOD_M5,14); }\nvoid f() { double buf[]; CopyBuffer(h,0,1,1,buf); }", "MQL5");
  const atr = model.indicatorCalls.find((c) => c.functionName === "iATR")!;
  const copy = model.indicatorCalls.find((c) => c.functionName === "CopyBuffer")!;
  assert.equal(atr.role, "HANDLE_CREATION");
  assert.equal(atr.recognizedFamily, "ATR");
  assert.equal(copy.role, "BUFFER_COPY");
});

test("Q0.8.16: the provable crossAbove pattern (prev<=prev && curr>curr, same series pair) is recognized", () => {
  const { model } = analyze("void f() { if(Fast[1]<=Slow[1] && Fast[0]>Slow[0]) { } }");
  assert.equal(model.crossPatterns.length, 1);
  assert.equal(model.crossPatterns[0]!.direction, "cross_above");
});

test("Q0.8.16: an arbitrary comparison is NEVER rewritten into a cross pattern — only the provable shape matches", () => {
  const { model } = analyze("void f() { if(Fast[0]>Slow[0] && Bid>Ask) { } }");
  assert.equal(model.crossPatterns.length, 0);
});

test("Q0.8.19/20/21: CTrade.Buy/Sell order calls are recognized with side/volume/SL/TP extracted from source-text expressions", () => {
  const { model } = analyze('void f() { g_trade.Buy(lots,_Symbol,0.0,sl,tp,"cmt"); }');
  assert.equal(model.orderCalls.length, 1);
  assert.equal(model.orderCalls[0]!.style, "CTrade.Buy");
  assert.equal(model.orderCalls[0]!.side, "BUY");
  assert.equal(model.orderCalls[0]!.volumeExpr, "lots");
  assert.equal(model.orderCalls[0]!.slExpr, "sl");
  assert.equal(model.orderCalls[0]!.tpExpr, "tp");
});

test("Q0.8.23: position/history query calls are recognized without being reinterpreted as new semantics", () => {
  const { model } = analyze("void f() { int n = PositionsTotal(); ulong t = PositionGetTicket(0); }");
  const names = model.positionQueries.map((p) => p.functionName);
  assert.deepEqual(names.sort(), ["PositionGetTicket", "PositionsTotal"]);
});

test("Q0.8.30: TimeLocal() is flagged as platform-dependent, never silently treated as UTC/server time", () => {
  const { model, diagnostics } = analyze("void f() { datetime t = TimeLocal(); }");
  assert.equal(model.sessionTimeCalls[0]!.isLocalTime, true);
  assert.ok(diagnostics.some((d) => d.code === "LOCAL_TIME_USED" && d.severity === "WARNING"));
});

test("Q0.8.37: iCustom is flagged ICUSTOM, never executed or guessed at", () => {
  const { model } = analyze('void f() { double v = iCustom(_Symbol,0,"MyIndicator",0,0); }');
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ICUSTOM" && u.functionName === "iCustom"));
});

test("Q0.8.38: WebRequest is flagged WEBREQUEST — external network dependency, never silently allowed", () => {
  const { model } = analyze('void f() { char data[]; char result[]; string headers; WebRequest("GET","http://x",headers,0,data,result,headers); }');
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "WEBREQUEST"));
});

test("Q0.8.39: AccountInfoDouble / broker stop-distance constants are separated from strategy semantics as dependency categories", () => {
  const { model } = analyze("void f() { double eq = AccountInfoDouble(ACCOUNT_EQUITY); long lvl = SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL); }");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY" && u.functionName === "AccountInfoDouble"));
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "BROKER_CONSTRAINT_DEPENDENCY"));
});

test("Q0.8.35: an unconditional live bid/ask read in OnTick (not gated behind a new-bar check) is flagged as a realtime-dependency signal", () => {
  const { model } = analyze(
    "bool checkEntry() { double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID); return bid > 0; }\nvoid OnTick() { checkEntry(); }",
  );
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY" && u.functionName.includes("unconditional realtime bid/ask read")));
});

test("Q0.8.17/18: global variables are tracked as state, with distinct read and write positions", () => {
  const { model } = analyze("int g_count = 0;\nvoid f() { g_count = g_count + 1; }");
  const state = model.stateVariables.find((s) => s.name === "g_count")!;
  assert.ok(state.writePositions.length >= 1);
  assert.ok(state.readPositions.length >= 1);
});

test("an unresolved custom cross-file function call (not a recognized builtin, not defined in this file) is recorded honestly, never guessed at", () => {
  const { model } = analyze("void f() { G01_CalculateSL(1,2,3); }");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "UNRESOLVED_CROSS_FILE_CALL" && u.functionName === "G01_CalculateSL"));
});

test("a call to a function DEFINED in the same file is never flagged as unresolved", () => {
  const { model } = analyze("void helper() {}\nvoid f() { helper(); }");
  assert.equal(model.unsupportedConstructs.filter((u) => u.functionName === "helper").length, 0);
});
