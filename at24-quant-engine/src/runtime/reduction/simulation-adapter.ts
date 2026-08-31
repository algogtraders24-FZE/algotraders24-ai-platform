import type { OHLCVBar } from "../../domain/market-data.js";
import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { NamedIndicatorFamily } from "../../domain/strategy-ir/indicator-ir.js";
import type { StrategyCompilationResult } from "../../domain/reduction/compilation-result.js";
import type { CompilationSimulationResult } from "../../domain/reduction/compilation-result.js";
import type { SimulationFidelity } from "../../domain/fidelity/simulation-fidelity.js";
import type { BarDetailProvider } from "../../domain/fidelity/bar-detail.js";
import type { Timeframe } from "../../domain/market-data.js";
import type { DataFidelityLevel } from "../../domain/data-fidelity.js";
import type { SpreadModel, SlippageModel, FeeModel, LatencyModel } from "../../domain/reality-models.js";
import { indicator, indicatorKey } from "../../domain/indicator-reference.js";
import { calculateSeries } from "../indicator-engine.js";
import { sma, ema, rsi, atr } from "../../indicators/index.js";
import { runMultiFidelitySimulation } from "../fidelity/multi-fidelity-engine.js";
import { computeSemanticStrategyHash } from "../identity.js";
import { executableRules } from "../../domain/pending-order-management-policy.js";

/**
 * Q0.9.9/10 — only the four SINGLE-output indicator families have a
 * direct `SimulationConfig.indicatorSeries` mapping today (that map is
 * keyed by indicator, one plain numeric series per key — Q0.5's own
 * shape, unmodified). MACD/BOLLINGER_BANDS are multi-output
 * (`{line,signal,histogram}` / `{upper,middle,lower}`) and have no
 * per-field expansion into that shape yet — a strategy using either is
 * BLOCKED at the simulation-adapter boundary (never partially wired),
 * exactly as documented in `docs/Q0.9_SIMULATION_BRIDGE.md`.
 */
const SINGLE_OUTPUT_INDICATOR_DEFS: Partial<Record<NamedIndicatorFamily, typeof sma | typeof ema | typeof rsi | typeof atr>> = { SMA: sma, EMA: ema, RSI: rsi, ATR: atr };

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
export function buildIndicatorSeriesFromIR(ir: StrategyIR, bars: readonly OHLCVBar[]): IndicatorSeriesBuildResult {
  const series = new Map<string, readonly (number | boolean | undefined)[]>();
  const blockingReasons: string[] = [];
  let atrByIndex: readonly (number | undefined)[] | undefined;
  let warmupBars = 0;

  for (const ind of ir.indicators) {
    if (ind.kind !== "named") {
      blockingReasons.push(`generic indicator "${ind.name}" has no executable runtime implementation`);
      continue;
    }
    const def = SINGLE_OUTPUT_INDICATOR_DEFS[ind.family];
    if (!def) {
      blockingReasons.push(`indicator family "${ind.family}" has no single-output runtime mapping (MACD/BOLLINGER_BANDS multi-output expansion is not implemented yet)`);
      continue;
    }
    const period = Number(ind.params[0]);
    if (!Number.isFinite(period) || period <= 0) {
      blockingReasons.push(`indicator "${ind.family}" has an invalid period parameter: ${String(ind.params[0])}`);
      continue;
    }
    const values = calculateSeries(def as typeof sma, bars, { period });
    const key = indicatorKey(indicator(ind.family, ...ind.params));
    series.set(key, values.map((v) => v ?? undefined));
    if (ind.family === "ATR") atrByIndex = values.map((v) => v ?? undefined);
    warmupBars = Math.max(warmupBars, (def as typeof sma).warmup({ period } as never).bars);
  }

  return { series, ...(atrByIndex !== undefined ? { atrByIndex } : {}), blockingReasons, warmupBars };
}

