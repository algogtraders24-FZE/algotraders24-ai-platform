import type { OHLCVBar, Timeframe } from "../../src/domain/market-data.js";
import { SIM_INSTRUMENT, SIM_TIMEFRAME, buildGoldenStrategySpec, buildGoldenIndicatorSeries } from "./simulation-fixtures.js";
import { ZeroSpread } from "../../src/runtime/simulation/spread-model.js";
import { ZeroSlippage } from "../../src/runtime/simulation/slippage-model.js";
import { ZeroFee } from "../../src/runtime/simulation/fee-model.js";
import { ZeroLatency } from "../../src/runtime/simulation/latency-model.js";
import type { SimulationConfig } from "../../src/runtime/simulation/simulation-engine.js";
import { createStaticBarDetailProvider } from "../../src/runtime/fidelity/static-bar-detail-provider.js";
import type { MultiFidelityConfig } from "../../src/runtime/fidelity/multi-fidelity-config.js";

const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000; // M15
const BASE_TS = Date.parse("2026-01-05T00:00:00Z");

export const CHILD_TIMEFRAME: Timeframe = "M15";

function parentBar(index: number, open: number, high: number, low: number, close: number): OHLCVBar {
  return { timestamp: BASE_TS + index * HOUR_MS, instrument: SIM_INSTRUMENT, timeframe: SIM_TIMEFRAME, open, high, low, close, volume: 1000 };
}

/** Builds one M15 child bar `slot` (0-3) inside parent bar index `parentIndex`'s (open, close] window. */
function childBar(parentIndex: number, slot: 0 | 1 | 2 | 3, open: number, high: number, low: number, close: number): OHLCVBar {
  const parentCloseTs = BASE_TS + parentIndex * HOUR_MS;
  const timestamp = parentCloseTs - HOUR_MS + (slot + 1) * QUARTER_MS; // slot 0 -> parent.open+15m, slot 3 -> +60m == parent close
  return { timestamp, instrument: SIM_INSTRUMENT, timeframe: CHILD_TIMEFRAME, open, high, low, close, volume: 250 };
}

/**
 * FIXTURE A — the D1-ambiguity / D2-resolution proof (Q0.6.13/20/21/22).
 *
 * bars 0-2: PRICE (= close) stays <= 100, no entry.
 * bar 3: close = 101 -> entry signal, exactly as Q0.5's own golden fixture
 *        (stopLoss = 101-5 = 96, takeProfit = 111, both resolved from bar
 *        3's close, matching docs/Q0.5_EXECUTION_MODEL.md's Known Limitation #1).
 * bar 4: the order fills at this bar's open (102) — same as Q0.5. This
 *        bar's own aggregate range (high=113, low=90) makes BOTH the
 *        stop-loss (96) and take-profit (111) reachable within the SAME
 *        parent bar: D1 (whole-bar OHLC) cannot prove which came first
 *        and conservatively resolves to the stop-loss (exitPrice=96,
 *        grossPnl=-6). Its four M15 children prove the take-profit was
 *        actually hit FIRST (child 0's high=113 >= 111, and child 0's
 *        low=101 never reaches 96) — D2 resolves cleanly to a take-profit
 *        exit (exitPrice=111, grossPnl=+9) using nothing but Q0.5's own
 *        resolveProtectiveExit(), applied to child 0 alone.
 */
export const FIXTURE_A_PARENT_BARS: readonly OHLCVBar[] = [
  parentBar(0, 95, 95.5, 94.5, 95),
  parentBar(1, 95, 96.5, 94.5, 96),
  parentBar(2, 96, 97.5, 95.5, 97),
  parentBar(3, 97, 101.5, 96.5, 101),
  parentBar(4, 102, 113, 90, 94),
];

/** Only bar 4 (index 4) has child data — bars 0-3 have no relevant activity, so FALLBACK_TO_D1 harmlessly covers them. */
export const FIXTURE_A_CHILD_BARS: readonly OHLCVBar[] = [
  childBar(4, 0, 102, 113, 101, 110), // take-profit (111) hit here; stop-loss (96) not reached (low=101)
  childBar(4, 1, 110, 111, 108, 109),
  childBar(4, 2, 109, 110, 90, 95), // the stop-level dip happens AFTER the TP already exited the position at child 0
  childBar(4, 3, 95, 96, 93, 94),
];

export function buildFixtureABaseConfig(): SimulationConfig {
  return {
    strategySpec: buildGoldenStrategySpec(),
    instrument: SIM_INSTRUMENT,
    timeframe: SIM_TIMEFRAME,
    initialBalance: 10_000,
    datasetId: "fidelity-fixture-a",
    datasetVersion: "v1",
    dataFidelity: "D2",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: buildGoldenIndicatorSeries(FIXTURE_A_PARENT_BARS),
  };
}

export function buildFixtureAD2Config(): MultiFidelityConfig {
  return {
    base: buildFixtureABaseConfig(),
    fidelity: "D2_LOWER_TIMEFRAME",
    detailProvider: createStaticBarDetailProvider(FIXTURE_A_CHILD_BARS, CHILD_TIMEFRAME, "FixtureA-M15"),
    detailTimeframe: CHILD_TIMEFRAME,
    missingDetailPolicy: "FALLBACK_TO_D1",
  };
}

