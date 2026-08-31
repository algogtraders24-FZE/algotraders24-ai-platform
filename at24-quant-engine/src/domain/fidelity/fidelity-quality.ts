import type { SimulationFidelity } from "./simulation-fidelity.js";
import type { DetailCoverage } from "./detail-coverage.js";

/**
 * Q0.6.36/37 — the explicit split between DATA DETAIL (how many child
 * bars did we actually have) and EXECUTION REALITY (spread/slippage/fee/
 * latency modeling, which D2/D3 do NOT improve — see
 * docs/Q0.6_D2_D3_EXECUTION.md). Higher `requestedFidelity` does not
 * imply higher realism; it only implies less OHLC-level ambiguity in
 * WHICH price/timestamp resolved a fill or protective exit, bounded by
 * how much detail data was actually available (`detailCoverage`).
 */
export interface FidelityQuality {
  readonly requestedFidelity: SimulationFidelity;
  readonly detailCoverage: DetailCoverage;
  /** Count of protective-exit resolutions where even the finest available child bar still had both SL and TP reachable (ambiguous: true). */
  readonly ambiguousResolutionCount: number;
  /** Count of parent bars resolved at parent-bar (D1-equivalent) granularity because no child detail was available and missingDetailPolicy allowed the fallback. */
  readonly parentsResolvedAtParentGranularity: number;
}
