// lib/market-data/indicators.ts
// Sprint D2.2 (Phase 7) - a reusable, pure technical-indicator engine over
// normalized OHLC candles. Every function returns `undefined` when there are
// not enough candles to compute the indicator honestly - callers surface that
// as "Insufficient data", NEVER an estimate. No randomness, no fabrication:
// the same candles always yield the same values. Standard definitions:
// Wilder's RSI/ATR, EMA seeded from the first SMA, MACD(12,26,9), Bollinger
// (SMA ± k·population-stddev).
import type { Candle } from "@/types/market-candle";

// Sprint D2.8.15 - named, exported defaults (zero behavior change - these
// were already the inline default parameter values below; naming them
// lets lib/market-data/indicator-requirements.ts document the real
// minimum-candle model by reading these exact numbers back, rather than
// duplicating them as a second, potentially-drifting set of literals).
export const RSI_PERIOD_DEFAULT = 14;
export const ATR_PERIOD_DEFAULT = 14;
export const BOLLINGER_PERIOD_DEFAULT = 20;
export const MACD_FAST_DEFAULT = 12;
export const MACD_SLOW_DEFAULT = 26;
export const MACD_SIGNAL_DEFAULT = 9;

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
export function rsi(values: readonly number[], period = RSI_PERIOD_DEFAULT): number | undefined {
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

/** Wilder's ATR over candles. Needs at least period+1 candles. Takes OhlcCandle (defined below, alongside atrSeries) rather than the full Candle type - this function only ever reads high/low/close, never datetime, so it's satisfied by both this module's own Candle[] callers and the chart engine's separate ChartCandle[] with zero conversion. */
export function atr(candles: readonly OhlcCandle[], period = ATR_PERIOD_DEFAULT): number | undefined {
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
export function macd(values: readonly number[], fast = MACD_FAST_DEFAULT, slow = MACD_SLOW_DEFAULT, signal = MACD_SIGNAL_DEFAULT): MACDResult | undefined {
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

export function bollinger(values: readonly number[], period = BOLLINGER_PERIOD_DEFAULT, k = 2): BollingerResult | undefined {
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

/** The only OHLC fields atrSeries()/stochasticSeries() below genuinely need - deliberately narrower than the full `Candle` type (which also requires `datetime`), so both this module's own `Candle[]` callers AND the chart engine's separate `ChartCandle[]` (types/chart-data.ts - `time: number`, no `datetime`) satisfy it structurally with zero conversion. */
export interface OhlcCandle {
  high: number;
  low: number;
  close: number;
}

/** Wilder's ATR at every index - the exact same true-range/Wilder-smoothing recurrence atr() above uses, collected at each step instead of only the last. */
export function atrSeries(candles: readonly OhlcCandle[], period = ATR_PERIOD_DEFAULT): (number | undefined)[] {
  if (candles.length < period + 1) return candles.map(() => undefined);
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const raw: number[] = [];
  let value = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  raw.push(value);
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
    raw.push(value);
  }
  // trueRanges[period-1] (the seed) corresponds to real candle index `period`
  // (trueRanges itself starts at candle index 1) - so raw[0] aligns to
  // candles[period], and left-padding to candles.length lines the rest up
  // exactly, the same alignment convention every *Series function here uses.
  return alignToLength(raw, candles.length);
}

export const STOCHASTIC_K_PERIOD_DEFAULT = 5;
export const STOCHASTIC_SLOWING_DEFAULT = 3;
export const STOCHASTIC_D_PERIOD_DEFAULT = 3;

export interface StochasticResult {
  k: number;
  d: number;
}

/** A rolling SMA over a series that may have leading `undefined`s (not enough data yet) - the window only advances across DEFINED values, matching every other *Series function's "honest undefined, never fabricated" contract. Used to compose the Stochastic Oscillator's two smoothing passes below without a second/divergent SMA implementation from smaSeries() above (that one assumes no gaps, which rawK here genuinely has). */
function smaOverOptional(values: readonly (number | undefined)[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  const window: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) continue;
    window.push(v);
    sum += v;
    if (window.length > period) sum -= window.shift() as number;
    if (window.length === period) out[i] = sum / period;
  }
  return out;
}

/**
 * MT5's real default Stochastic Oscillator - verified against
 * metatrader5.com/mql5.com this session (see the roadmap doc's own
 * "Research basis"): %K period 5, Slowing 3, %D period 3. This is the
 * "Slow Stochastic" MT5 actually ships by default, not the textbook
 * "Fast Stochastic" many other platforms default to instead - the raw
 * %K (close's position within the kPeriod high/low range) is itself
 * smoothed by `slowing` before becoming the displayed %K line, and %D is
 * that line's own further SMA. Needs real high/low/close (not just
 * closes), so this lives here as its own *Series function rather than
 * composing from the closes-only helpers above.
 */
export function stochasticSeries(
  candles: readonly OhlcCandle[],
  kPeriod = STOCHASTIC_K_PERIOD_DEFAULT,
  slowing = STOCHASTIC_SLOWING_DEFAULT,
  dPeriod = STOCHASTIC_D_PERIOD_DEFAULT,
): (StochasticResult | undefined)[] {
  if (candles.length < kPeriod) return candles.map(() => undefined);

  const rawK: (number | undefined)[] = candles.map((c, i) => {
    if (i < kPeriod - 1) return undefined;
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...window.map((w) => w.high));
    const lowestLow = Math.min(...window.map((w) => w.low));
    const range = highestHigh - lowestLow;
    // A genuinely flat window (no range at all) has no honest position to
    // report - 50 (the real midpoint) is the standard convention every
    // mainstream Stochastic implementation uses here, never a guess.
    return range === 0 ? 50 : ((c.close - lowestLow) / range) * 100;
  });

  const slowedK = smaOverOptional(rawK, slowing);
  const dLine = smaOverOptional(slowedK, dPeriod);

  return candles.map((_, i) => {
    const k = slowedK[i];
    const d = dLine[i];
    return k === undefined || d === undefined ? undefined : { k, d };
  });
}

// ============================================================
// Phase 2 continued (this session) - ADX, CCI, Williams %R. All three
// verified against MT5's real default period this session: 14 for every
// one of them (metatrader5.com - CCI's own ORIGINAL Lambert methodology
// used 20, but MT5 itself defaults to 14, same as RSI/ATR/Williams %R -
// this codebase follows MT5's real default, never the textbook one,
// exactly like Stochastic's 5/3/3 above).
// ============================================================

export const ADX_PERIOD_DEFAULT = 14;
export const CCI_PERIOD_DEFAULT = 14;
export const WILLIAMS_R_PERIOD_DEFAULT = 14;

/** Wilder-smooths a raw (already one-per-transition, e.g. true-range or directional-movement) series: seeded with the simple average of the first `period` values, then the same recurrence atr()/atrSeries() already use. The one shared smoothing primitive adxSeries() below composes three times (TR, +DM, -DM) rather than three near-identical inline copies. */
function wilderSmooth(raw: readonly number[], period: number): number[] {
  if (raw.length < period) return [];
  const out: number[] = [];
  let value = raw.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(value);
  for (let i = period; i < raw.length; i++) {
    value = (value * (period - 1) + raw[i]) / period;
    out.push(value);
  }
  return out;
}

export interface AdxResult {
  adx: number;
  plusDI: number;
  minusDI: number;
}

/**
 * Wilder's ADX (Average Directional Index) at every index. Standard
 * Wilder construction: directional movement (+DM/-DM, from the larger of
 * the up-move/down-move between consecutive highs/lows) and true range
 * are each Wilder-smoothed, combining into +DI/-DI; their normalized
 * difference (DX) is itself Wilder-smoothed into ADX. All three lines
 * are genuinely bounded in [0,100] by construction - never clamped.
 * Needs 2*period candles (one period for the DI smoothing, a second for
 * ADX's own smoothing of DX) before the first real value.
 */
export function adxSeries(candles: readonly OhlcCandle[], period = ADX_PERIOD_DEFAULT): (AdxResult | undefined)[] {
  if (candles.length < period * 2) return candles.map(() => undefined);

  const trueRanges: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trueRanges.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
    const upMove = c.high - prev.high;
    const downMove = prev.low - c.low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smoothedTR = wilderSmooth(trueRanges, period);
  const smoothedPlusDM = wilderSmooth(plusDMs, period);
  const smoothedMinusDM = wilderSmooth(minusDMs, period);

  const plusDIFull = smoothedTR.map((tr, i) => (tr === 0 ? 0 : (100 * smoothedPlusDM[i]) / tr));
  const minusDIFull = smoothedTR.map((tr, i) => (tr === 0 ? 0 : (100 * smoothedMinusDM[i]) / tr));
  const dx = plusDIFull.map((plusDI, i) => {
    const minusDI = minusDIFull[i];
    const sum = plusDI + minusDI;
    return sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum;
  });

  const adxRaw = wilderSmooth(dx, period);
  // adxRaw[i] corresponds to dx[period-1+i], which shares its index with
  // smoothedTR/plusDIFull/minusDIFull (all built from the same
  // trueRanges-derived alignment) - so plusDIFull[period-1+i] is the
  // exact +DI paired with adxRaw[i]. alignToLength below then left-pads
  // to line the whole thing up with the real candles array.
  const raw: AdxResult[] = adxRaw.map((adx, i) => ({
    adx,
    plusDI: plusDIFull[i + period - 1],
    minusDI: minusDIFull[i + period - 1],
  }));
  return alignToLength(raw, candles.length);
}

/** Commodity Channel Index at every index - the standard, unmodified Lambert formula: (typicalPrice - SMA(typicalPrice)) / (0.015 * meanAbsoluteDeviation). Genuinely unbounded (can exceed +-100 in a strong trend) - never clamped to a fixed range. */
export function cciSeries(candles: readonly OhlcCandle[], period = CCI_PERIOD_DEFAULT): (number | undefined)[] {
  if (candles.length < period) return candles.map(() => undefined);
  const typicalPrices = candles.map((c) => (c.high + c.low + c.close) / 3);
  const raw: number[] = [];
  for (let i = period - 1; i < typicalPrices.length; i++) {
    const window = typicalPrices.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const meanDeviation = window.reduce((acc, v) => acc + Math.abs(v - mean), 0) / period;
    // A genuinely flat window (zero mean deviation) has no honest
    // deviation to report - 0 (no signal either way) is the honest
    // reading, never a division-by-zero NaN/Infinity.
    raw.push(meanDeviation === 0 ? 0 : (typicalPrices[i] - mean) / (0.015 * meanDeviation));
  }
  return alignToLength(raw, candles.length);
}

/** Williams' %R at every index - %R = (highestHigh - close) / (highestHigh - lowestLow) * -100, genuinely bounded in [-100, 0] by construction (0 = at the period's high, -100 = at its low). */
export function williamsPercentRSeries(candles: readonly OhlcCandle[], period = WILLIAMS_R_PERIOD_DEFAULT): (number | undefined)[] {
  if (candles.length < period) return candles.map(() => undefined);
  const raw: number[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...window.map((w) => w.high));
    const lowestLow = Math.min(...window.map((w) => w.low));
    const range = highestHigh - lowestLow;
    // A genuinely flat window has no honest position to report - -50
    // (the real midpoint of [-100,0]) is the honest reading, matching
    // stochasticSeries' own flat-window convention (50, the midpoint of
    // its own [0,100] range) rather than a guessed extreme.
    raw.push(range === 0 ? -50 : ((highestHigh - candles[i].close) / range) * -100);
  }
  return alignToLength(raw, candles.length);
}

