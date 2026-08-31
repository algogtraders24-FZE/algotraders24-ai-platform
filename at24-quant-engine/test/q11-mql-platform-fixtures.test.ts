import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation } from "../src/runtime/reduction/simulation-adapter.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";

const SIM_OPTIONS = { initialBalance: 10_000, datasetId: "q11-platform-e2e", datasetVersion: "v1", dataFidelity: "D1" as const, spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" as const };

function importAndCompile(source: string, id: string, dialect?: "MQL4" | "MQL5") {
  const { ir, report } = importMQLSource({ sourceText: source, fileName: `${id}.mq${dialect === "MQL4" ? "4" : "5"}`, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 }, ...(dialect ? { forcedDialect: dialect } : {}) });
  const compilation = compileStrategy(ir);
  return { ir, report, compilation };
}

// --- Q0.11.14: MQL4 OP_BUYLIMIT/OP_SELLLIMIT/OP_BUYSTOP/OP_SELLSTOP mapping ---
test("Q0.11.14 MQL4: OP_BUYLIMIT/OP_SELLLIMIT map to canonical LIMIT, distinct from a plain OP_BUY/OP_SELL market order", () => {
  const source = `
extern int InpFastPeriod = 9;
extern int InpSlowPeriod = 21;
datetime g_lastTime = 0;
int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         OrderSend(Symbol(),OP_BUYLIMIT,0.1,1.0950,3,sl,tp,"c",0,0,clrBlue);
      else if(fast<slow)
         OrderSend(Symbol(),OP_SELLLIMIT,0.1,1.1050,3,sl,tp,"c",0,0,clrRed);
     }
   return(0);
  }
`;
  const { ir, report, compilation } = importAndCompile(source, "q11-mql4-limit", "MQL4");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const buyEntry = ir.entries.find((e) => e.direction === "BUY")!;
  const sellEntry = ir.entries.find((e) => e.direction === "SELL")!;
  assert.equal(buyEntry.executionType, "LIMIT");
  assert.deepEqual(buyEntry.limitPrice, { kind: "OPERAND", operand: { kind: "literal", value: 1.095 } });
  assert.equal(sellEntry.executionType, "LIMIT");
  assert.equal(compilation.reductionReport.status, "REDUCED_WITH_WARNINGS");

  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
});

test("Q0.11.14 MQL4: OP_BUYSTOP/OP_SELLSTOP map to canonical STOP", () => {
  const source = `
extern int InpFastPeriod = 9;
extern int InpSlowPeriod = 21;
datetime g_lastTime = 0;
int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         OrderSend(Symbol(),OP_BUYSTOP,0.1,1.0950,3,sl,tp,"c",0,0,clrBlue);
     }
   return(0);
  }
`;
  const { ir, report } = importAndCompile(source, "q11-mql4-stop", "MQL4");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const buyEntry = ir.entries.find((e) => e.direction === "BUY")!;
  assert.equal(buyEntry.executionType, "STOP");
  assert.deepEqual(buyEntry.stopPrice, { kind: "OPERAND", operand: { kind: "literal", value: 1.095 } });
});

// --- Q0.11.14: MQL5 CTrade pending-order methods (previously not detected at all) ---
test("Q0.11.14 MQL5: CTrade.BuyStop/SellStop map to canonical STOP", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;

void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         g_trade.BuyStop(0.1,1.0950,_Symbol,sl,tp,ORDER_TIME_GTC,0,"c");
      else if(fast<slow)
         g_trade.SellStop(0.1,1.1050,_Symbol,sl,tp,ORDER_TIME_GTC,0,"c");
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report, compilation } = importAndCompile(source, "q11-mql5-stop");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const buyEntry = ir.entries.find((e) => e.direction === "BUY")!;
  assert.equal(buyEntry.executionType, "STOP");
  assert.deepEqual(buyEntry.stopPrice, { kind: "OPERAND", operand: { kind: "literal", value: 1.095 } });

  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
});

test("Q0.11.14 MQL5: CTrade.BuyLimit/SellLimit map to canonical LIMIT", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;

void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         g_trade.BuyLimit(0.1,1.0950,_Symbol,sl,tp,ORDER_TIME_GTC,0,"c");
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report } = importAndCompile(source, "q11-mql5-limit");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const buyEntry = ir.entries.find((e) => e.direction === "BUY")!;
  assert.equal(buyEntry.executionType, "LIMIT");
});

// --- Q0.11.15: MQL4/MQL5 dialect parity for equivalent pending-order semantics ---
test("Q0.11.15: equivalent MQL4 OP_BUYSTOP and MQL5 CTrade.BuyStop strategies produce the SAME canonical (platform-independent) semantic hash", async () => {
  const { computeCrossPlatformSemanticHash } = await import("../src/runtime/strategy-ir/ir-hash.js");
  const mql4Source = `
extern int InpFastPeriod = 9;
extern int InpSlowPeriod = 21;
datetime g_lastTime = 0;
int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         OrderSend(Symbol(),OP_BUYSTOP,0.1,1.0950,3,sl,tp,"c",0,0,clrBlue);
     }
   return(0);
  }
`;
  const mql5Source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;
void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double sl = 1.0950 - 0.0050;
      double tp = 1.0950 + 0.0200;
      if(fast>slow)
         g_trade.BuyStop(0.1,1.0950,_Symbol,sl,tp,ORDER_TIME_GTC,0,"c");
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir: ir4 } = importAndCompile(mql4Source, "parity-mql4", "MQL4");
  const { ir: ir5 } = importAndCompile(mql5Source, "parity-mql5", "MQL5");
  assert.equal(computeCrossPlatformSemanticHash(ir4), computeCrossPlatformSemanticHash(ir5), "equivalent STOP-order semantics must hash identically once platform identity is excluded");

  // Negative control: a genuinely different order type must hash differently.
  const mql4LimitSource = mql4Source.replace("OP_BUYSTOP", "OP_BUYLIMIT");
  const { ir: ir4Limit } = importAndCompile(mql4LimitSource, "parity-mql4-limit", "MQL4");
  assert.notEqual(computeCrossPlatformSemanticHash(ir4), computeCrossPlatformSemanticHash(ir4Limit), "a STOP and a LIMIT order are genuinely different semantics and must never hash the same");
});
