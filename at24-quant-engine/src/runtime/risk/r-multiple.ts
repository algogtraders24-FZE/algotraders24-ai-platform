import { computeRiskDistance } from "./geometry.js";

type Direction = "BUY" | "SELL";

/**
 * 1R = the initial risk distance (entry to stop). A price move of one R
 * in the favorable direction returns 1.0; one R against returns -1.0.
 * This is the shared primitive `computeCurrentR`/`computeRealizedR`/
 * `computeTargetR` below all reduce to — kept separate so the "what is R"
 * definition has exactly one implementation.
 */
export function computeRMultiple(riskDistance: number, favorablePriceMove: number): number {
  if (!(riskDistance > 0)) {
    throw new Error(`riskDistance must be > 0 to compute an R-multiple, got ${riskDistance}`);
  }
  return favorablePriceMove / riskDistance;
}

function favorableMove(direction: Direction, entryPrice: number, price: number): number {
  return direction === "BUY" ? price - entryPrice : entryPrice - price;
}

/** R-multiple of the CURRENT price relative to entry and initial stop. */
export function computeCurrentR(direction: Direction, entryPrice: number, stopLoss: number, currentPrice: number): number {
  const riskDistance = computeRiskDistance(direction, entryPrice, stopLoss);
  return computeRMultiple(riskDistance, favorableMove(direction, entryPrice, currentPrice));
}

/** Same formula as computeCurrentR — "realized" vs "current" is a matter of WHEN the caller invokes it (at exit vs. mid-trade), not a different calculation. */
export function computeRealizedR(direction: Direction, entryPrice: number, stopLoss: number, exitPrice: number): number {
  return computeCurrentR(direction, entryPrice, stopLoss, exitPrice);
}

/** R-multiple of the configured take-profit target relative to entry and initial stop. */
export function computeTargetR(direction: Direction, entryPrice: number, stopLoss: number, takeProfit: number): number {
  return computeCurrentR(direction, entryPrice, stopLoss, takeProfit);
}
