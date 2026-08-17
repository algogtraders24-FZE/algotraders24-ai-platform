// lib/research/stats.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. Small,
// pure, dependency-free statistical primitives - this codebase has no
// stats library, and pulling one in for a handful of documented formulas
// would be disproportionate. Every function is a standard, named
// textbook formula (cited in its own comment), never a bespoke invention.
// RESEARCH ONLY - nothing here is imported by any production path.

export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Sample standard deviation (Bessel's correction, n-1 denominator) - undefined (never 0) for fewer than 2 values, since a single point has no meaningful spread. */
export function sampleStdDev(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Cohen's d for two independent samples, pooled standard deviation. Standard formula: d = (meanA - meanB) / pooledSD. Undefined when either group has fewer than 2 observations or pooled SD is 0. */
export function cohensD(a: number[], b: number[]): number | undefined {
  if (a.length < 2 || b.length < 2) return undefined;
  const sdA = sampleStdDev(a);
  const sdB = sampleStdDev(b);
  if (sdA === undefined || sdB === undefined) return undefined;
  const pooledVariance = ((a.length - 1) * sdA ** 2 + (b.length - 1) * sdB ** 2) / (a.length + b.length - 2);
  const pooledSD = Math.sqrt(pooledVariance);
  if (pooledSD === 0) return undefined;
  return (mean(a) - mean(b)) / pooledSD;
}

/** Welch's t-test 95% CI on the difference of two independent means (unequal variances assumed) - the standard approach when sample sizes/variances are not known to be equal, which real trading data never guarantees. z=1.96 normal approximation is used for the critical value (adequate once each group's sampleCount clears the MIN_GROUP_SAMPLE gate this research already requires before calling this function). */
export function welchConfidenceInterval95(a: number[], b: number[]): [number, number] | undefined {
  if (a.length < 2 || b.length < 2) return undefined;
  const sdA = sampleStdDev(a);
  const sdB = sampleStdDev(b);
  if (sdA === undefined || sdB === undefined) return undefined;
  const seA = sdA ** 2 / a.length;
  const seB = sdB ** 2 / b.length;
  const se = Math.sqrt(seA + seB);
  if (se === 0) return undefined;
  const diff = mean(a) - mean(b);
  const z = 1.96;
  return [diff - z * se, diff + z * se];
}

/**
 * Deterministic PRNG (mulberry32) - a fixed seed so a bootstrap CI is
 * exactly reproducible across runs, never silently different each time
 * this script executes (a real reproducibility requirement for a research
 * result, not a production security concern - never used for anything
 * security-sensitive).
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap 95% CI on the difference of means between two
 * independent samples - 2000 resamples (a conventional bootstrap
 * iteration count), fixed seed 42 for exact reproducibility. Standard
 * percentile-bootstrap method (Efron & Tibshirani, "An Introduction to the
 * Bootstrap", 1993).
 */
export function bootstrapConfidenceInterval95(a: number[], b: number[], resamples = 2000, seed = 42): [number, number] | undefined {
  if (a.length < 2 || b.length < 2) return undefined;
  const rand = mulberry32(seed);
  const diffs: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const resampleA: number[] = [];
    for (let j = 0; j < a.length; j++) resampleA.push(a[Math.floor(rand() * a.length)]);
    const resampleB: number[] = [];
    for (let j = 0; j < b.length; j++) resampleB.push(b[Math.floor(rand() * b.length)]);
    diffs.push(mean(resampleA) - mean(resampleB));
  }
  diffs.sort((x, y) => x - y);
  const loIdx = Math.floor(0.025 * diffs.length);
  const hiIdx = Math.ceil(0.975 * diffs.length) - 1;
  return [diffs[loIdx], diffs[Math.min(hiIdx, diffs.length - 1)]];
}
