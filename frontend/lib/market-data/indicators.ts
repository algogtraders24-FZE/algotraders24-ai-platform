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