export function buildFixtureAD1Config(): MultiFidelityConfig {
  return { base: buildFixtureABaseConfig(), fidelity: "D1_OHLC" };
}

/**
 * FIXTURE B — LIMIT order reconstruction across children (Q0.6.17): a
 * BUY LIMIT at 100. Parent bar's own OHLC (open=103, high=104, low=98,
 * close=99) makes a D1 whole-bar resolution fill via "price traded
 * through the limit" at exactly 100. The M15 children show the FIRST
 * child never reaches 100 (low=101) — only the THIRD child actually
 * trades through (low=99) — proving D2 fills at the correct LATER child
 * bar's timestamp, not the parent's.
 */
export const FIXTURE_B_PARENT_BAR: OHLCVBar = parentBar(10, 103, 104, 98, 99);
export const FIXTURE_B_CHILD_BARS: readonly OHLCVBar[] = [
  childBar(10, 0, 103, 104, 101, 102),
  childBar(10, 1, 102, 103, 101, 101.5),
  childBar(10, 2, 101.5, 102, 99, 100), // trades through 100 here (low=99 < 100)
  childBar(10, 3, 100, 100.5, 99.5, 99.8),
];

/**
 * FIXTURE C — STOP gap-through with a MISSING middle child (Q0.6.15/16/18/40):
 * a SELL STOP at 95. Child 0 closes well above the stop; child 1 is
 * MISSING (only 3 of 4 expected children supplied -> PARTIAL coverage);
 * child 2 GAPS straight through the stop (opens at 90, well below 95) ->
 * fills at the worse open price (90), never at the nominal stop (95).
 */
export const FIXTURE_C_PARENT_BAR: OHLCVBar = parentBar(20, 100, 101, 89, 91);
export const FIXTURE_C_CHILD_BARS: readonly OHLCVBar[] = [
  childBar(20, 0, 100, 101, 99, 100),
  // slot 1 deliberately omitted -> PARTIAL coverage (3/4)
  childBar(20, 2, 90, 92, 89, 91), // gap-through: opens at 90, already below the 95 stop
  childBar(20, 3, 91, 91.5, 90.5, 91),
];

/**
 * FIXTURE D — STOP_LIMIT reconstruction (Q0.6.19): a BUY STOP_LIMIT,
 * stop=105, limit=108. Child 0 triggers the stop intrabar (high=106) but
 * cannot prove the limit fill same-child (conservative -> triggeredOnly).
 * Once triggered, a LIMIT order fills immediately on any subsequent bar
 * whose OPEN is at-or-below the limit (Q0.5's own "favorable gap" rule)
 * — so child 1 is deliberately built to open ABOVE the limit and never
 * dip below it (no fill yet), and only child 2 actually trades DOWN
 * through the limit (open above 108, low below 108) -> fills AT the
 * limit (108), PROVING the order continues to be walked as a LIMIT
 * across the REMAINING children of the SAME parent bar (a precision D1
 * cannot offer — D1 would only re-check on the NEXT parent bar).
 */
export const FIXTURE_D_PARENT_BAR: OHLCVBar = parentBar(30, 100, 110, 99, 108.2);
export const FIXTURE_D_CHILD_BARS: readonly OHLCVBar[] = [
  childBar(30, 0, 100, 106, 99, 104), // stop (105) triggers intrabar, limit (108) not provable this child
  childBar(30, 1, 109, 110, 108.5, 109.5), // opens above the limit, low stays above it too -> still no fill
  childBar(30, 2, 109, 110, 107, 108), // trades DOWN through the limit (108) here -> fills at 108
  childBar(30, 3, 108, 108.5, 107.5, 108.2),
];

/**
 * FIXTURE E/F — HTF lookahead protection (Q0.6.23/24): parent bar 40's
 * window, plus children belonging to the NEXT parent (index 41) already
 * present in the SAME backing array the provider holds. A query for
 * parent 40 must never see parent 41's children, and appending parent
 * 41's children must not change parent 40's already-computed result.
 */
export const FIXTURE_EF_PARENT_BAR_40: OHLCVBar = parentBar(40, 100, 102, 98, 101);
export const FIXTURE_EF_PARENT_BAR_41: OHLCVBar = parentBar(41, 101, 103, 100, 102);
export const FIXTURE_EF_CHILDREN_40: readonly OHLCVBar[] = [
  childBar(40, 0, 100, 100.5, 99.5, 100),
  childBar(40, 1, 100, 101, 99.8, 100.5),
  childBar(40, 2, 100.5, 102, 99, 101),
  childBar(40, 3, 101, 101.5, 100.5, 101),
];
export const FIXTURE_EF_CHILDREN_41: readonly OHLCVBar[] = [
  childBar(41, 0, 101, 101.5, 100.5, 101),
  childBar(41, 1, 101, 103, 100.8, 102),
  childBar(41, 2, 102, 102.5, 101.5, 102),
  childBar(41, 3, 102, 102.5, 100, 102),
];
