/**
 * Q0.6.11/12 — aggregated, run-wide detail-data completeness. Tracked
 * across every parent bar the multi-fidelity engine processed, not just
 * a single-bar snapshot, so a consumer can judge whether a D2/D3 result
 * is trustworthy end-to-end or leaned on partial/missing data for a
 * meaningful fraction of the run.
 */
export interface DetailCoverage {
  readonly totalParents: number;
  readonly completeParents: number;
  readonly partialParents: number;
  readonly missingParents: number;
  /** completeParents / totalParents; 1 when totalParents === 0 (nothing to be incomplete about). */
  readonly completeRatio: number;
}
