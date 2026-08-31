/**
 * Independent, transparent, recompute-from-scratch reference
 * implementations (Q0.2.21) — used ONLY in tests, never in production
 * code. Deliberately written in a different style from
 * src/indicators/*.ts's incremental state machines (array-slice-and-sum
 * instead of running accumulators) so a transcription bug in one is
 * unlikely to be mirrored in the other.
 */

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function referenceSma(closes: readonly number[], period: number): readonly (number | null)[] {
  return closes.map((_, i) => (i < period - 1 ? null : mean(closes.slice(i - period + 1, i + 1))));
}

export function referenceEma(closes: readonly number[], period: number): readonly (number | null)[] {
  const out: (number | null)[] = [];
  let emaVal: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (emaVal === null) {
      if (i < period - 1) {
        out.push(null);
        continue;
      }
      emaVal = mean(closes.slice(i - period + 1, i + 1));
      out.push(emaVal);
      continue;
    }
    const k = 2 / (period + 1);
    emaVal = closes[i]! * k + emaVal * (1 - k);
    out.push(emaVal);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function referenceRsi(closes: readonly number[], period: number): readonly (number | null)[] {
  const changes = closes.slice(1).map((c, i) => c - closes[i]!);
  const out: (number | null)[] = [null];
  let avgGain: number | null = null;
  let avgLoss: number | null = null;
  for (let i = 0; i < changes.length; i++) {
    const gain = Math.max(changes[i]!, 0);
    const loss = Math.max(-changes[i]!, 0);
    if (avgGain === null || avgLoss === null) {
      if (i < period - 1) {
        out.push(null);
        continue;
      }
      const window = changes.slice(i - period + 1, i + 1);
      avgGain = mean(window.map((c) => Math.max(c, 0)));
      avgLoss = mean(window.map((c) => Math.max(-c, 0)));
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    out.push(rsiFromAverages(avgGain, avgLoss));
  }
  return out;
}

export interface ReferenceHlc {
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export function referenceAtr(bars: readonly ReferenceHlc[], period: number): readonly (number | null)[] {
  const trs = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prevClose = bars[i - 1]!.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prevClose), Math.abs(b.low - prevClose));
  });

  const out: (number | null)[] = [];
  let atrVal: number | null = null;
  for (let i = 0; i < trs.length; i++) {
    if (atrVal === null) {
      if (i < period - 1) {
        out.push(null);
        continue;
      }
      atrVal = mean(trs.slice(i - period + 1, i + 1));
      out.push(atrVal);
      continue;
    }
    atrVal = (atrVal * (period - 1) + trs[i]!) / period;
    out.push(atrVal);
  }
  return out;
}

export interface ReferenceMacdOutput {
  readonly line: number;
  readonly signal: number;
  readonly histogram: number;
}

export function referenceMacd(
  closes: readonly number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): readonly (ReferenceMacdOutput | null)[] {
  const fastEma = referenceEma(closes, fastPeriod);
  const slowEma = referenceEma(closes, slowPeriod);
  const lineFull = closes.map((_, i) => {
    const f = fastEma[i]!;
    const s = slowEma[i]!;
    return f === null || s === null ? null : f - s;
  });

  const definedLine = lineFull.filter((v): v is number => v !== null);
  const signalOverDefined = referenceEma(definedLine, signalPeriod);

  const out: (ReferenceMacdOutput | null)[] = [];
  let definedIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    const line = lineFull[i]!;
    if (line === null) {
      out.push(null);
      continue;
    }
    const signal = signalOverDefined[definedIdx]!;
    definedIdx++;
    out.push(signal === null ? null : { line, signal, histogram: line - signal });
  }
  return out;
}

export interface ReferenceBollingerOutput {
  readonly upper: number;
  readonly middle: number;
  readonly lower: number;
}

export function referenceBollinger(
  closes: readonly number[],
  period: number,
  stdDevMultiplier: number,
): readonly (ReferenceBollingerOutput | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const window = closes.slice(i - period + 1, i + 1);
    const middle = mean(window);
    const variance = mean(window.map((v) => (v - middle) ** 2));
    const stddev = Math.sqrt(variance);
    return { upper: middle + stdDevMultiplier * stddev, middle, lower: middle - stdDevMultiplier * stddev };
  });
}