// ============================================================
// Parabolic SAR (MT5 feature-parity Phase 2, this session) - a genuinely
// different SHAPE from every indicator above: a stateful, recursive
// trend-following construction (Wilder's original), not a sliding-
// window formula. Real MT5 default step/maximum verified this session
// against mql5.com/metatrader5.com.
// ============================================================

export const PARABOLIC_SAR_STEP_DEFAULT = 0.02;
export const PARABOLIC_SAR_MAX_STEP_DEFAULT = 0.2;

export interface ParabolicSarResult {
  value: number;
  trend: "up" | "down";
}

/**
 * Wilder's Parabolic SAR at every index - the standard construction every
 * mainstream platform (MT5 included) implements: a trailing stop-and-
 * reverse level that accelerates toward price as a trend extends. State
 * carried between indices (trend direction, Extreme Point, Acceleration
 * Factor) - genuinely different from every sliding-window indicator
 * above, which is why this needs its own recursive implementation rather
 * than a *Series wrapper around a scalar sibling.
 *
 * Bootstraps its initial trend/SAR from the first two candles (close[1]
 * vs close[0] - the same convention every real-world Parabolic SAR
 * implementation uses, since Wilder's original method has no other
 * honest way to pick a starting trend before any reversal has occurred)
 * - index 0 is honestly undefined (there is no prior candle to derive a
 * SAR from), index 1 is the bootstrap value, and every index from there
 * follows the real recurrence: SAR moves toward the Extreme Point by
 * (Acceleration Factor * distance) each step, is clamped so an uptrend's
 * SAR never rises above the prior two candles' lows (and a downtrend's
 * never falls below their highs), and reverses - resetting AF to `step`
 * and starting a fresh Extreme Point - the instant price crosses it.
 */
