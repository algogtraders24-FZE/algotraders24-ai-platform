// services/algo-test/run-backtest.ts
// P3.6 - Multi-Strategy Registry + Generic Strategy Contract
// (docs/ALGO_TESTING_PRO_ROADMAP.md section 7).
//
// The generic sibling of run-golden-backtest.ts (P3.2A - kept unchanged,
// still used by the P3.2A/P3.2A.1-era live-verification scripts
// validate-algo-test-foundation.ts / validate-algo-test-production-data.ts,
// which are specifically about the Golden Strategy's own data-provider
// foundation and are out of scope for this phase). This is the function
// algo-test.service.ts actually calls for every registered strategy:
// takes an already-built StrategySpec (produced by the strategy's own
// registry-entry `buildSpec()`) and an already-built indicator series
// (produced by the strategy's own registry-entry `buildIndicatorSeries()`)
// - it never asks which strategy it's running, only executes what it's
// handed. Same runSimulation()/at24-quant-engine composition
// run-golden-backtest.ts already proved, generalized to accept the spec
// and indicator series as inputs instead of hardcoding Golden Strategy's
// own.
import { runSimulation, ZeroSpread, ZeroSlippage, ZeroFee, ZeroLatency, type OHLCVBar, type Instrument, type Timeframe, type SimulationConfig, type SimulationResult, type StrategySpec } from "at24-quant-engine";
import type { HistoricalDataProvider } from "./historical-data/types";

export interface BacktestRequest {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly startTime: string;
  readonly endTime: string;
  readonly initialBalance: number;
  /** Already built by the registry entry's own `buildSpec(validatedParameters)` - never constructed here. */
  readonly strategySpec: StrategySpec;
  /** Already built by the registry entry's own `buildIndicatorSeries(bars)` - the ONE other piece of genuinely per-strategy logic (which indicators this strategy's entry conditions actually reference), same "each entry owns it" contract as `buildSpec`. */
  readonly buildIndicatorSeries: (bars: readonly OHLCVBar[]) => ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
}

export interface BacktestOutcome {
  readonly result: SimulationResult;
  /** P3.2B - the exact validated bars the engine ran against, so a caller (e.g. the Algo Test API) can render a chart consistent with the actual backtest window without a second provider call. */
  readonly bars: readonly OHLCVBar[];
  readonly barsUsed: number;
  readonly barsRejected: number;
  readonly dataSource: string;
  /**
   * Derived, NOT engine-computed - the real SimulationResult has no
   * equityCurve field (docs/P3.1-QUANT-CHART-CONTRACT.md SS2). This is a
   * pure display-projection of the trade ledger's own final numbers -
   * identical derivation to run-golden-backtest.ts's own, not a second
   * calculation path.
   */
  readonly equityCurve: readonly { timestamp: number; balance: number }[];
  /**
   * P3.8 - REAL, not assumed: `runSimulation()` is called a SECOND time
   * with the identical `config`/`bars` (already fetched, no second
   * provider call) and its own `resultHash` is compared to the first
   * run's. `docs/ALGO_TESTING_PRO_ROADMAP.md` section 5 already states
   * "identical inputs -> identical resultHash" as an established
   * invariant proven by unit tests at the engine level (Q0.5.36, P3.5's
   * own determinism tests) - this field proves it again, live, for THIS
   * specific run, not just for the engine in the abstract. `false` here
   * would be a genuine engine-level regression, not an expected outcome.
   */
  readonly reproducible: boolean;
}

export async function runBacktest(request: BacktestRequest, provider: HistoricalDataProvider): Promise<BacktestOutcome> {
  const { bars, rejected, source } = await provider.getBars({
    symbol: request.symbol,
    timeframe: request.timeframe,
    startTime: request.startTime,
    endTime: request.endTime,
  });

  if (bars.length === 0) {
    throw new Error(`runBacktest: no valid historical bars for ${request.symbol}/${request.timeframe} in [${request.startTime}, ${request.endTime}] (source: ${source}, ${rejected.length} rejected)`);
  }

  const instrument: Instrument = bars[0]!.instrument;

  const config: SimulationConfig = {
    strategySpec: request.strategySpec,
    instrument,
    timeframe: request.timeframe,
    initialBalance: request.initialBalance,
    datasetId: `${provider.id}:${request.symbol}:${request.timeframe}`,
    datasetVersion: `${request.startTime}..${request.endTime}`,
    dataFidelity: "D1",
    spreadModel: ZeroSpread,
    slippageModel: ZeroSlippage,
    feeModel: ZeroFee,
    latencyModel: ZeroLatency,
    indicatorSeries: request.buildIndicatorSeries(bars),
  };

  const result = runSimulation(bars, config);
  // P3.8 - the real reproducibility check. Cheap: no network, no second
  // provider call, just a second local computation over the same
  // already-fetched bars/config - config is a plain object, safe to reuse
  // as-is (runSimulation never mutates its input, an existing Q0
  // invariant this call relies on, not re-verifies).
  const secondResult = runSimulation(bars, config);
  const reproducible = secondResult.resultHash === result.resultHash;

  return {
    result,
    bars,
    barsUsed: bars.length,
    barsRejected: rejected.length,
    dataSource: source,
    equityCurve: deriveEquityCurve(result, request.initialBalance),
    reproducible,
  };
}

/** Running balance after each closed trade, in ledger order - identical derivation to run-golden-backtest.ts's own equityCurve doc comment. */
function deriveEquityCurve(result: SimulationResult, initialBalance: number): readonly { timestamp: number; balance: number }[] {
  let balance = initialBalance;
  const points: { timestamp: number; balance: number }[] = [{ timestamp: result.tradeLedger[0]?.entryTimestamp ?? 0, balance }];
  for (const trade of result.tradeLedger) {
    balance += trade.netPnl;
    points.push({ timestamp: trade.exitTimestamp, balance });
  }
  return points;
}
