import type { Instrument, OHLCVBar, Timeframe } from "../../domain/market-data.js";
import type { StrategySpec } from "../../domain/strategy-spec.js";
import type { SimulationResult } from "../../domain/simulation/simulation-result.js";
import type { DataFidelityLevel } from "../../domain/data-fidelity.js";
import type { SpreadModel, SlippageModel, FeeModel, LatencyModel } from "../../domain/reality-models.js";
import type { PendingOrderManagementPolicy } from "../../domain/pending-order-management-policy.js";
export interface SimulationConfig {
    readonly strategySpec: StrategySpec;
    readonly instrument: Instrument;
    readonly timeframe: Timeframe;
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
    /** Keyed by indicatorKey(), values aligned index-for-index with the `bars` argument to runSimulation(). */
    readonly indicatorSeries: ReadonlyMap<string, readonly (number | boolean | undefined)[]>;
    /** Optional ATR series, aligned with `bars`, for any RiskSpecification rule using atr-multiple DistanceSpecs. */
    readonly atrByIndex?: readonly (number | undefined)[];
    /** UTC offset in minutes for the daily-loss day boundary (Q0.3's computeTradingDayKey); default 0. */
    readonly dayBoundaryOffsetMinutes?: number;
    /**
     * Q0.12.18/22 — a deterministic, declarative schedule of pending-order
     * modifications, applied at the START of the named bar's Step 1
     * (before that bar's own fill/expiration resolution) — never derived
     * from a future bar's data during the run, exactly like `bars` itself
     * is static configuration known before the simulation starts. This is
     * the ONLY mechanism that produces a `MODIFY_*`/`CANCEL`/`REPLACE`
     * outcome; there is no strategy-authored auto-trigger for it in this
     * sprint (deliberately deferred — see docs/Q0.12_ORDER_MODIFICATION.md).
     */
    readonly orderModifications?: readonly {
        readonly atBarIndex: number;
        readonly intent: import("../../domain/simulation/order-modification.js").OrderModificationIntent;
    }[];
    /**
     * Q0.13 — a strategy-compiled `PendingOrderManagementPolicy`
     * (`domain/pending-order-management-policy.ts`), evaluated once per
     * pending order per bar (Step 0.4, below), STRICTLY BEFORE the
     * declarative `orderModifications` schedule above (Step 0.5) — a
     * genuinely different mechanism (policy-CONDITION-driven, evaluated
     * live against each bar) from Step 0.5's fixed, pre-known
     * atBarIndex schedule, the two composing deterministically because
     * both funnel through the SAME `validateOrderModification`/
     * `applyOrderModification` (Q0.12, unmodified either way). Absent —
     * the only value every pre-Q0.13 config has — means zero behavior
     * change (see docs/Q0.13_SIMULATION_BRIDGE.md).
     */
    readonly pendingOrderManagementPolicy?: PendingOrderManagementPolicy;
}
/**
 * Runs a full, deterministic, single-instrument/single-strategy
 * simulation over `bars` (Q0.5.29). Only ON_BAR_CLOSE calculation timing
 * is implemented (Q0's existing generateSignal() semantics) — no new
 * recalculation semantics are invented here, per Q0.5.29's explicit
 * instruction.
 */
export declare function runSimulation(bars: readonly OHLCVBar[], config: SimulationConfig): SimulationResult;