export function parabolicSarSeries(
  candles: readonly OhlcCandle[],
  step = PARABOLIC_SAR_STEP_DEFAULT,
  maxStep = PARABOLIC_SAR_MAX_STEP_DEFAULT,
): (ParabolicSarResult | undefined)[] {
  if (candles.length < 2) return candles.map(() => undefined);

  const result: (ParabolicSarResult | undefined)[] = new Array(candles.length).fill(undefined);

  let uptrend = candles[1].close >= candles[0].close;
  let sar = uptrend ? candles[0].low : candles[0].high;
  let ep = uptrend ? candles[1].high : candles[1].low;
  let af = step;
  result[1] = { value: sar, trend: uptrend ? "up" : "down" };

  for (let i = 2; i < candles.length; i++) {
    let nextSar = sar + af * (ep - sar);

    if (uptrend) {
      nextSar = Math.min(nextSar, candles[i - 1].low, candles[i - 2].low);
    } else {
      nextSar = Math.max(nextSar, candles[i - 1].high, candles[i - 2].high);
    }

    let reversed = false;
    if (uptrend && candles[i].low < nextSar) {
      uptrend = false;
      reversed = true;
      nextSar = ep; // SAR jumps to the extreme the just-ended trend reached
      ep = candles[i].low;
      af = step;
    } else if (!uptrend && candles[i].high > nextSar) {
      uptrend = true;
      reversed = true;
      nextSar = ep;
      ep = candles[i].high;
      af = step;
    }

    if (!reversed) {
      if (uptrend && candles[i].high > ep) {
        ep = candles[i].high;
        af = Math.min(af + step, maxStep);
      } else if (!uptrend && candles[i].low < ep) {
        ep = candles[i].low;
        af = Math.min(af + step, maxStep);
      }
    }

    sar = nextSar;
    result[i] = { value: sar, trend: uptrend ? "up" : "down" };
  }

  return result;
}

