import type { Instrument, OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import type { StrategySpec } from "../../src/domain/strategy-spec.js";
import type { RiskSpecification } from "../../src/domain/risk-specification.js";
import { indicator, indicatorKey } from "../../src/domain/indicator-reference.js";
import { comparison, indicatorOperand, literal } from "../../src/domain/expression.js";
import { ZeroSpread } from "../../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../../src/runtime/simulation/latency-model.js";
import type { SimulationConfig } from "../../src/runtime/simulation/simulation-engine.js";

/**
 * Q0.10.20 — shared scaffolding for the 12 required position-management
 * golden fixtures. Reuses the EXACT same "PRICE pseudo-indicator, hand-
 * crafted bars" pattern Q0.5's own `simulation-fixtures.ts` established —
 * every bar below is chosen so the resulting entry/exit/action is
 * hand-derivable and independently verifiable, never "whatever a random
 * price series happens to produce." Every fixture uses stopLoss
 * fixed-distance=5 and quantity=1 (2 for PM_PARTIAL_CLOSE) unless noted,
 * so risk distance is always 6 (signal-bar-close 101 minus stop 96 for
 * BUY, or the symmetric 104 minus 98 for SELL) — see
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md's fill-price-vs-decision-price
 * note for why entryPrice (102) and the stop's reference price (101)
 * differ by exactly the one-bar gap used here.
 */
export const PRICE = indicator("PRICE");
export const PM_INSTRUMENT: Instrument = { symbol: "PMFIXTURE", assetClass: "other" };
export const PM_TIMEFRAME: Timeframe = "H1";
const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

export function bar(index: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: PM_INSTRUMENT, timeframe: PM_TIMEFRAME, open, high, low, close, volume: 1000 };
}

export function buildManagementSpec(direction: "BUY" | "SELL", risk: RiskSpecification): StrategySpec {
  const condition = direction === "BUY" ? comparison(">", indicatorOperand(PRICE), literal(100)) : comparison("<", indicatorOperand(PRICE), literal(100));
  return {
    identity: { strategyId: "pm-fixture", name: "Position Management Fixture" },
    version: "1.0.0",
    metadata: { createdAt: BASE_TS },
    instruments: [PM_INSTRUMENT],
    timeframes: [PM_TIMEFRAME],
    parameters: [],
    entryRules: [{ id: "entry-1", direction, condition }],
    exitRules: [],
    risk,
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };
}

export function buildManagementConfig(bars: readonly OHLCVBar[], direction: "BUY" | "SELL", risk: RiskSpecification, atrByIndex?: readonly number[]): SimulationConfig {
  return {
    strategySpec: buildManagementSpec(direction, risk),
    instrument: PM_INSTRUMENT,
    timeframe: PM_TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "pm-golden-fixture",
    datasetVersion: "v1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: new Map([[indicatorKey(PRICE), bars.map((b) => b.close)]]),
    ...(atrByIndex !== undefined ? { atrByIndex } : {}),
  };
}
