import type { OHLCVBar } from "../../domain/market-data.js";
import type { SimulationOrder } from "../../domain/simulation/order.js";
import type { SpreadModel, SlippageModel } from "../../domain/reality-models.js";
/**
 * D1/OHLC fidelity only (Q0.5.7) — no tick/bid-ask/depth/liquidity/queue
 * awareness exists here; those are future fidelity tiers per
 * docs/Q0.4_INTRABAR_ENGINE.md. Intrabar policy is CONSERVATIVE only
 * (Q0.5.8): where a bar's OHLC cannot prove which of two reachable levels
 * (e.g. SL and TP) was hit first, this module NEVER assumes the
 * favorable outcome — it either resolves the case it CAN prove (a gap
 * unambiguously past both, or one condition simply not reachable) or
 * defers ("not filled yet") rather than manufacturing a fill.
 */
export interface BarFillOutcome {
    readonly filled: boolean;
    readonly fillPrice?: number;
    /** true only for STOP_LIMIT: the stop condition fired this bar but the limit fill could not be proven — see resolveStopLimitFill. */
    readonly triggeredOnly?: boolean;
    readonly reason: string;
}
/**
 * Q0.5.9 — MARKET order semantics:
 * ELIGIBLE: at the OPEN of the first bar with timestamp strictly after
 *   the order's creationTimestamp (never the same bar the order was
 *   created on — see Q0.5.30's same-bar safety requirement).
 * EXECUTION PRICE: that bar's open, adjusted by the configured
 *   SpreadModel/SlippageModel.
 * GAP BEHAVIOR: a market order accepts whatever the actual next price
 *   is — a gap is not a special case, it IS the fill price; no
 *   "unfavorable gap" concept applies to market orders (that concept is
 *   specific to STOP orders, where a level was supposed to bound the
 *   price — see resolveStopFill).
 * UNAVAILABLE PRICE: if no further bar ever arrives before the
 *   simulation ends, the order is never filled here — the orchestrator
 *   is responsible for finalizing any still-open order at end-of-run
 *   (see docs/Q0.5_SIMULATION_ARCHITECTURE.md).
 */
export declare function resolveMarketFill(order: SimulationOrder, fillBar: OHLCVBar, spreadModel: SpreadModel, slippageModel: SlippageModel): BarFillOutcome;
/**
 * Q0.5.10 — LIMIT order semantics (adopts LEAN's `EquityFillModel`
 * precedent, per docs/Q0.4_ADOPT_IMPROVE_AVOID_INVENT.md): a limit fills
 * only when price STRICTLY trades through the level (bar's low/high
 * exceeds it), not merely touches it — deliberately stricter than Pine's
 * lenient touch-fills-by-default behavior, made AT24's only default
 * rather than an opt-in (Q0.4's explicit "never silently favorable"
 * decision). A "favorable gap" (the bar opens already past the limit, at
 * an even better price) fills at that open price instead of the limit.
 */
export declare function resolveLimitFill(order: SimulationOrder, fillBar: OHLCVBar): BarFillOutcome;
/**
 * Q0.5.11 — STOP order semantics: triggers when the bar's high/low
 * reaches the stop level, executing AT the stop price — UNLESS the bar
 * gapped through it (opened already past the level), in which case it
 * fills at the realistic, WORSE open price (never at the stop price
 * itself) — directly matching LEAN's documented "unfavorable gap" check
 * and Q0.4_BACKTEST_FAILURE_CATALOG.md item 14 ("stop gap-through").
 */
export declare function resolveStopFill(order: SimulationOrder, fillBar: OHLCVBar): BarFillOutcome;
/**
 * Q0.5.12 — STOP_LIMIT semantics: STOP trigger, then LIMIT activation,
 * then LIMIT fill. The conservative rule for the SAME bar the stop
 * triggers on: only an UNAMBIGUOUS gap (the bar's open is simultaneously
 * past the stop AND within the limit — a single known point, no
 * intrabar sequencing assumed) fills immediately. Otherwise, if the stop
 * merely triggers intrabar (high/low reached it, but open didn't prove
 * the limit too), the order becomes `triggeredOnly: true` — the caller
 * transitions it to TRIGGERED and re-evaluates it as a plain LIMIT order
 * (resolveLimitFill) starting the NEXT bar. This never manufactures a
 * same-bar fill the OHLC cannot prove (Q0.5.12's explicit mandate).
 */
export declare function resolveStopLimitFill(order: SimulationOrder, fillBar: OHLCVBar): BarFillOutcome;
export interface ProtectiveExitOutcome {
    readonly exited: boolean;
    readonly exitPrice?: number;
    readonly reason: string;
    /** true when both SL and TP were reachable within the same bar and the conservative policy had to choose. */
    readonly ambiguous?: boolean;
}
/**
 * Q0.5.8/Q0.5.32 — checks an OPEN position's own stopLoss/takeProfit
 * against one bar (exercised every bar a position is open, including the
 * same bar it was just opened on, since entry happens at that bar's open
 * and the rest of the bar's range still applies). A position's stop acts
 * exactly like a STOP order (gap-through fills at the worse open price,
 * never at the stop level — Q0.5.11); its target acts exactly like a
 * LIMIT order (strict trade-through required, favorable gap fills at
 * open — Q0.5.10).
 *
 * THE MANDATORY CASE: if BOTH levels are reachable within the same bar,
 * OHLC alone cannot prove which was hit first. This function NEVER
 * assumes the favorable outcome — it resolves to the stop-loss (the
 * worse outcome for the trader), flags `ambiguous: true` so callers can
 * surface it, and never silently reports a clean take-profit exit in
 * this case.
 */
export declare function resolveProtectiveExit(side: "BUY" | "SELL", stopLoss: number | undefined, takeProfit: number | undefined, bar: OHLCVBar): ProtectiveExitOutcome;
