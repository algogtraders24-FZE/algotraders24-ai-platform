import type { Instrument, OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import type { StrategySpec } from "../../src/domain/strategy-spec.js";
import { indicator, indicatorKey } from "../../src/domain/indicator-reference.js";
import { comparison, indicatorOperand, literal } from "../../src/domain/expression.js";
import { ZeroSpread } from "../../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../../src/runtime/simulation/latency-model.js";
import type { SimulationConfig } from "../../src/runtime/simulation/simulation-engine.js";

/**
 * A minimal "PRICE" pseudo-indicator whose series is just each bar's
 * close, supplied via `indicatorSeries` exactly like a real computed
 * indicator would be — this keeps the golden fixture's entry rule
 * (PRICE > 100) simple and independently hand-verifiable without needing
 * a real SMA/EMA warmup period to reason about.
 */
export const PRICE = indicator("PRICE");

export const SIM_INSTRUMENT: Instrument = { symbol: "SIMFIXTURE", assetClass: "other" };
export const SIM_TIMEFRAME: Timeframe = "H1";

const HOUR_MS = 3_600_000;
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

function bar(index: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, open, high, low, close, volume: 1000 };
}

/**
 * The golden end-to-end scenario (Q0.5.43):
 *   bars 0-2: PRICE stays <= 100, no entry.
 *   bar 3: close = 101 -> PRICE > 100 fires the entry rule at bar 3's
 *          close. Stop-loss/take-profit are resolved using THIS bar's
 *          close (101) as the reference entry price — a documented
 *          simplification (docs/Q0.5_EXECUTION_MODEL.md's Known
 *          Limitations): stopLoss = 101-5 = 96, takeProfit target
 *          R-multiple is computed relative to that same reference, not
 *          the eventual fill price.
 *   bar 4: the resulting MARKET order fills at bar 4's OPEN (102) — one
 *          bar after signal generation, per the frozen same-bar-safety
 *          rule. Position opens: entry=102 (actual fill), stopLoss=96,
 *          takeProfit=111 (both carried over from bar 3's order).
 *   bar 5: high=113 reaches the take-profit (111) intrabar; low=97 never
 *          reaches the stop (96) -> clean take-profit exit at 111.
 *          grossPnl = (111-102)*1 = 9. R = (111-102)/(102-96) = 1.5 exactly.
 *          close=98 (<=100) deliberately, so the entry rule does NOT
 *          re-fire on this same bar immediately after the exit — a
 *          longer window with PRICE staying > 100 after an exit would
 *          trigger a legitimate re-entry (exercised separately in
 *          GOLDEN_BARS_WITH_REENTRY below), which would make this
 *          specific scenario's "exactly one trade" expectation no
 *          longer fully specified.
 */
export const GOLDEN_BARS: readonly OHLCVBar[] = [
  bar(0, 95, 95.5, 94.5, 95),
  bar(1, 95, 96.5, 94.5, 96),
  bar(2, 96, 97.5, 95.5, 97),
  bar(3, 97, 101.5, 96.5, 101),
  bar(4, 102, 103, 101.5, 102.5),
  bar(5, 103, 113, 97, 98),
];

/** Extends GOLDEN_BARS with two more bars where PRICE stays > 100, deliberately triggering a legitimate re-entry after the first exit. */
export const GOLDEN_BARS_WITH_REENTRY: readonly OHLCVBar[] = [...GOLDEN_BARS, bar(6, 105, 106, 104, 105), bar(7, 105, 106, 104, 105)];

export function buildGoldenStrategySpec(): StrategySpec {
  return {
    identity: { strategyId: "sim-golden", name: "Simulation Golden Fixture Strategy" },
    version: "1.0.0",
    metadata: { createdAt: BASE_TS },
    instruments: [SIM_INSTRUMENT],
    timeframes: [SIM_TIMEFRAME],
    parameters: [],
    entryRules: [
      {
        id: "entry-price-above-100",
        direction: "BUY",
        condition: comparison(">", indicatorOperand(PRICE), literal(100)),
      },
    ],
    exitRules: [],
    risk: {
      sizing: { method: "fixed-quantity", quantity: 1 },
      stopLoss: { type: "fixed-distance", distance: 5 },
      takeProfit: { type: "risk-multiple", rMultiple: 2 },
    },
    execution: { fillModel: "next-bar-open", costsExplicitlyZero: true },
  };
}

export function buildGoldenIndicatorSeries(bars: readonly OHLCVBar[] = GOLDEN_BARS): ReadonlyMap<string, readonly (number | boolean | undefined)[]> {
  return new Map([[indicatorKey(PRICE), bars.map((b) => b.close)]]);
}

export function buildGoldenConfig(bars: readonly OHLCVBar[] = GOLDEN_BARS): SimulationConfig {
  return {
    strategySpec: buildGoldenStrategySpec(),
    instrument: SIM_INSTRUMENT,
    timeframe: SIM_TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "golden-fixture",
    datasetVersion: "v1",
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: buildGoldenIndicatorSeries(bars),
  };
}
