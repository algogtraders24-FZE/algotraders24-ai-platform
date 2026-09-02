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
export {};
