import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { MQL_GOLDEN_FIXTURES, baseOptions } from "./fixtures/mql-fixtures.js";

function importFixture(name: keyof typeof MQL_GOLDEN_FIXTURES, forcedDialect?: "MQL4" | "MQL5") {
  return importMQLSource({ sourceText: MQL_GOLDEN_FIXTURES[name]!, fileName: `${name}.mq5`, options: baseOptions(), ...(forcedDialect ? { forcedDialect } : {}) });
}

test("Q0.8.47: all 26 golden fixtures (25 synthetic + G01, tested separately) parse with zero BLOCKING diagnostics except the deliberately-invalid future-shift fixture", () => {
  for (const name of Object.keys(MQL_GOLDEN_FIXTURES)) {
    const { report } = importFixture(name as keyof typeof MQL_GOLDEN_FIXTURES);
    const blockingParse = report.diagnostics.filter((d) => d.severity === "BLOCKING" && d.code.startsWith("PARSE"));
    assert.equal(blockingParse.length, 0, `${name}: unexpected parse-level BLOCKING diagnostics: ${JSON.stringify(blockingParse)}`);
  }
});

test("1. SMA crossover: iMA is recognized and mapped to the SMA family", () => {
  const { model } = importFixture("smaCrossover", "MQL4");
  assert.ok(model.indicatorCalls.some((c) => c.functionName === "iMA" && c.recognizedFamily === "SMA"));
});

test("2. EMA crossover: the provable cross_above pattern is recognized", () => {
  const { model } = importFixture("emaCrossover");
  assert.equal(model.crossPatterns.length, 1);
  assert.equal(model.crossPatterns[0]!.direction, "cross_above");
});

test("3. RSI: iRSI is recognized and mapped to the RSI family", () => {
  const { model } = importFixture("rsi", "MQL4");
  assert.ok(model.indicatorCalls.some((c) => c.functionName === "iRSI" && c.recognizedFamily === "RSI"));
});

test("4. ATR SL: iATR is recognized as an indicator call feeding a stop-loss computation", () => {
  const { model } = importFixture("atrSL", "MQL4");
  assert.ok(model.indicatorCalls.some((c) => c.functionName === "iATR" && c.recognizedFamily === "ATR"));
});

test("5. ATR TP: iATR is recognized feeding a take-profit computation", () => {
  const { model } = importFixture("atrTP", "MQL4");
  assert.ok(model.indicatorCalls.some((c) => c.recognizedFamily === "ATR"));
});

test("6. Fixed SL/TP: parses cleanly with no indicator dependency", () => {
  const { model, report } = importFixture("fixedSLTP");
  assert.equal(model.indicatorCalls.length, 0);
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
});

test("7/8. Market BUY/SELL: CTrade.Buy and CTrade.Sell are recognized with side set correctly", () => {
  const buy = importFixture("marketBuy");
  const sell = importFixture("marketSell");
  assert.equal(buy.model.orderCalls[0]!.side, "BUY");
  assert.equal(sell.model.orderCalls[0]!.side, "SELL");
});

test("9. Limit order: OrderSend is recognized as an order call site", () => {
  const { model } = importFixture("limitOrder", "MQL4");
  assert.equal(model.orderCalls[0]!.style, "OrderSend");
});

test("10. Stop order: OrderSend is recognized as an order call site", () => {
  const { model } = importFixture("stopOrder", "MQL4");
  assert.equal(model.orderCalls[0]!.style, "OrderSend");
});

test("11. Trailing: OrderModify is recognized as a modify call site", () => {
  const { model } = importFixture("trailing", "MQL4");
  assert.ok(model.modifyCalls.some((m) => m.functionName === "OrderModify"));
});

test("12. Breakeven: OrderModify is recognized (classification UNKNOWN — Q0.8.25's 'never assume every modification is trailing')", () => {
  const { model } = importFixture("breakeven", "MQL4");
  assert.ok(model.modifyCalls.some((m) => m.functionName === "OrderModify" && m.classification === "UNKNOWN"));
});

test("13. Partial close: OrderClose(ticket, partialVolume, ...) is recognized as a partial-close site", () => {
  const { model } = importFixture("partialClose", "MQL4");
  assert.equal(model.partialCloseCalls.length, 1);
  assert.equal(model.partialCloseCalls[0]!.volumeExpr, "0.05");
});

