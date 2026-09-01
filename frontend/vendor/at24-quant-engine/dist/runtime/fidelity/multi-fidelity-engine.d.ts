import type { OHLCVBar } from "../../domain/market-data.js";
import type { MultiFidelitySimulationResult } from "../../domain/fidelity/fidelity-simulation-result.js";
import type { MultiFidelityConfig } from "./multi-fidelity-config.js";
/**
 * Q0.6's single public entry point. `fidelity: "D1_OHLC"` delegates
 * DIRECTLY to Q0.5's unmodified runSimulation() (docs/Q0.6_MULTI_FIDELITY.md
 * — this is what guarantees Q0.6.31's D1-regression requirement: the
 * underlying trade prices/timestamps/P&L are produced by the EXACT SAME
 * function Q0.5 shipped, byte-for-byte, only the provenance wrapper
 * differs). `"D2_LOWER_TIMEFRAME"`/`"D3_M1"` run the new child-bar-aware
 * engine above.
 */
export declare function runMultiFidelitySimulation(bars: readonly OHLCVBar[], config: MultiFidelityConfig): MultiFidelitySimulationResult;