// ============================================================
// Ichimoku Kinko Hyo (MT5 feature-parity Phase 2, this session) - real MT5
// defaults verified against mql5.com/metatrader5.com: Tenkan-sen 9,
// Kijun-sen 26, Senkou Span B 52. Genuinely different SHAPE from every
// indicator above: two of its five lines (Senkou Span A/B) plot 26 periods
// FORWARD of the candle they're computed from, and one (Chikou Span) plots
// 26 periods BACKWARD - real time-shifted output, not just a new formula.
// ============================================================

export const ICHIMOKU_TENKAN_DEFAULT = 9;
export const ICHIMOKU_KIJUN_DEFAULT = 26;
export const ICHIMOKU_SENKOU_DEFAULT = 52;

/** Ichimoku needs each candle's real timestamp (to compute shifted lines' synthetic times) - the one indicator in this file that can't use the plain OhlcCandle shape. ChartCandle (time: number) and this module's own Candle (via a `time` accessor) both satisfy this with zero conversion. */
export interface OhlcCandleWithTime extends OhlcCandle {
  time: number;
}

export interface IchimokuPoint {
  time: number;
  value: number | undefined;
}

export interface IchimokuResult {
  tenkan: IchimokuPoint[];
  kijun: IchimokuPoint[];
  senkouA: IchimokuPoint[];
  senkouB: IchimokuPoint[];
  chikou: IchimokuPoint[];
}

