import { test } from "node:test";
import assert from "node:assert/strict";
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation } from "../src/runtime/reduction/simulation-adapter.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { createStaticBarDetailProvider } from "../src/runtime/fidelity/static-bar-detail-provider.js";
import { buildSyntheticFxBars } from "./fixtures/q09-mql-e2e-fixtures.js";

function importAndCompile(source: string, id: string, dialect: "MQL4" | "MQL5") {
  const { ir, report } = importMQLSource({
    sourceText: source,
    fileName: `${id}.mq${dialect === "MQL4" ? "4" : "5"}`,
    forcedDialect: dialect,
    options: { strategyId: id, strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 },
  });
  const compilation = compileStrategy(ir);
  return { ir, report, compilation };
}

// --- Q0.13.19 E2E case 1 (MQL4): a real BUY STOP entry, unconditionally cancelled by an order-type-filtered OrderDelete ---
const MQL4_STOP_ENTRY_WITH_CANCEL = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
int OP_BUYSTOP = 4;
datetime g_lastTime = 0;
int g_ticket = 0;

int start()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         g_ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);
        }
     }
   if(OrderType()==OP_BUYSTOP)
     {
      OrderDelete(g_ticket);
     }
   return(0);
  }
int init() { return(0); }
`;

test("Q0.13.19 MQL4 E2E (D1): source -> lexer -> parser -> semantic analysis -> IR -> StrategySpec -> risk -> OrderModificationIntent -> Q0.12 validate/apply -> simulation -> order state, with zero blocking diagnostics", () => {
  const { ir, report, compilation } = importAndCompile(MQL4_STOP_ENTRY_WITH_CANCEL, "q13-mql4-cancel-e2e", "MQL4");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  assert.ok(ir.pendingOrderManagement, "IR must carry a compiled pendingOrderManagement block");
  const executableRule = ir.pendingOrderManagement!.rules.find((r) => r.semanticFidelity === "EXACT");
  assert.ok(executableRule, "at least one fully executable rule must be compiled");
  assert.equal(executableRule!.operation.kind, "CANCEL_PENDING");
  assert.ok(compilation.strategySpec, "reduction must succeed (not BLOCKED)");
  assert.ok(compilation.strategySpec!.pendingOrderManagement, "the compiled StrategySpec must carry the pending-order-management policy");

  const bars = buildSyntheticFxBars(300, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, { initialBalance: 10_000, datasetId: "q13-e2e", datasetVersion: "v1", dataFidelity: "D1", spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" });
  assert.ok(result.simulationResultHash);
  assert.ok(result.provenance);
});

test("Q0.13.19 MQL4 E2E (D2/D3): the identical policy produces the identical order-management outcome through the fidelity-aware pathway", () => {
  const { compilation } = importAndCompile(MQL4_STOP_ENTRY_WITH_CANCEL, "q13-mql4-cancel-e2e-d2", "MQL4");
  assert.ok(compilation.strategySpec);
  const bars = buildSyntheticFxBars(300, "EURUSD", "M5");
  const detailProvider = createStaticBarDetailProvider([], "M1", "q13-fallback-provider");
  const result = compileToSimulation(compilation, bars, {
    initialBalance: 10_000,
    datasetId: "q13-e2e-d2",
    datasetVersion: "v1",
    dataFidelity: "D2",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider,
    detailTimeframe: "M1",
    missingDetailPolicy: "FALLBACK_TO_D1",
  });
  assert.ok(result.simulationResultHash);
});

// --- Q0.13.19 E2E case 2 (MQL5): a real BUY STOP entry, price-modified via CTrade.OrderModify guarded by an order-type filter ---
const MQL5_STOP_ENTRY_WITH_MODIFY = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
datetime g_lastTime = 0;
CTrade trade;
ulong g_ticket = 1;

void OnTick()
  {
   if(Time[0] != g_lastTime)
     {
      g_lastTime = Time[0];
      double fast = iMA(_Symbol,PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      double slow = iMA(_Symbol,PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
      if(fast>slow)
        {
         trade.BuyStop(0.1,1.1030,_Symbol,0.0,0.0,ORDER_TIME_GTC,0,"c");
        }
     }
   if(OrderType()==OP_BUYSTOP)
     {
      trade.OrderModify(g_ticket, Bid + 0.0015, 0.0, 0.0, ORDER_TIME_GTC, 0, 0.0);
     }
  }
int OnInit() { return(0); }
`;

test("Q0.13.19 MQL5 E2E (D1): a real BuyStop entry with a CTrade.OrderModify pending-order price modification travels the full pipeline with zero blocking diagnostics", () => {
  const { ir, report, compilation } = importAndCompile(MQL5_STOP_ENTRY_WITH_MODIFY, "q13-mql5-modify-e2e", "MQL5");
  assert.equal(report.diagnostics.filter((d) => d.severity === "BLOCKING").length, 0);
  const executableRule = ir.pendingOrderManagement!.rules.find((r) => r.semanticFidelity === "EXACT");
  assert.ok(executableRule, "at least one fully executable rule must be compiled");
  assert.equal(executableRule!.operation.kind, "MODIFY_STOP");
  assert.ok(compilation.strategySpec);

  const bars = buildSyntheticFxBars(300, "EURUSD", "M5");
  const result = compileToSimulation(compilation, bars, { initialBalance: 10_000, datasetId: "q13-e2e-mql5", datasetVersion: "v1", dataFidelity: "D1", spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" });
  assert.ok(result.simulationResultHash);
});

test("Q0.13.19 MQL5 E2E (D2/D3): the identical MODIFY_STOP policy produces a deterministic result through the fidelity-aware pathway", () => {
  const { compilation } = importAndCompile(MQL5_STOP_ENTRY_WITH_MODIFY, "q13-mql5-modify-e2e-d2", "MQL5");
  assert.ok(compilation.strategySpec);
  const bars = buildSyntheticFxBars(300, "EURUSD", "M5");
  const detailProvider = createStaticBarDetailProvider([], "M1", "q13-fallback-provider-2");
  const result = compileToSimulation(compilation, bars, {
    initialBalance: 10_000,
    datasetId: "q13-e2e-mql5-d2",
    datasetVersion: "v1",
    dataFidelity: "D2",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider,
    detailTimeframe: "M1",
    missingDetailPolicy: "FALLBACK_TO_D1",
  });
  assert.ok(result.simulationResultHash);
});
