// services/algo-test/run-golden-backtest.ts
// P3.2A - the minimal end-to-end composition proving:
//   Historical Data -> at24-quant-engine -> Deterministic Backtest -> Result
// This is deliberately NOT a general "runBacktest(request)" API yet (that
// is the P3.2B Pro Algo Test Contract's job, once the UI/routes/Prisma
// models exist) - this sprint's job is only to prove the plumbing works,
// end to end, on real historical XAUUSD M5 data, using the engine's own
// canonical Golden Strategy (never a second strategy).
import {
  runSimulation,
  buildGoldenStrategySpec,
  GOLDEN_STRATEGY_PRICE_INDICATOR,
  indicatorKey,
  ZeroSpread,
  ZeroSlippage,
  ZeroFee,
  ZeroLatency,
  type OHLCVBar,
  type Instrument,
  type Timeframe,
  type SimulationConfig,
  type SimulationResult,
} from "at24-quant-engine";
import type { HistoricalDataProvider } from "./historical-data/types";

export interface GoldenBacktestRequest {
  symbol: string;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  initialBalance: number;
}

export interface GoldenBacktestOutcome {
  result: SimulationResult;
  /** P3.2B - the exact validated bars the engine ran against, so a caller (e.g. the Algo Test API) can render a chart consistent with the actual backtest window without a second provider call. */
  bars: readonly OHLCVBar[];
  barsUsed: number;
  barsRejected: number;
  dataSource: string;
  /**
   * Derived, NOT engine-computed - the real SimulationResult has no
   * equityCurve field (docs/P3.1-QUANT-CHART-CONTRACT.md SS2). This is a
   * pure display-projection of the trade ledger's own final numbers,
   * built the same way Quant Lite's own EquityCurveChart already derives
   * one from ITS trade list - not a second calculation path, since every
   * point is just a running sum of the engine's own realized netPnl.
   */
  equityCurve: readonly { timestamp: number; balance: number }[];
}

export async function runGoldenBacktest(request: GoldenBacktestRequest, provider: HistoricalDataProvider): Promise<GoldenBacktestOutcome> {
  const { bars, rejected, source } = await provider.getBars({
    symbol: request.symbol,
    timeframe: request.timeframe,
    startTime: request.startTime,
    endTime: request.endTime,
  });

  if (bars.length === 0) {
    throw new Error(`runGoldenBacktest: no valid historical bars for ${request.symbol}/${request.timeframe} in [${request.startTime}, ${request.endTime}] (source: ${source}, ${rejected.length} rejected)`);
  }

  const instrument: Instrument = bars[0]!.instrument;
  const indicatorSeries = buildPriceIndicatorSeries(bars);

  const config: SimulationConfig = {
    strategySpec: buildGoldenStrategySpec(),
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
    indicatorSeries,
  };

  const result = runSimulation(bars, config);

  return {
    result,
    bars,
    barsUsed: bars.length,
    barsRejected: rejected.length,
    dataSource: source,
    equityCurve: deriveEquityCurve(result, request.initialBalance),
  };
}

function buildPriceIndicatorSeries(bars: readonly OHLCVBar[]): ReadonlyMap<string, readonly (number | boolean | undefined)[]> {
  return new Map([[indicatorKey(GOLDEN_STRATEGY_PRICE_INDICATOR), bars.map((b) => b.close)]]);
}

/** Running balance after each closed trade, in ledger order - see GoldenBacktestOutcome.equityCurve doc comment. */
function deriveEquityCurve(result: SimulationResult, initialBalance: number): readonly { timestamp: number; balance: number }[] {
  let balance = initialBalance;
  const points: { timestamp: number; balance: number }[] = [{ timestamp: result.tradeLedger[0]?.entryTimestamp ?? 0, balance }];
  for (const trade of result.tradeLedger) {
    balance += trade.netPnl;
    points.push({ timestamp: trade.exitTimestamp, balance });
  }
  return points;
}