/** (highest high + lowest low)/2 over the `period` candles ending at `endIndex` - the shared Donchian-midpoint formula Tenkan-sen, Kijun-sen and Senkou Span B all use, just at different periods. Honestly undefined until `period` candles exist. */
function donchianMid(candles: readonly OhlcCandle[], endIndex: number, period: number): number | undefined {
  if (endIndex < period - 1) return undefined;
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    if (candles[i].high > highestHigh) highestHigh = candles[i].high;
    if (candles[i].low < lowestLow) lowestLow = candles[i].low;
  }
  return (highestHigh + lowestLow) / 2;
}

/**
 * Ichimoku Kinko Hyo at every index. Tenkan-sen/Kijun-sen plot at their own
 * candle's real time (no shift). Senkou Span A/B are computed from the
 * CURRENT candle but plotted `kijunPeriod` candles ahead - Chikou Span is
 * the current candle's close plotted `kijunPeriod` candles behind. Shifted
 * targets that land outside the real candles array get a synthetic time
 * extrapolated from the array's own step size (never a fabricated value,
 * only a fabricated TIME to plot an already-real value at) - the chart's
 * existing gapless index-scale extrapolation (fractionalIndexForTime)
 * already renders times beyond the real candle range correctly, so no
 * renderer change is needed to support this.
 */
