// lib/market-data/indicators.ts
// Sprint D2.2 (Phase 7) - a reusable, pure technical-indicator engine over
// normalized OHLC candles. Every function returns `undefined` when there are
// not enough candles to compute the indicator honestly - callers surface that
// as "Insufficient data", NEVER an estimate. No randomness, no fabrication:
// the same candles always yield the same values. Standard definitions:
// Wilder's RSI/ATR, EMA seeded from the first SMA, MACD(12,26,9), Bollinger
// (SMA ± k·population-stddev).
import type { Candle } from "@/types/market-candle";

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}
export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}
export interface VolumeMetrics {
  latest?: number;
  averagePeriod?: number;
  /** latest / average — >1 means above-average volume. */
  relative?: number;
}

export function closes(candles: readonly Candle[]): number[] {
  return candles.map((c) => c.close);
}

export function sma(values: readonly number[], period: number): number | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const window = values.slice(values.length - period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** Full EMA series (same length as the tail it can compute), seeded from the first `period` SMA. Exported (Sprint D2.7.3) so the chart indicator-overlay layer reuses this EXACT computation rather than a second EMA implementation - ema() and macd() below already both depend on it. */
export function emaSeries(values: readonly number[], period: number): number[] | undefined {
  if (period <= 0 || values.length < period) return undefined;
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const series: number[] = [seed];
  for (let i = period; i < values.length; i++) {
    const prev = series[series.length - 1];
    series.push(values[i] * k + prev * (1 - k));
  }
  return series;
}

export function ema(values: readonly number[], period: number): number | undefined {
  const series = emaSeries(values, period);
  return series ? series[series.length - 1] : undefined;
}

/** Wilder's RSI. Needs at least period+1 closes. */
export function rsi(values: readonly number[], period = 14): number | undefined {
  if (values.length < period + 1) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Wilder's ATR over candles. Needs at least period+1 candles. */
export function atr(candles: readonly Candle[], period = 14): number | undefined {
  if (candles.length < period + 1) return undefined;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  // Seed with the simple average of the first `period` TRs, then Wilder-smooth.
  let value = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
  }
  return value;
}

/** MACD(fast,slow,signal). Needs at least slow+signal closes for a signal line. */
export function macd(values: readonly number[], fast = 12, slow = 26, signal = 9): MACDResult | undefined {
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  if (!fastSeries || !slowSeries) return undefined;
  // Align the two EMA series to the same (slow-based) tail length.
  const macdLine: number[] = [];
  const offset = fastSeries.length - slowSeries.length;
  for (let i = 0; i < slowSeries.length; i++) {
    macdLine.push(fastSeries[i + offset] - slowSeries[i]);
  }
  const signalSeries = emaSeries(macdLine, signal);
  if (!signalSeries) return undefined;
  const macdValue = macdLine[macdLine.length - 1];
  const signalValue = signalSeries[signalSeries.length - 1];
  return { macd: macdValue, signal: signalValue, histogram: macdValue - signalValue };
}

export function bollinger(values: readonly number[], period = 20, k = 2): BollingerResult | undefined {
  const middle = sma(values, period);
  if (middle === undefined) return undefined;
  const window = values.slice(values.length - period);
  const variance = window.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + k * sd, middle, lower: middle - k * sd };
}

export function volumeMetrics(candles: readonly Candle[], period = 20): VolumeMetrics | undefined {
  const vols = candles.map((c) => c.volume).filter((v): v is number => typeof v === "number");
  if (vols.length === 0) return undefined; // provider supplied no volume - honestly absent
  const latest = vols[vols.length - 1];
  const averagePeriod = sma(vols, Math.min(period, vols.length));
  const relative = averagePeriod && averagePeriod > 0 ? latest / averagePeriod : undefined;
  return { latest, averagePeriod, relative };
}

// ============================================================
// Sprint D2.7.3 - AT24 Native Chart Engine: Production Data Layer,
// Indicators & Professional Chart UX. The chart's indicator OVERLAYS
// (EMA/SMA/Bollinger drawn across the whole visible range) and sub-panels
// (RSI/MACD) need one value PER CANDLE, not just the single latest value
// every function above returns - a genuinely different consumption
// pattern than TechnicalContextService's point-in-time snapshot. Every
// function below computes the identical mathematical definition as its
// scalar sibling above (same Wilder recurrence, same EMA seed-from-SMA,
// same population-stddev Bollinger, same MACD 12/26/9 composition) -
// verified by scripts/validate-native-chart-production.ts asserting
// `xSeries(values, period).at(-1) === x(values, period)` for many real
// input sets - never a second, divergent formula. Every returned array has
// exactly `values.length` entries, honestly `undefined` wherever there
// isn't yet enough data to compute that index - never a fabricated
// leading value.
//
// The scalar functions above are INTENTIONALLY left completely untouched
// (not even reordered) so every existing consumer (TechnicalContextService,
// MarketStateService, the whole D2.5/D2.6 intelligence pipeline) keeps its
// exact existing behavior with zero risk of regression.

/** Left-pads a raw (tail-only) computed series so its length matches `totalLength` - one entry per input value, honestly `undefined` before the indicator was computable. */
function alignToLength<T>(raw: readonly T[] | undefined, totalLength: number): (T | undefined)[] {
  if (!raw) return new Array(totalLength).fill(undefined);
  const pad = Math.max(0, totalLength - raw.length);
  return [...new Array(pad).fill(undefined), ...raw];
}

/** SMA at every index - a single-pass sliding-window sum (the same window-average definition as sma() above, computed incrementally rather than re-summed per index). */
export function smaSeries(values: readonly number[], period: number): (number | undefined)[] {
  if (period <= 0) return values.map(() => undefined);
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) raw.push(sum / period);
  }
  return alignToLength(raw, values.length);
}

/** Wilder's RSI at every index - the exact same recurrence rsi() above uses, collected at each step instead of only the last. */
export function rsiSeries(values: readonly number[], period = 14): (number | undefined)[] {
  if (values.length < period + 1) return values.map(() => undefined);
  const raw: number[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  raw.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    raw.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return alignToLength(raw, values.length);
}

/** Bollinger Bands at every index - the same population-stddev definition bollinger() above uses, evaluated per sliding window. */
export function bollingerSeries(values: readonly number[], period = 20, k = 2): (BollingerResult | undefined)[] {
  if (values.length < period) return values.map(() => undefined);
  const raw: BollingerResult[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const middle = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((acc, v) => acc + (v - middle) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    raw.push({ upper: middle + k * sd, middle, lower: middle - k * sd });
  }
  return alignToLength(raw, values.length);
}

/** MACD at every index - built from emaSeries() exactly as macd() above composes it (fast/slow EMA series, aligned, differenced, signal-smoothed), never a second EMA implementation. */
export function macdSeries(values: readonly number[], fast = 12, slow = 26, signal = 9): (MACDResult | undefined)[] {
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  if (!fastSeries || !slowSeries) return values.map(() => undefined);
  const offset = fastSeries.length - slowSeries.length;
  const macdLine: number[] = slowSeries.map((s, i) => fastSeries[i + offset] - s);
  const signalSeries = emaSeries(macdLine, signal);
  if (!signalSeries) return values.map(() => undefined);
  const macdOffset = macdLine.length - signalSeries.length;
  const raw: MACDResult[] = signalSeries.map((sig, i) => {
    const macdValue = macdLine[i + macdOffset];
    return { macd: macdValue, signal: sig, histogram: macdValue - sig };
  });
  return alignToLength(raw, values.length);
}
