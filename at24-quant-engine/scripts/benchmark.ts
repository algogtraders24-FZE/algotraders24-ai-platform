/**
 * Q0.2.22 performance baseline. Records timing for the primitives most
 * likely to matter once a real backtest engine is built on top of them.
 * Correctness-first (Q0.2.22): this is a measurement script, not a gate —
 * it does not assert thresholds or fail the build. Run with:
 *   npm run benchmark
 */
import { calculateSeries } from "../src/runtime/indicator-engine.js";
import { sma, ema, rsi, atr, macd, bollinger } from "../src/indicators/index.js";
import { evaluateExpression } from "../src/runtime/expression-evaluator.js";
import { and, comparison, indicatorOperand, literal } from "../src/domain/expression.js";
import { indicator, indicatorKey } from "../src/domain/indicator-reference.js";
import { validateStrategySpec } from "../src/domain/strategy-spec.js";
import { computeCanonicalHash } from "../src/runtime/determinism.js";
import { TimeFrontier } from "../src/runtime/time-frontier.js";
import type { MarketSeries } from "../src/domain/market-series.js";
import type { OHLCVBar } from "../src/domain/market-data.js";
import type { MarketState } from "../src/domain/market-state.js";

const INSTRUMENT = { symbol: "BENCH", assetClass: "other" as const };
const TIMEFRAME = "H1" as const;
const N = 10_000;

function buildBars(n: number): OHLCVBar[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: i * 3_600_000,
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    open: 100 + Math.sin(i / 20) * 5,
    high: 100 + Math.sin(i / 20) * 5 + 1,
    low: 100 + Math.sin(i / 20) * 5 - 1,
    close: 100 + Math.sin(i / 20) * 5 + 0.3,
    volume: 1000,
  }));
}

function time(label: string, fn: () => void): void {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label}: ${ms.toFixed(2)}ms (${((ms / N) * 1000).toFixed(3)}us/op, N=${N})`);
}

const bars = buildBars(N);
const series: MarketSeries = { instrument: INSTRUMENT, timeframe: TIMEFRAME, bars };

console.log(`AT24 Quant Engine — Q0.2 Performance Baseline (N=${N})\n`);

time("SMA(20) calculateSeries", () => calculateSeries(sma, bars, { period: 20 }));
time("EMA(20) calculateSeries", () => calculateSeries(ema, bars, { period: 20 }));
time("RSI(14) calculateSeries", () => calculateSeries(rsi, bars, { period: 14 }));
time("ATR(14) calculateSeries", () => calculateSeries(atr, bars, { period: 14 }));
time("MACD(12,26,9) calculateSeries", () => calculateSeries(macd, bars, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }));
time("Bollinger(20,2) calculateSeries", () => calculateSeries(bollinger, bars, { period: 20, stdDevMultiplier: 2 }));

const emaRef = indicator("EMA", 20);
const rsiRef = indicator("RSI", 14);
const expr = and(
  comparison(">", indicatorOperand(emaRef), literal(100)),
  comparison(">", indicatorOperand(rsiRef), literal(50)),
);
const evalState: MarketState = {
  instrument: INSTRUMENT,
  timeframe: TIMEFRAME,
  asOf: 0,
  bars: [],
  indicatorValues: new Map([[indicatorKey(emaRef), 105], [indicatorKey(rsiRef), 60]]),
};
time("Expression evaluation (AND of 2 comparisons) x N", () => {
  for (let i = 0; i < N; i++) evaluateExpression(expr, evalState);
});

const specModule = import("../test/fixtures.js");
specModule.then((mod) => {
  const spec = mod.buildStrategySpec();
  time("validateStrategySpec x N", () => {
    for (let i = 0; i < N; i++) validateStrategySpec(spec);
  });
  time("computeCanonicalHash(strategySpec) x N", () => {
    for (let i = 0; i < N; i++) computeCanonicalHash(spec);
  });

  const frontier = new TimeFrontier(series);
  time("TimeFrontier.availableBars() at a fixed cursor x N", () => {
    frontier.advanceTo(bars[Math.floor(N / 2)]!.timestamp);
    for (let i = 0; i < N; i++) frontier.availableBars();
  });

  time("MarketSeries iteration (plain for..of) over N bars, x10 passes", () => {
    for (let pass = 0; pass < 10; pass++) {
      let sum = 0;
      for (const bar of series.bars) sum += bar.close;
    }
  });
});
