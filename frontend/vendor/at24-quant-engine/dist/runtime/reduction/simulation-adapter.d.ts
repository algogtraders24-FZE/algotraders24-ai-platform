import type { OHLCVBar } from "../../domain/market-data.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { StrategyCompilationResult } from "../../domain/reduction/compilation-result.js";
import type { CompilationSimulationResult } from "../../domain/reduction/compilation-result.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { BarDetailProvider } from "../../domain/fidelity/bar-detail.js";
import type { Timeframe } from "../../domain/market-data.js";
import type { DataFidelityLevel } from "../../domain/data-fidelity.js";
import type { SpreadModel, SlippageModel, FeeModel, LatencyModel } from "../../domain/reality-models.js";
export interface IndicatorSeriesBuildResult {
    readonly series: ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
    readonly atrByIndex?: readonly (number | undefined)[];
    readonly blockingReasons: readonly string[];
    readonly warmupBars: number;
}
/**
 * Q0.9.9/10 — computes every `ir.indicators` entry's series over `bars`
 * using Q0.2's OWN `calculateSeries()`/indicator implementations (the
 * exact same incremental step functions Q0.5's production evaluation
 * path uses) — never a second, parallel indicator math implementation.
 * This is the concrete indicator-parity guarantee: the values fed into
 * `SimulationConfig.indicatorSeries` are computed by the identical code
 * a hand-written `StrategySpec` would use.
 */
export declare function buildIndicatorSeriesFromIR(ir: StrategyIR, bars: readonly OHLCVBar[]): IndicatorSeriesBuildResult;
export interface SimulationAdapterOptions {
    readonly initialBalance: number;
    readonly datasetId: string;
    readonly datasetVersion: string;
    readonly dataFidelity: DataFidelityLevel;
    readonly spreadModel: SpreadModel & {
        readonly name: string;
    };
    readonly slippageModel: SlippageModel & {
        readonly name: string;
    };
    readonly feeModel: FeeModel & {
        readonly name: string;
    };
    readonly latencyModel: LatencyModel & {
        readonly name: string;
    };
    readonly fidelity: SimulationFidelity;
    readonly detailProvider?: BarDetailProvider;
    readonly detailTimeframe?: Timeframe;
    readonly missingDetailPolicy?: "FAIL" | "FALLBACK_TO_D1";
    readonly dayBoundaryOffsetMinutes?: number;
}
/**
 * Q0.9.34-36 — the ONLY function in this package that connects a
 * compiled strategy to Q0.5/Q0.6's simulation engine. Duplicates NONE of
 * their logic (Q0.9.34's explicit rule) — it computes indicator series
 * (above, reusing Q0.2), assembles a `MultiFidelityConfig` (Q0.6's own
 * shape, unmodified), and makes exactly one call to
 * `runMultiFidelitySimulation()` (Q0.6, unmodified — which itself
 * delegates to Q0.5's unmodified `runSimulation()` for `D1_OHLC`, per
 * `docs/Q0.6_MULTI_FIDELITY.md`). Throws explicitly, rather than
 * fabricating a result, if handed a BLOCKED compilation — G01-style
 * strategies must never silently "simulate" a placeholder condition.
 */
export declare function compileToSimulation(compilation: StrategyCompilationResult, bars: readonly OHLCVBar[], options: SimulationAdapterOptions): CompilationSimulationResult;
