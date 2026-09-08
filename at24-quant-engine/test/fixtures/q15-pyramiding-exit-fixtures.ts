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

// ============================================================================
// Q1.5 VERIFICATION CLOSURE — genuine (non-empty) D2/D3 intrabar fixture.
// Mirrors test/fixtures/fidelity-fixtures.ts's own Fixture-A pattern
// (H1 parent / M15 child), reused here rather than inventing a second
// fidelity fixture style. Proves fills resolve at REAL child-bar open
// prices (not parent opens, not FALLBACK_TO_D1), while SIGNAL_EXIT and
// the entry/pyramid DECISION remain parent-bar-only — exactly as
// docs/Q1.5_EXIT_CONTRACT.md documents, an honest, non-parity-claiming
// fidelity difference, not a bug.
// ============================================================================
const QUARTER_MS = 900_000; // M15

/** Builds one child bar `slot` (0-3) inside parent index `parentIndex`'s (open, close] window, at `childTimeframe`. */
function realChildBar(parentIndex: number, slot: 0 | 1 | 2 | 3, open: number, high: number, low: number, close: number, childTimeframe: Timeframe = "M15"): OHLCVBar {
  const parentCloseTs = BASE_TS + parentIndex * HOUR_MS;
  const timestamp = parentCloseTs - HOUR_MS + (slot + 1) * QUARTER_MS;
  return { timestamp, instrument: Q15_INSTRUMENT, timeframe: childTimeframe, open, high, low, close, volume: 250 };
}

/**
 * Parent bars: P0 entry signal fires; P1/P2 carry REAL child data (fills
 * must resolve at the child's own open, not the parent's); P3 SIGNAL_EXIT
 * fires; P4 is a trailing, deliberately-irrelevant bar used ONLY by the
 * look-ahead test (its own children must never affect P0-P3's outcome).
 */
export const Q15_INTRABAR_PARENT_BARS: readonly OHLCVBar[] = [
  bar(0, 101, 101, 101, 101), // entry signal (PRICE > 100)
  bar(1, 101, 112, 100, 101), // still true at close; real children below resolve the P0 order + decide the pyramid signal
  bar(2, 101, 115, 100, 101), // still true at close; real children below resolve the pyramid order; cap (maxEntries=2) reached this bar's Step 4
  bar(3, 99, 99, 99, 99), // SIGNAL_EXIT (PRICE < 100) fires, parent-bar granularity
  bar(4, 500, 500, 500, 500), // look-ahead bait — see Q15_INTRABAR_CHILD_BARS_WITH_LOOKAHEAD_BAIT
];

/** P1's real children: the P0-created order fills at child(1,0)'s OPEN = 105 (not P1's own open, 101). */
const CHILDREN_P1: readonly OHLCVBar[] = [
  realChildBar(1, 0, 105, 106, 104, 105),
  realChildBar(1, 1, 105, 107, 105, 106),
  realChildBar(1, 2, 106, 107, 105, 106),
  realChildBar(1, 3, 106, 107, 105, 106),
];
/** P2's real children: the P1-decided pyramid order fills at child(2,0)'s OPEN = 110 (not P2's own open, 101). */
const CHILDREN_P2: readonly OHLCVBar[] = [
  realChildBar(2, 0, 110, 111, 109, 110),
  realChildBar(2, 1, 110, 112, 109, 111),
  realChildBar(2, 2, 111, 112, 110, 111),
  realChildBar(2, 3, 111, 112, 110, 111),
];
/** P4's children: a huge, un-derivable price (500) that would corrupt P0-P3's outcome if the provider ever leaked it backward. */
const CHILDREN_P4: readonly OHLCVBar[] = [
  realChildBar(4, 0, 500, 501, 499, 500),
  realChildBar(4, 1, 500, 501, 499, 500),
  realChildBar(4, 2, 500, 501, 499, 500),
  realChildBar(4, 3, 500, 501, 499, 500),
];

export const Q15_INTRABAR_CHILD_BARS: readonly OHLCVBar[] = [...CHILDREN_P1, ...CHILDREN_P2];
export const Q15_INTRABAR_CHILD_BARS_WITH_LOOKAHEAD_BAIT: readonly OHLCVBar[] = [...CHILDREN_P1, ...CHILDREN_P2, ...CHILDREN_P4];

export const Q15_INTRABAR_OPTS: Q15SpecOptions = {
  direction: "BUY",
  exitRules: [signalExitRule("BUY", 100)],
  pyramiding: { allowPyramiding: true, maxEntries: 2, sameDirectionBehavior: "ACCUMULATE", oppositeDirectionBehavior: "REVERSAL" },
};

/** A genuine, non-empty D2/D3 config — `fidelity` selects D2_LOWER_TIMEFRAME or D3_M1; both route through the SAME runFidelityAwareSimulation code path (multi-fidelity-engine.ts). `includeLookaheadBait` appends P4's children to the SAME backing provider array (never removed from `parentBars`, matching FIXTURE_EF's own established look-ahead-proof pattern). */
export function buildQ15IntrabarConfig(fidelity: "D2_LOWER_TIMEFRAME" | "D3_M1", includeLookaheadBait = false): MultiFidelityConfig {
  const childTimeframe: Timeframe = fidelity === "D3_M1" ? "M1" : "M15";
  const children = (includeLookaheadBait ? Q15_INTRABAR_CHILD_BARS_WITH_LOOKAHEAD_BAIT : Q15_INTRABAR_CHILD_BARS).map((c) => ({ ...c, timeframe: childTimeframe }));
  return {
    base: buildQ15Config(Q15_INTRABAR_PARENT_BARS, Q15_INTRABAR_OPTS),
    fidelity,
    detailProvider: createStaticBarDetailProvider(children, childTimeframe, `Q15Fixture-${fidelity}`),
    detailTimeframe: childTimeframe,
    missingDetailPolicy: "FALLBACK_TO_D1",
  };
}
