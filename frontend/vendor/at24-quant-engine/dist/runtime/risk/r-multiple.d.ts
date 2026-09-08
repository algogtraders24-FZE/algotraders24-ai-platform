type Direction = "BUY" | "SELL";
/**
 * 1R = the initial risk distance (entry to stop). A price move of one R
 * in the favorable direction returns 1.0; one R against returns -1.0.
 * This is the shared primitive `computeCurrentR`/`computeRealizedR`/
 * `computeTargetR` below all reduce to — kept separate so the "what is R"
 * definition has exactly one implementation.
 */
export declare function computeRMultiple(riskDistance: number, favorablePriceMove: number): number;
/** R-multiple of the CURRENT price relative to entry and initial stop. */
export declare function computeCurrentR(direction: Direction, entryPrice: number, stopLoss: number, currentPrice: number): number;
/** Same formula as computeCurrentR — "realized" vs "current" is a matter of WHEN the caller invokes it (at exit vs. mid-trade), not a different calculation. */
export declare function computeRealizedR(direction: Direction, entryPrice: number, stopLoss: number, exitPrice: number): number;
/** R-multiple of the configured take-profit target relative to entry and initial stop. */
export declare function computeTargetR(direction: Direction, entryPrice: number, stopLoss: number, takeProfit: number): number;
/**
 * P4.6 (docs/P4.6-MFE-MAE-EXCURSION-TRACKING.md) — a null-safe variant of
 * `computeCurrentR`, for callers that must never throw on a non-positive
 * risk distance (MFE/MAE excursion tracking, trade-ledger.ts). Reuses
 * the SAME `computeRiskDistance`/`favorableMove`/`computeRMultiple`
 * primitives above — no second formula — it only changes what happens
 * when `riskDistance <= 0`: `null` instead of a thrown exception.
 *
 * The precise, deliberately narrow guarantee: THIS FUNCTION is total and
 * non-throwing for an invalid (non-positive) risk denominator. It does
 * NOT change `computeRealizedR`'s own existing throwing behavior above,
 * and is not called from it — `rMultiple` (trade-ledger.ts's buildTrade())
 * still computes its OWN risk distance independently and can still throw
 * exactly as it always has. Since `computeRiskDistance` depends only on
 * (direction, entryPrice, stopLoss) — never on the price being measured
 * against — `rMultiple`'s risk distance and this function's risk distance
 * are THE SAME underlying quantity for a given trade, computed twice.
 * Whenever a pyramided position's volume-weighted-average `entryPrice`
 * crosses the fixed `initialStopLoss` (a real, separately-tracked,
 * deliberately OUT-OF-SCOPE-for-P4.6 finding — see this phase's own
 * audit), `rMultiple`'s computation — which runs FIRST in buildTrade(),
 * unconditionally, before this function is ever called — throws before
 * this function's own null-safety can be observed end-to-end. This is a
 * known, disclosed, and deliberately un-worked-around coupling: this
 * function's null-safety is provable today only at this boundary (a
 * direct unit test), not through a real `runSimulation()` call, until
 * the separately-deferred `rMultiple` fix lands.
 */
export declare function tryComputeR(direction: Direction, entryPrice: number, stopLoss: number, price: number): number | null;
export {};
