import type { Timeframe } from "../../domain/market-data.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { BarDetailProvider } from "../../domain/fidelity/bar-detail.js";
import type { SimulationConfig } from "../simulation/simulation-engine.js";

/**
 * Q0.6.10 — composition, not inheritance: MultiFidelityConfig wraps a
 * plain Q0.5 SimulationConfig (`base`, used verbatim for the D1_OHLC
 * delegation path and as the shared account/risk/strategy configuration
 * for D2/D3) rather than extending it, so there is never ambiguity about
 * which `dataFidelity`-shaped field is authoritative. Lives in
 * runtime/fidelity, not domain/fidelity, because SimulationConfig itself
 * (Q0.5) is a runtime type (it carries function-valued model instances,
 * not pure structural data).
 *
 * `missingDetailPolicy` default is "FAIL": if a D2/D3 run hits a parent
 * bar with no child data at all, it throws INSUFFICIENT_DETAIL_DATA
 * rather than silently degrading. Pass "FALLBACK_TO_D1" to explicitly
 * opt into resolving that one parent bar at parent-bar granularity
 * instead (tracked in the result's FidelityQuality, never silent).
 */
export interface MultiFidelityConfig {
  readonly base: SimulationConfig;
  readonly fidelity: SimulationFidelity;
  readonly detailProvider?: BarDetailProvider;
  readonly detailTimeframe?: Timeframe;
  readonly missingDetailPolicy?: "FAIL" | "FALLBACK_TO_D1";
}