export function ichimokuSeries(
  candles: readonly OhlcCandleWithTime[],
  tenkanPeriod = ICHIMOKU_TENKAN_DEFAULT,
  kijunPeriod = ICHIMOKU_KIJUN_DEFAULT,
  senkouPeriod = ICHIMOKU_SENKOU_DEFAULT,
): IchimokuResult {
  const n = candles.length;
  if (n === 0) return { tenkan: [], kijun: [], senkouA: [], senkouB: [], chikou: [] };
  const stepMs = n >= 2 ? candles[1].time - candles[0].time : 60_000;

  function timeAtOffset(targetIndex: number): number {
    if (targetIndex >= 0 && targetIndex < n) return candles[targetIndex].time;
    if (targetIndex >= n) return candles[n - 1].time + (targetIndex - (n - 1)) * stepMs;
    return candles[0].time + targetIndex * stepMs;
  }

  const tenkanRaw = candles.map((_, i) => donchianMid(candles, i, tenkanPeriod));
  const kijunRaw = candles.map((_, i) => donchianMid(candles, i, kijunPeriod));
  const senkouBRaw = candles.map((_, i) => donchianMid(candles, i, senkouPeriod));

  const tenkan: IchimokuPoint[] = candles.map((c, i) => ({ time: c.time, value: tenkanRaw[i] }));
  const kijun: IchimokuPoint[] = candles.map((c, i) => ({ time: c.time, value: kijunRaw[i] }));

  const senkouA: IchimokuPoint[] = candles.map((_, i) => {
    const t = tenkanRaw[i];
    const k = kijunRaw[i];
    return { time: timeAtOffset(i + kijunPeriod), value: t !== undefined && k !== undefined ? (t + k) / 2 : undefined };
  });

  const senkouB: IchimokuPoint[] = candles.map((_, i) => ({
    time: timeAtOffset(i + kijunPeriod),
    value: senkouBRaw[i],
  }));

  const chikou: IchimokuPoint[] = candles.map((c, i) => ({
    time: timeAtOffset(i - kijunPeriod),
    value: c.close,
  }));

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// Sprint D2.7.11 - Bill Williams' tools (deferred from Phase 2, requested
// this session). MT5's own real, verified defaults (metatrader5.com/help/
// indicators/bw_indicators - Alligator/Fractals/Awesome Oscillator pages,
// this session):
export const ALLIGATOR_JAW_PERIOD_DEFAULT = 13;
export const ALLIGATOR_JAW_SHIFT_DEFAULT = 8;
export const ALLIGATOR_TEETH_PERIOD_DEFAULT = 8;
export const ALLIGATOR_TEETH_SHIFT_DEFAULT = 5;
export const ALLIGATOR_LIPS_PERIOD_DEFAULT = 5;
export const ALLIGATOR_LIPS_SHIFT_DEFAULT = 3;
export const AO_FAST_PERIOD_DEFAULT = 5;
export const AO_SLOW_PERIOD_DEFAULT = 34;
// Fractals' own real definition (metatrader5.com) needs 2 confirming bars
// on EACH side of the middle bar - a fixed structural constant, not a
// user-tunable "period" the way every other indicator here has one.
const FRACTAL_WING_WIDTH = 2;

export interface AlligatorResult {
  jaw: IchimokuPoint[];
  teeth: IchimokuPoint[];
  lips: IchimokuPoint[];
}

/**
 * Bill Williams' Alligator: three Smoothed Moving Averages (SMMA - the
 * SAME smoothing formula wilderSmooth() above already implements, since
 * Wilder's smoothing and SMMA are the identical construction historically)
 * over median price ((high+low)/2), each shifted a fixed number of bars
 * INTO THE FUTURE - Jaw (13, +8), Teeth (8, +5), Lips (5, +3), MT5's own
 * real verified defaults. Reuses the exact same `timeAtOffset` synthetic-
 * time-extrapolation pattern ichimokuSeries() above already established
 * for its own forward-shifted Senkou spans - the chart's existing gapless
 * index-scale extrapolation (fractionalIndexForTime) already renders
 * times beyond the real candle range correctly, so no renderer change is
 * needed here either.
 */
export function alligatorSeries(candles: readonly OhlcCandleWithTime[]): AlligatorResult {
  const n = candles.length;
  if (n === 0) return { jaw: [], teeth: [], lips: [] };
  const stepMs = n >= 2 ? candles[1].time - candles[0].time : 60_000;

  function timeAtOffset(targetIndex: number): number {
    if (targetIndex >= 0 && targetIndex < n) return candles[targetIndex].time;
    if (targetIndex >= n) return candles[n - 1].time + (targetIndex - (n - 1)) * stepMs;
    return candles[0].time + targetIndex * stepMs;
  }

  const median = candles.map((c) => (c.high + c.low) / 2);

  function smmaLine(period: number, shift: number): IchimokuPoint[] {
    const smoothed = wilderSmooth(median, period); // unaligned tail: smoothed[0] is candle index (period-1)
    return candles.map((_, i) => {
      const smoothedIndex = i - (period - 1);
      const value = smoothedIndex >= 0 && smoothedIndex < smoothed.length ? smoothed[smoothedIndex] : undefined;
      return { time: timeAtOffset(i + shift), value };
    });
  }

  return {
    jaw: smmaLine(ALLIGATOR_JAW_PERIOD_DEFAULT, ALLIGATOR_JAW_SHIFT_DEFAULT),
    teeth: smmaLine(ALLIGATOR_TEETH_PERIOD_DEFAULT, ALLIGATOR_TEETH_SHIFT_DEFAULT),
    lips: smmaLine(ALLIGATOR_LIPS_PERIOD_DEFAULT, ALLIGATOR_LIPS_SHIFT_DEFAULT),
  };
}

/**
 * Bill Williams' Awesome Oscillator: 5-period SMA minus 34-period SMA, both
 * over median price - MT5's own real, fixed formula (metatrader5.com).
 * Honestly undefined until the slower (34-period) average is computable.
 */
export function awesomeOscillatorSeries(candles: readonly OhlcCandle[]): (number | undefined)[] {
  const median = candles.map((c) => (c.high + c.low) / 2);
  const fast = smaSeries(median, AO_FAST_PERIOD_DEFAULT);
  const slow = smaSeries(median, AO_SLOW_PERIOD_DEFAULT);
  return candles.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f !== undefined && s !== undefined ? f - s : undefined;
  });
}

export interface FractalsResult {
  /** The candle's own real `high` at every index where an up-fractal genuinely occurs, undefined everywhere else - never a synthesized offset value. */
  up: (number | undefined)[];
  /** The candle's own real `low` at every index where a down-fractal genuinely occurs. */
  down: (number | undefined)[];
}

