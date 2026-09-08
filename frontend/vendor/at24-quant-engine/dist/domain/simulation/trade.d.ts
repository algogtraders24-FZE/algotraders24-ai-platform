import type { Instrument } from "../market-data.js";
import type { OrderSide } from "../order-intent.js";
export interface TradeExecutionMetadata {
    readonly fillModel: string;
    readonly spreadModel: string;
    readonly slippageModel: string;
    readonly feeModel: string;
}
/**
 * An immutable, append-only ledger record (Q0.5.23) — never rewritten
 * once created (enforced by TradeLedger.record() freezing it, and by
 * TradeLedger never exposing an update/remove operation at all).
 * `rMultiple` is `null` (not 0/NaN) when the position had no stop-loss,
 * since R is undefined without a risk distance to divide by (Q0.3's
 * `computeRealizedR` throws in that case — this ledger records the
 * absence explicitly rather than swallowing the throw into a fake 0).
 *
 * Named `SimulationTrade`, not `Trade`: Q0's `domain/backtest-result.ts`
 * already reserves the name `Trade` for a thin, never-implemented
 * placeholder shape (`{ position, pnl, rMultiple? }`) as part of the
 * still-contract-only `BacktestResult`. This is the first REAL,
 * populated trade record Q0.5 actually produces — kept a distinct type
 * rather than colliding with or silently repurposing that placeholder.
 *
 * `stopLoss`/`takeProfit` (P3.3): the protective levels active on the
 * position AT THE MOMENT IT CLOSED, copied straight through from the
 * `Position` `buildTrade()` already receives — no new computation, and
 * genuinely absent (never fabricated) for a position that never had a
 * stop/target set. `exitReason` is likewise only ever populated with a
 * reason the engine's own close call site already knows (protective
 * stop/take-profit resolution, a risk-engine forced/partial exit, or an
 * opposite-side order fill reducing/closing the position) — `undefined`
 * is never backfilled with an invented label.
 *
 * `mfeR`/`maeR` (P4.6, docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md): this
 * trade row's own Maximum Favorable/Adverse Excursion, expressed in R
 * (the SAME risk-distance basis — `initialStopLoss` falling back to
 * `stopLoss` — that `rMultiple` above already uses; not a second,
 * divergent risk concept). Deliberately R-multiple only, never a raw
 * price/currency excursion field: MFE/MAE's own locked semantic contract
 * treats price as engine-internal derivation state (`Position.
 * highestPriceSinceEntry`/`lowestPriceSinceEntry`), not a canonical
 * public field. `null` — never a fabricated 0, never a thrown
 * exception — in EITHER of two distinct undefined-R cases: (1) no
 * stop-loss was ever set (mirrors `rMultiple`'s own null-when-no-stop
 * convention exactly), or (2) a stop-loss exists but the computed risk
 * distance is <= 0 (a real, pyramiding-only case where a
 * volume-weighted-average `entryPrice` shift can cross the fixed
 * `initialStopLoss`). IMPORTANT, disclosed limitation: this null-guard is
 * total and non-throwing at the `tryComputeR()` helper boundary
 * (r-multiple.ts) — but it cannot currently be OBSERVED via case (2)
 * through a real `runSimulation()` call, because `rMultiple` above
 * computes the identical underlying risk distance FIRST, unconditionally,
 * in the same `buildTrade()` call, and throws before this guard is ever
 * reached (a real, pre-existing, deliberately out-of-scope-for-P4.6
 * defect this phase's own audit surfaced but did not fix — see
 * `tryComputeR`'s own doc comment for the full explanation). `mfeTimestamp`/
 * `maeTimestamp` record the bar timestamp the extreme occurred on — the
 * finest fidelity this D1/OHLC-only engine actually has; never a
 * manufactured sub-bar/intrabar timestamp implying precision the engine
 * does not possess. Present together with their R value, or absent
 * together — never independently.
 */
export interface SimulationTrade {
    readonly tradeId: string;
    readonly strategyVersion: string;
    readonly instrument: Instrument;
    readonly side: OrderSide;
    readonly entryPrice: number;
    readonly entryTimestamp: number;
    readonly exitPrice: number;
    readonly exitTimestamp: number;
    readonly quantity: number;
    readonly grossPnl: number;
    readonly fees: number;
    readonly netPnl: number;
    readonly rMultiple: number | null;
    readonly stopLoss?: number;
    readonly takeProfit?: number;
    readonly exitReason?: string;
    readonly executionMetadata: TradeExecutionMetadata;
    readonly mfeR: number | null;
    readonly maeR: number | null;
    readonly mfeTimestamp?: number;
    readonly maeTimestamp?: number;
}
