import { computeRiskDistance } from "./geometry.js";
/**
 * 1R = the initial risk distance (entry to stop). A price move of one R
 * in the favorable direction returns 1.0; one R against returns -1.0.
 * This is the shared primitive `computeCurrentR`/`computeRealizedR`/
 * `computeTargetR` below all reduce to — kept separate so the "what is R"
 * definition has exactly one implementation.
 */
export function computeRMultiple(riskDistance, favorablePriceMove) {
    if (!(riskDistance > 0)) {
        throw new Error(`riskDistance must be > 0 to compute an R-multiple, got ${riskDistance}`);
    }
    return favorablePriceMove / riskDistance;
}
function favorableMove(direction, entryPrice, price) {
    return direction === "BUY" ? price - entryPrice : entryPrice - price;
}
/** R-multiple of the CURRENT price relative to entry and initial stop. */
export function computeCurrentR(direction, entryPrice, stopLoss, currentPrice) {
    const riskDistance = computeRiskDistance(direction, entryPrice, stopLoss);
    return computeRMultiple(riskDistance, favorableMove(direction, entryPrice, currentPrice));
}
/** Same formula as computeCurrentR — "realized" vs "current" is a matter of WHEN the caller invokes it (at exit vs. mid-trade), not a different calculation. */
export function computeRealizedR(direction, entryPrice, stopLoss, exitPrice) {
    return computeCurrentR(direction, entryPrice, stopLoss, exitPrice);
}
/** R-multiple of the configured take-profit target relative to entry and initial stop. */
export function computeTargetR(direction, entryPrice, stopLoss, takeProfit) {
    return computeCurrentR(direction, entryPrice, stopLoss, takeProfit);
}