/**
 * Bill Williams' Fractals: a 5-bar window where the middle bar's high is
 * STRICTLY the highest of all 5 (up-fractal) or its low is strictly the
 * lowest of all 5 (down-fractal) - MT5's own real definition (metatrader5.com:
 * "the highest HIGH in the middle, and two lower HIGHs on both sides").
 * Deliberately does NOT require the two bars on each side to be
 * monotonically decreasing away from the middle - only that both are
 * individually lower than the middle, matching the real MT5 rule exactly
 * (a stricter monotonic reading would silently reject valid fractals).
 * The first/last 2 candles can never qualify (no room for both wings) -
 * left/right honestly undefined there, never guessed.
 */
export function fractalsSeries(candles: readonly OhlcCandle[]): FractalsResult {
  const n = candles.length;
  const up: (number | undefined)[] = new Array(n).fill(undefined);
  const down: (number | undefined)[] = new Array(n).fill(undefined);
  for (let i = FRACTAL_WING_WIDTH; i < n - FRACTAL_WING_WIDTH; i++) {
    const high = candles[i].high;
    let isUp = true;
    let isDown = true;
    const low = candles[i].low;
    for (let w = 1; w <= FRACTAL_WING_WIDTH; w++) {
      if (candles[i - w].high >= high || candles[i + w].high >= high) isUp = false;
      if (candles[i - w].low <= low || candles[i + w].low <= low) isDown = false;
    }
    if (isUp) up[i] = high;
    if (isDown) down[i] = low;
  }
  return { up, down };
}

// Sprint D2.7.11 (post-completion) - real Key Price Levels (Resistance/
// Support/Pullback), reversing the D2.2 Phase 7 "no invented support/
// resistance" rule with the user's explicit sign-off (2026-08-25 - see
// project_ai_intelligence_data_gaps_investigation memory / the AI
// Intelligence roadmap note). Every value here is a REAL derivation, never
// invented: resistance/support are simply the real recent high/low over a
// real lookback window; pullback is the standard 61.8% ("golden pocket")
// Fibonacci retracement between them - MT5's own real default retracement
// ratio (see FIBONACCI_LEVELS, lib/chart-engine/drawing/types.ts),
// applied to a genuine recent high/low instead of a user-drawn selection.
// Honestly {} when there aren't yet enough candles for a real range -
// never a fabricated level.
export interface RecentPriceRange {
  high: number;
  low: number;
  lookbackBars: number;
}

// Matches services/intelligence/market-state/market-state.service.ts's own
// BREAKOUT_LOOKBACK_BARS/computeRecentRange definition EXACTLY (20 bars,
// excluding the latest/still-forming candle) - the same real "recent
// range" concept, never a second, potentially-drifting definition. Kept
// as its own small pure utility here (rather than importing that file's
// private function) so this addition touches zero already-shipped D2.5.x/
// D2.6.x code - the DecisionContext pipeline's own `currentState.
// recentRange` (already computed there) is structurally identical to this
// function's return shape and can be passed straight into
// keyPriceLevels() below without recomputing anything.
export const RECENT_RANGE_LOOKBACK_BARS_DEFAULT = 20;

export function recentPriceRange(candles: readonly OhlcCandle[], lookbackBars = RECENT_RANGE_LOOKBACK_BARS_DEFAULT): RecentPriceRange | undefined {
  if (candles.length <= lookbackBars) return undefined;
  const window = candles.slice(candles.length - 1 - lookbackBars, candles.length - 1);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  return { high, low, lookbackBars };
}

export interface KeyPriceLevels {
  resistance?: number;
  support?: number;
  pullback?: number;
}

const PULLBACK_RETRACEMENT_RATIO = 0.618;

export function keyPriceLevels(range: RecentPriceRange | undefined): KeyPriceLevels {
  if (!range) return {};
  return {
    resistance: range.high,
    support: range.low,
    pullback: range.high - (range.high - range.low) * PULLBACK_RETRACEMENT_RATIO,
  };
}
