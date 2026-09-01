import type { PositionAccountingMode } from "../simulation/position-accounting-mode.js";
export type { PositionAccountingMode };
/**
 * Q0.7.15 — never assumes a platform default (Q0.7.15's explicit
 * instruction). `allowPyramiding: false` with `maxEntries: 1` is the
 * conservative default a translator should emit when the source platform
 * does not make its own pyramiding behavior explicit — but the IR itself
 * never silently picks that default; a translator must set it.
 */
export interface PyramidingPolicy {
    readonly allowPyramiding: boolean;
    readonly maxPositions?: number;
    readonly maxEntries?: number;
    readonly sameDirectionBehavior: "ACCUMULATE" | "REJECT" | "IGNORE";
    readonly oppositeDirectionBehavior: "REVERSAL" | "REJECT" | "IGNORE";
}
/**
 * Q0.7.16 — explicit BUY<->SELL reversal semantics. `PLATFORM_DEFINED`
 * means the source platform's own default governs and the translator
 * has recorded WHICH default via `platformDefaultDescription` (Q0.7.30 —
 * platform defaults are never silently imported, they are named).
 */
export type ReversalBehavior = "CLOSE_THEN_OPEN" | "REVERSE" | "REJECT" | "PLATFORM_DEFINED";
export interface ReversalPolicy {
    readonly buyToSell: ReversalBehavior;
    readonly sellToBuy: ReversalBehavior;
    readonly platformDefaultDescription?: string;
}