export interface SimulationAdapterOptions {
  readonly initialBalance: number;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly dataFidelity: DataFidelityLevel;
  readonly spreadModel: SpreadModel & { readonly name: string };
  readonly slippageModel: SlippageModel & { readonly name: string };
  readonly feeModel: FeeModel & { readonly name: string };
  readonly latencyModel: LatencyModel & { readonly name: string };
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
export function compileToSimulation(compilation: StrategyCompilationResult, bars: readonly OHLCVBar[], options: SimulationAdapterOptions): CompilationSimulationResult {
  if (!compilation.strategySpec) {
    throw new Error("compileToSimulation: cannot simulate a BLOCKED compilation — the reducer found this strategy cannot be safely represented (see compilation.reductionReport.diagnostics)");
  }
  const spec = compilation.strategySpec;

  const { series, atrByIndex, blockingReasons, warmupBars } = buildIndicatorSeriesFromIR(compilation.ir, bars);
  if (blockingReasons.length > 0) {
    throw new Error(`compileToSimulation: cannot build executable indicator series: ${blockingReasons.join("; ")}`);
  }
  if (bars.length <= warmupBars) {
    throw new Error(`compileToSimulation: insufficient bars for indicator warmup (need > ${warmupBars}, got ${bars.length})`);
  }

  /**
   * Q0.9 warmup fix — Q0.5's frozen `generateSignal()`/`firstMatchingEntryRule()`
   * (`src/runtime/signal-generator.ts`) has NO warmup guard: it calls
   * `evaluateExpression()` starting at bar 0 and THROWS if any referenced
   * indicator value is still `undefined` (in warmup). That file cannot be
   * modified (Q0.5 is frozen), so the adapter slices `bars` and every
   * indicator series/`atrByIndex` by the same offset here, guaranteeing
   * index 0 of every sliced array is the first bar where all indicators
   * used by this strategy are fully warmed up.
   */
  const slicedBars = bars.slice(warmupBars);
  const slicedSeries = new Map<string, readonly (number | boolean | undefined)[]>();
  for (const [key, values] of series) slicedSeries.set(key, values.slice(warmupBars));
  const slicedAtrByIndex = atrByIndex?.slice(warmupBars);

  // Q0.13 — thread the compiled pendingOrderManagement policy through to the
  // engine, pre-filtered to ONLY its executable rules (Q0.13's own "never
  // execute an unresolved rule" gate, applied here at the earliest point a
  // real SimulationConfig is assembled — the runtime evaluator itself also
  // re-checks this defensively, belt-and-braces, but this is the ONE place
  // a non-executable rule is deliberately never even offered to it).
  const executable = spec.pendingOrderManagement ? executableRules(spec.pendingOrderManagement) : [];

  const baseConfig = {
    strategySpec: spec,
    instrument: spec.instruments[0]!,
    timeframe: spec.timeframes[0]!,
    initialBalance: options.initialBalance,
    datasetId: options.datasetId,
    datasetVersion: options.datasetVersion,
    dataFidelity: options.dataFidelity,
    spreadModel: options.spreadModel,
    slippageModel: options.slippageModel,
    feeModel: options.feeModel,
    latencyModel: options.latencyModel,
    indicatorSeries: slicedSeries,
    ...(slicedAtrByIndex !== undefined ? { atrByIndex: slicedAtrByIndex } : {}),
    ...(options.dayBoundaryOffsetMinutes !== undefined ? { dayBoundaryOffsetMinutes: options.dayBoundaryOffsetMinutes } : {}),
    ...(executable.length > 0 ? { pendingOrderManagementPolicy: { rules: executable } } : {}),
  };

  const multiConfig = {
    base: baseConfig,
    fidelity: options.fidelity,
    ...(options.detailProvider !== undefined ? { detailProvider: options.detailProvider } : {}),
    ...(options.detailTimeframe !== undefined ? { detailTimeframe: options.detailTimeframe } : {}),
    ...(options.missingDetailPolicy !== undefined ? { missingDetailPolicy: options.missingDetailPolicy } : {}),
  };

  const result = runMultiFidelitySimulation(slicedBars, multiConfig);

  return {
    compilationHash: compilation.resultHash,
    strategySpecHash: computeSemanticStrategyHash(spec),
    simulationResultHash: result.resultHash,
    fidelity: options.fidelity,
    provenance: result.provenance,
  };
}
