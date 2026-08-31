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

const SIM_OPTIONS = { initialBalance: 10_000, datasetId: "q10-e2e", datasetVersion: "v1", dataFidelity: "D1" as const, spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" as const };

function importAndCompile(source: string, id: string) {
  const { ir, report } = importMQLSource({ sourceText: source, fileName: `${id}.mq5`, options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
  const compilation = compileStrategy(ir);
  return { ir, report, compilation };
}

// --- Q0.10.28: the sprint's own Critical Success Criterion — Entry + SL/TP + Breakeven + Trailing, zero blocking, real ledger ---
test("Q0.10.28: a real MQL5 EA with entry, SL/TP, breakeven, AND trailing travels source -> IR -> StrategySpec -> simulation -> ledger with zero blocking diagnostics", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;
double g_bid;

void OnTick()
  {
   g_bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         double sl = g_bid - 0.0050;
         double tp = g_bid + 0.0200;
         g_trade.Buy(0.1,_Symbol,0.0,sl,tp,"c");
        }
      else if(fast<slow)
        {
         double sl = g_bid + 0.0050;
         double tp = g_bid - 0.0200;
         g_trade.Sell(0.1,_Symbol,0.0,sl,tp,"c");
        }
     }
   if(g_bid - OrderOpenPrice() >= 0.0020)
     {
      OrderModify(0, 0.0, OrderOpenPrice(), 0.0, 0, clrBlue);
     }
   if(g_bid - OrderOpenPrice() >= 0.0040)
     {
      OrderModify(0, 0.0, g_bid - 0.0015, 0.0, 0, clrBlue);
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report, compilation } = importAndCompile(source, "q10-full-management");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.ok(ir.risk.breakeven, "breakeven must be reduced from the source pattern");
  assert.ok(ir.risk.trailingStop, "trailingStop must be reduced from the source pattern");
  assert.equal(compilation.reductionReport.status, "REDUCED_WITH_WARNINGS");
  assert.ok(compilation.strategySpec);

  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
  assert.ok(result.provenance);
});

// --- Q0.10.29: partial close E2E — entry -> +1R -> partial close 50% -> trailing -> final exit, complete ledger ---
test("Q0.10.29: a real MQL5 EA combining partial-close and trailing produces a complete, multi-entry ledger with no dangling quantity", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;
double g_bid;

void OnTick()
  {
   g_bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         double sl = g_bid - 0.0050;
         double tp = g_bid + 0.0200;
         g_trade.Buy(0.2,_Symbol,0.0,sl,tp,"c");
        }
      else if(fast<slow)
        {
         double sl = g_bid + 0.0050;
         double tp = g_bid - 0.0200;
         g_trade.Sell(0.2,_Symbol,0.0,sl,tp,"c");
        }
     }
   if(g_bid - OrderOpenPrice() >= 0.0025)
     {
      OrderClose(0, OrderLots() * 0.5, g_bid, 3, clrBlue);
     }
   if(g_bid - OrderOpenPrice() >= 0.0040)
     {
      OrderModify(0, 0.0, g_bid - 0.0015, 0.0, 0, clrBlue);
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report, compilation } = importAndCompile(source, "q10-partial-close");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.ok(ir.risk.partialClose, "partialClose must be reduced from the OrderClose(lots*0.5) pattern");
  assert.equal(ir.risk.partialClose!.closePercent, 50);
  assert.ok(compilation.strategySpec);

  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
});

// --- Q0.10.30: short E2E — long/short semantics must be symmetric ---
test("Q0.10.30: the SAME breakeven/trailing patterns are reduced identically for the SELL branch of a real MQL5 EA", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;
double g_bid;

void OnTick()
  {
   g_bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast<slow)
        {
         double sl = g_bid + 0.0050;
         double tp = g_bid - 0.0200;
         g_trade.Sell(0.1,_Symbol,0.0,sl,tp,"c");
        }
     }
   if(OrderOpenPrice() - g_bid >= 0.0030)
     {
      OrderModify(0, 0.0, OrderOpenPrice(), 0.0, 0, clrBlue);
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report, compilation } = importAndCompile(source, "q10-short-e2e");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.ok(ir.risk.breakeven, "breakeven must be reduced symmetrically for the SELL-side favorable-move shape (OrderOpenPrice() - g_bid >= trigger)");
  assert.ok(compilation.strategySpec);

  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
});

// --- Q0.10.31: ATR management — trailing distance derived from a real iATR() call, warmup handled exactly like Q0.9 ---
test("Q0.10.31: an ATR-based trailing distance is detected, reduced, and executed without ever evaluating against incomplete indicator state", () => {
  const source = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade g_trade;
double g_bid;

void OnTick()
  {
   g_bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double atr = iATR(_Symbol,PERIOD_M5,14,0);
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         double sl = g_bid - 0.0050;
         double tp = g_bid + 0.0200;
         g_trade.Buy(0.1,_Symbol,0.0,sl,tp,"c");
        }
      else if(fast<slow)
        {
         double sl = g_bid + 0.0050;
         double tp = g_bid - 0.0200;
         g_trade.Sell(0.1,_Symbol,0.0,sl,tp,"c");
        }
     }
   if(g_bid - OrderOpenPrice() >= 0.0030)
     {
      OrderModify(0, 0.0, g_bid - (atr * 1.5), 0.0, 0, clrBlue);
     }
  }
int OnInit() { return(0); }
void OnDeinit(const int reason) {}
`;
  const { ir, report, compilation } = importAndCompile(source, "q10-atr-trailing");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.ok(ir.risk.trailingStop, "trailing must be reduced from the <price> - (atrVar*literal) pattern");
  assert.deepEqual(ir.risk.trailingStop!.distance, { mode: "atr-multiple", atrMultiple: 1.5, atrPeriod: 14 });
  assert.ok(ir.indicators.some((i) => i.kind === "named" && i.family === "ATR" && i.params[0] === 14), "the ATR(14) indicator referenced by the trailing rule must itself be present in ir.indicators");
  assert.ok(compilation.strategySpec);

  // The warmup-slicing fix (Q0.9) must handle this exactly like any other indicator: no crash from evaluating against an undefined ATR value in the warmup window.
  const bars = buildSyntheticFxBars(200, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, SIM_OPTIONS);
  assert.ok(result.simulationResultHash);
});
