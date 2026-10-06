// services/edge-analyzer/analysis/rng.ts
// AT24 Trader Edge Analyzer (E2) - a tiny seeded PRNG so every statistical
// result is reproducible: the same trades + the same seed always give the same
// numbers (needed for tests, and so a report never "changes its mind" on reload).

/** mulberry32: 32-bit state, uniform [0,1). Not cryptographic - statistics only. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed default seed (the analysis date the feature was specified). */
export const DEFAULT_SEED = 20261007;

export function percentile(sortedAsc: ArrayLike<number>, p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return Number.NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.floor((p / 100) * n)));
  return sortedAsc[idx]!;
}
