/**
 * Q0.13.27 performance baseline for pending-order-management detection,
 * compilation, target resolution, and runtime evaluation. Correctness
 * first — this is a measurement script, not a gate; nothing here asserts
 * a threshold. Run with: npm run benchmark:pending-management
 */
import { importMQLSource } from "../src/runtime/mql-importer/mql-importer.js";
import { compileStrategy } from "../src/runtime/reduction/compilation.js";
import { compileToSimulation } from "../src/runtime/reduction/simulation-adapter.js";
import { createOrder, transitionOrder } from "../src/runtime/simulation/order-engine.js";
import { evaluatePendingOrderManagementPolicy } from "../src/runtime/simulation/pending-order-management.js";
import { ZeroSpread } from "../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../src/runtime/simulation/latency-model.js";
import { bar } from "../test/fixtures/q11-order-fixtures.js";
import { buildSyntheticFxBars } from "../test/fixtures/q09-mql-e2e-fixtures.js";
import type { PendingOrderManagementPolicy, PendingOrderManagementRule } from "../src/domain/pending-order-management-policy.js";

function time(label: string, fn: () => void, iterations: number): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / iterations) * 1000).toFixed(3)}us/op, N=${iterations})`);
}

console.log("AT24 Quant Engine — Q0.13 Pending-Order Management Performance Baseline\n");

const MQL4_SOURCE = `
input int InpFastPeriod = 9;
input int InpSlowPeriod = 21;
int OP_BUYSTOP = 4;
int ticket = 0;
datetime g_lastTime = 0;
int start()
{
if(Time[0] != g_lastTime)
{
g_lastTime = Time[0];
double fast = iMA(Symbol(),PERIOD_M5,InpFastPeriod,0,MODE_EMA,PRICE_CLOSE,0);
double slow = iMA(Symbol(),PERIOD_M5,InpSlowPeriod,0,MODE_EMA,PRICE_CLOSE,0);
if(fast>slow)
{
ticket = OrderSend(Symbol(),OP_BUYSTOP,0.1,1.1030,3,0,0,"c",0,0,clrBlue);
}
}
if(OrderType()==OP_BUYSTOP)
{
OrderModify(ticket, Bid + 0.0015, OrderStopLoss(), OrderTakeProfit(), 0);
}
return(0);
}
int init() { return(0); }
`;

for (const N of [10_000, 100_000]) {
  console.log(`\n--- N=${N} ---`);
  time(
    "importMQLSource (lexer+parser+semantic-analyzer+ir-generator, full pipeline including pending-order detection)",
    () => {
      for (let i = 0; i < N / 100; i++) {
        importMQLSource({ sourceText: MQL4_SOURCE, fileName: "bench.mq4", forcedDialect: "MQL4", options: { strategyId: "bench", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
      }
    },
    N / 100,
  );
}

const { ir } = importMQLSource({ sourceText: MQL4_SOURCE, fileName: "bench.mq4", forcedDialect: "MQL4", options: { strategyId: "bench", strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, executionTimeframe: "M5", importedAt: 0 } });
const compilation = compileStrategy(ir);
if (!compilation.strategySpec) throw new Error("benchmark fixture failed to compile");

const order = transitionOrder(transitionOrder(createOrder({ strategyVersion: "1.0.0", instrument: { symbol: "EURUSD" }, side: "BUY", quantity: 0.1, orderType: "STOP", stopPrice: 1.103, creationTimestamp: -1 }, 1), "SUBMITTED"), "ACCEPTED");
const rule: PendingOrderManagementRule = { id: "r", target: { kind: "SYMBOL", orderTypeFilter: "STOP", sideFilter: "BUY", provable: true }, condition: { kind: "ALWAYS", provable: true }, operation: { kind: "MODIFY_STOP", newDistanceFromClose: { mode: "absolute", value: 0.0015 } }, semanticFidelity: "EXACT" };
const policy: PendingOrderManagementPolicy = { rules: [rule] };
const b = bar(0, 1.1, 1.1005, 1.0995, 1.1002);

for (const N of [10_000, 100_000, 1_000_000]) {
  console.log(`\n--- N=${N} ---`);
  time("evaluatePendingOrderManagementPolicy (single rule, MODIFY_STOP fires)", () => { for (let i = 0; i < N; i++) evaluatePendingOrderManagementPolicy(policy, order, b, "bench"); }, N);
}

console.log("\n--- Full simulation with an attached pendingOrderManagementPolicy ---");
const bars = buildSyntheticFxBars(300, "EURUSD", "M5");
const N_SIM = 500;
time(
  "compileToSimulation (D1_OHLC, real MQL4 strategy + compiled policy)",
  () => {
    for (let i = 0; i < N_SIM; i++) {
      compileToSimulation(compilation, bars, { initialBalance: 10_000, datasetId: "bench", datasetVersion: "v1", dataFidelity: "D1", spreadModel: ZeroSpread, slippageModel: ZeroSlippage, feeModel: ZeroFee, latencyModel: ZeroLatency, fidelity: "D1_OHLC" });
    }
  },
  N_SIM,
);
