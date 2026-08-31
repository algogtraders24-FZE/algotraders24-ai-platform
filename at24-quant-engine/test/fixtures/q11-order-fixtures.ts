import type { Instrument, OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import type { StrategySpec, EntryRule } from "../../src/domain/strategy-spec.js";
import type { PriceReference } from "../../src/domain/strategy-ir/price-reference.js";
import type { OrderTypeIR } from "../../src/domain/strategy-ir/order-ir.js";
import type { RiskSpecification } from "../../src/domain/risk-specification.js";
import { indicator, indicatorKey } from "../../src/domain/indicator-reference.js";
import { comparison, indicatorOperand, literal } from "../../src/domain/expression.js";
import { ZeroSpread } from "../../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../../src/runtime/simulation/latency-model.js";
import type { SimulationConfig } from "../../src/runtime/simulation/simulation-engine.js";

/**
 * Q0.11 — shared scaffolding for order-type/gap/intrabar golden fixtures,
 * reusing the exact "PRICE pseudo-indicator, hand-crafted bars" pattern
 * Q0.5's own `simulation-fixtures.ts` and Q0.10's
 * `q10-position-management-fixtures.ts` already established.
 */
export const PRICE = indicator("PRICE");
export const ORD_INSTRUMENT: Instrument = { symbol: "ORDFIXTURE", assetClass: "other" };
export const ORD_TIMEFRAME: Timeframe = "H1";
const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

export function bar(index: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: ORD_INSTRUMENT, timeframe: ORD_TIMEFRAME, open, high, low, close, volume: 1000 };
}

export function absolute(price: number): PriceReference {
  return { kind: "OPERAND", operand: literal(price) };
}

export function buildOrderTypeSpec(direction: "BUY" | "SELL", executionType: OrderTypeIR, prices: { limitPrice?: PriceReference; stopPrice?: PriceReference } = {}, risk?: RiskSpecification): StrategySpec {
  const condition = direction === "BUY" ? comparison(">", indicatorOperand(PRICE), literal(100)) : comparison("<", indicatorOperand(PRICE), literal(100));
  const entryRule: EntryRule = { id: "entry-1", direction, condition, executionType, ...prices };
  return {
    identity: { strategyId: "ord-fixture", name: "Order Type Fixture" },
    version: "1.0.0",
    metadata: { createdAt: BASE_TS },
    instruments: [ORD_INSTRUMENT],
    timeframes: [ORD_TIMEFRAME],
    parameters: [],
    entryRules: [entryRule],
    exitRules: [],
    risk: risk ?? { sizing: { method: "fixed-quantity", quantity: 1 } },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };
}

export function buildOrderTypeConfig(bars: readonly OHLCVBar[], direction: "BUY" | "SELL", executionType: OrderTypeIR, prices: { limitPrice?: PriceReference; stopPrice?: PriceReference } = {}, risk?: RiskSpecification): SimulationConfig {
  return {
    strategySpec: buildOrderTypeSpec(direction, executionType, prices, risk),
    instrument: ORD_INSTRUMENT,
    timeframe: ORD_TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "ord-golden-fixture",
    datasetVersion: "v1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: new Map([[indicatorKey(PRICE), bars.map((b) => b.close)]]),
  };
}