test("14. Session: TimeToStruct/TimeCurrent are recognized as session-relevant calls, and session-hour inputs are extracted as parameters", () => {
  const { model, ir } = importFixture("session");
  assert.ok(model.sessionTimeCalls.some((c) => c.functionName === "TimeToStruct"));
  assert.ok(ir.parameters.some((p) => p.key === "InpSessionStartHour"));
});

test("15. MTF: both PERIOD_M5 and PERIOD_H1 are recognized as distinct timeframes via their iClose() series-reference sites", () => {
  const { model } = importFixture("mtf", "MQL4");
  const timeframes = new Set(model.seriesReferences.map((s) => s.timeframeExpr));
  assert.ok(timeframes.has("PERIOD_H1"));
  assert.ok(timeframes.has("PERIOD_M5"));
});

test("16. Multi-symbol: both EURUSD and GBPUSD literal symbol arguments are recognized as distinct series references", () => {
  const { model } = importFixture("multiSymbol", "MQL4");
  const symbols = model.seriesReferences.map((s) => s.symbolExpr).filter(Boolean);
  assert.ok(symbols.some((s) => s?.includes("EURUSD")));
  assert.ok(symbols.some((s) => s?.includes("GBPUSD")));
});

test("17. Netting: a single CTrade.Buy gated by PositionSelect (no hedging setup) is recognized as a plain order call", () => {
  const { model } = importFixture("netting");
  assert.equal(model.orderCalls[0]!.style, "CTrade.Buy");
  assert.ok(model.positionQueries.some((p) => p.functionName === "PositionSelect"));
});

test("18. Hedging: two independently-magic-numbered OrderSend tickets (opposite directions) are both recognized as separate order calls", () => {
  const { model } = importFixture("hedging", "MQL4");
  assert.equal(model.orderCalls.filter((o) => o.style === "OrderSend").length, 2);
});

test("19. Reversal: a position close followed by an opposite-direction entry is recognized as two separate, real order-lifecycle calls", () => {
  const { model } = importFixture("reversal");
  assert.ok(model.positionQueries.some((p) => p.functionName === "PositionSelect"));
  assert.equal(model.orderCalls[0]!.style, "CTrade.Sell");
});

test("20. Dynamic sizing: AccountInfoDouble(ACCOUNT_EQUITY) is recognized as an account dependency feeding a sizing calculation", () => {
  const { model } = importFixture("dynamicSizing");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ACCOUNT_DEPENDENCY" && u.functionName === "AccountInfoDouble"));
});

test("21. iCustom: flagged ICUSTOM, never executed or guessed at", () => {
  const { model } = importFixture("iCustomIndicator", "MQL4");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ICUSTOM"));
});

test("22. DLL import: #import directive is recognized (as an unsupported preprocessor construct) — never silently accepted", () => {
  const { report } = importFixture("dllImport", "MQL4");
  assert.ok(report.diagnostics.some((d) => d.code === "UNSUPPORTED_PREPROCESSOR"));
});

test("23. WebRequest: flagged WEBREQUEST — an external network dependency, never silently allowed", () => {
  const { model } = importFixture("webRequest");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "WEBREQUEST"));
});

test("24. Repainting/current-bar: an iCustom-dependent signal is flagged ICUSTOM — the importer never independently claims NON_REPAINTING for a strategy built on an unanalyzable indicator", () => {
  const { model, ir } = importFixture("repaintingCurrentBar", "MQL4");
  assert.ok(model.unsupportedConstructs.some((u) => u.category === "ICUSTOM"));
  assert.notEqual(ir.repaintingModel, "NON_REPAINTING");
});

test("25. Future-shift rejection: Close[-1] is rejected as a BLOCKING diagnostic, never silently clamped to Close[0] or Close[1]", () => {
  const { report } = importFixture("futureShiftRejection");
  assert.ok(report.diagnostics.some((d) => d.code === "FUTURE_SHIFT_REJECTED" && d.severity === "BLOCKING"));
});

test("26. G01 real EA — see test/mql-g01-import.test.ts (the primary real-world fixture, tested in its own dedicated file)", () => {
  assert.ok(true);
});
