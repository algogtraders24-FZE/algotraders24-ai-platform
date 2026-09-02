import type { Instrument, OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import type { StrategySpec, ExitRule } from "../../src/domain/strategy-spec.js";
import type { RiskSpecification } from "../../src/domain/risk-specification.js";
import type { PyramidingPolicy } from "../../src/domain/strategy-ir/position-ir.js";
import { indicator, indicatorKey } from "../../src/domain/indicator-reference.js";
import { comparison, indicatorOperand, literal } from "../../src/domain/expression.js";
import { ZeroSpread } from "../../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../../src/runtime/simulation/latency-model.js";
import type { SimulationConfig } from "../../src/runtime/simulation/simulation-engine.js";
import type { MultiFidelityConfig } from "../../src/runtime/fidelity/multi-fidelity-config.js";
import { createStaticBarDetailProvider } from "../../src/runtime/fidelity/static-bar-detail-provider.js";

/**
 * Q1.5 — shared scaffolding for pyramiding + SIGNAL_EXIT tests, mirroring
 * Q0.10's own "PRICE pseudo-indicator, hand-crafted bars" pattern exactly
 * (test/fixtures/q10-position-management-fixtures.ts) so every bar's
 * resulting entry/pyramid/exit decision is hand-derivable and
 * independently verifiable — never "whatever a random price series
 * happens to produce."
 */
export const PRICE = indicator("PRICE");
export const Q15_INSTRUMENT: Instrument = { symbol: "Q15FIXTURE", assetClass: "other" };
export const Q15_TIMEFRAME: Timeframe = "H1";
const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

export function bar(index: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: Q15_INSTRUMENT, timeframe: Q15_TIMEFRAME, open, high, low, close, volume: 1000 };
}
/** A degenerate flat bar (open=high=low=close) — the simplest possible fixture shape, used whenever intrabar range is irrelevant to the scenario. */
export function flatBar(index: number, price: number): OHLCVBar {
  return bar(index, price, price, price, price);
}

export interface Q15SpecOptions {
  readonly direction: "BUY" | "SELL";
  readonly entryThreshold?: number; // default 100, entry condition is direction==="BUY" ? PRICE > threshold : PRICE < threshold
  readonly exitRules?: readonly ExitRule[];
  readonly pyramiding?: PyramidingPolicy;
  readonly risk?: Partial<RiskSpecification>;
}

export function buildQ15Spec(opts: Q15SpecOptions): StrategySpec {
  const threshold = opts.entryThreshold ?? 100;
  const condition = opts.direction === "BUY" ? comparison(">", indicatorOperand(PRICE), literal(threshold)) : comparison("<", indicatorOperand(PRICE), literal(threshold));
  return {
    identity: { strategyId: "q15-fixture", name: "Q1.5 Pyramiding/Exit Fixture" },
    version: "1.0.0",
    metadata: { createdAt: BASE_TS },
    instruments: [Q15_INSTRUMENT],
    timeframes: [Q15_TIMEFRAME],
    parameters: [],
    entryRules: [{ id: "entry-1", direction: opts.direction, condition }],
    exitRules: opts.exitRules ?? [],
    risk: { sizing: { method: "fixed-quantity", quantity: 1 }, ...opts.risk },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
    ...(opts.pyramiding ? { pyramiding: opts.pyramiding } : {}),
  };
}

export function buildQ15Config(bars: readonly OHLCVBar[], opts: Q15SpecOptions): SimulationConfig {
  return {
    strategySpec: buildQ15Spec(opts),
    instrument: Q15_INSTRUMENT,
    timeframe: Q15_TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "q15-fixture",
    datasetVersion: "v1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: new Map([[indicatorKey(PRICE), bars.map((b) => b.close)]]),
  };
}

/**
 * D2/D3 parity config, deliberately supplying a real but EMPTY
 * `detailProvider` (zero child bars) with `missingDetailPolicy:
 * "FALLBACK_TO_D1"` — every parent bar therefore resolves via the
 * documented, honestly-tracked FALLBACK_TO_D1 path (FidelityQuality
 * reports it, never silent). This exercises the REAL
 * multi-fidelity-engine.ts code path end-to-end (proving the Q1.5
 * duplication into that file behaves identically to simulation-engine.ts),
 * without requiring genuine intrabar detail data these fixtures don't need
 * (conditions are evaluated at parent-bar closes only, by design).
 */
export function buildQ15MultiFidelityConfig(bars: readonly OHLCVBar[], opts: Q15SpecOptions): MultiFidelityConfig {
  return {
    base: buildQ15Config(bars, opts),
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider: createStaticBarDetailProvider([], "M15", "Q15Fixture-Empty"),
    detailTimeframe: "M15",
    missingDetailPolicy: "FALLBACK_TO_D1",
  };
}

/** A SIGNAL_EXIT ExitRule: exits when PRICE crosses below (BUY) / above (SELL) `threshold`. */
export function signalExitRule(direction: "BUY" | "SELL", threshold: number, appliesTo?: "BUY" | "SELL"): ExitRule {
  const condition = direction === "BUY" ? comparison("<", indicatorOperand(PRICE), literal(threshold)) : comparison(">", indicatorOperand(PRICE), literal(threshold));
  return { id: "exit-1", condition, ...(appliesTo !== undefined ? { appliesTo } : {}) };
}
