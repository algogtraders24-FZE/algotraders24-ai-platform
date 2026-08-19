// lib/chart-engine/indicators/compute.ts
// Sprint D2.7.3, Phase 6/7 - the Calculation Layer -> Indicator Data
// boundary. Every numeric computation here delegates to lib/market-data/
// indicators.ts's *Series functions (the SAME formulas TechnicalContext
// Service/MarketStateService already trust) - this file only reshapes
// their output into the renderer-agnostic IndicatorSeries/IndicatorLine
// shape (types.ts). It contains ZERO Canvas/coordinate code and zero
// indicator math of its own.
import type { ChartCandle } from "@/types/chart-data";
import { smaSeries, emaSeries, rsiSeries, bollingerSeries, macdSeries, atrSeries, stochasticSeries, adxSeries, cciSeries, williamsPercentRSeries } from "@/lib/market-data/indicators";
import type { IndicatorConfig, IndicatorSeries, IndicatorPoint, IndicatorLine } from "./types";

/** emaSeries() (lib/market-data/indicators.ts) returns only its computable tail, unaligned - left-pad it to one entry per candle, same honest-undefined convention every other *Series function already returns. */
function alignLeft<T>(raw: readonly T[] | undefined, totalLength: number): (T | undefined)[] {
  if (!raw) return new Array(totalLength).fill(undefined);
  const pad = Math.max(0, totalLength - raw.length);
  return [...new Array(pad).fill(undefined), ...raw];
}

function toPoints(candles: ChartCandle[], values: (number | undefined)[]): IndicatorPoint[] {
  return candles.map((c, i) => ({ time: c.time, value: values[i] }));
}

export function computeIndicatorSeries(candles: ChartCandle[], config: IndicatorConfig): IndicatorSeries {
  const closes = candles.map((c) => c.close);

  switch (config.id) {
    case "sma": {
      const values = smaSeries(closes, config.period);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "price", lines: [line] };
    }
    case "ema": {
      const values = alignLeft(emaSeries(closes, config.period), closes.length);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "price", lines: [line] };
    }
    case "bollinger": {
      const period = config.period;
      const k = config.stdDevMultiplier ?? 2;
      const bands = bollingerSeries(closes, period, k);
      const upper = toPoints(candles, bands.map((b) => b?.upper));
      const middle = toPoints(candles, bands.map((b) => b?.middle));
      const lower = toPoints(candles, bands.map((b) => b?.lower));
      return {
        config,
        panel: "price",
        lines: [
          { name: `${config.key}-upper`, points: upper, color: config.color, style: "band-edge" },
          { name: `${config.key}-middle`, points: middle, color: config.color, style: "line" },
          { name: `${config.key}-lower`, points: lower, color: config.color, style: "band-edge" },
        ],
      };
    }
    case "rsi": {
      const values = rsiSeries(closes, config.period);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "rsi", lines: [line] };
    }
    case "macd": {
      const fast = config.fastPeriod ?? 12;
      const slow = config.slowPeriod ?? 26;
      const signal = config.signalPeriod ?? 9;
      const results = macdSeries(closes, fast, slow, signal);
      const macdLine = toPoints(candles, results.map((r) => r?.macd));
      const signalLine = toPoints(candles, results.map((r) => r?.signal));
      const histogram = toPoints(candles, results.map((r) => r?.histogram));
      return {
        config,
        panel: "macd",
        lines: [
          { name: `${config.key}-macd`, points: macdLine, color: config.color },
          { name: `${config.key}-signal`, points: signalLine, color: "var(--steel)" },
          { name: `${config.key}-histogram`, points: histogram, color: config.color, style: "band-edge" },
        ],
      };
    }
    case "volume": {
      const values = candles.map((c) => c.volume);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "volume", lines: [line] };
    }
    case "atr": {
      const values = atrSeries(candles, config.period);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "atr", lines: [line] };
    }
    case "stochastic": {
      const results = stochasticSeries(candles, config.period, config.slowingPeriod, config.signalPeriod);
      const kLine = toPoints(candles, results.map((r) => r?.k));
      const dLine = toPoints(candles, results.map((r) => r?.d));
      return {
        config,
        panel: "stochastic",
        lines: [
          { name: `${config.key}-k`, points: kLine, color: config.color },
          { name: `${config.key}-d`, points: dLine, color: "var(--steel)" },
        ],
      };
    }
    case "adx": {
      const results = adxSeries(candles, config.period);
      const adxLine = toPoints(candles, results.map((r) => r?.adx));
      const plusDI = toPoints(candles, results.map((r) => r?.plusDI));
      const minusDI = toPoints(candles, results.map((r) => r?.minusDI));
      return {
        config,
        panel: "adx",
        lines: [
          { name: `${config.key}-adx`, points: adxLine, color: config.color },
          { name: `${config.key}-plus-di`, points: plusDI, color: "var(--signal-up)" },
          { name: `${config.key}-minus-di`, points: minusDI, color: "var(--signal-down)" },
        ],
      };
    }
    case "cci": {
      const values = cciSeries(candles, config.period);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "cci", lines: [line] };
    }
    case "williams-r": {
      const values = williamsPercentRSeries(candles, config.period);
      const line: IndicatorLine = { name: config.key, points: toPoints(candles, values), color: config.color };
      return { config, panel: "williams-r", lines: [line] };
    }
  }
}

/** Reads the real value at a given candle index from an already-computed IndicatorSeries - never interpolates, never recomputes. Used by the crosshair readout (Phase 9). */
export function valueAtIndex(series: IndicatorSeries, index: number): (number | undefined)[] {
  return series.lines.map((line) => line.points[index]?.value);
}
