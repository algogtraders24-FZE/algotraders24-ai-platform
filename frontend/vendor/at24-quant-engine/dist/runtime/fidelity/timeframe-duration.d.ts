import type { Timeframe } from "../../domain/market-data.js";
export declare function timeframeDurationMs(tf: Timeframe): number;
/**
 * Q0.6.5 — a DETERMINISTIC compatibility rule, not a hardcoded whitelist:
 * `child` is a valid detail timeframe for `parent` iff child is strictly
 * shorter AND parent's duration is an EXACT integer multiple of child's
 * (so every parent bar's window aligns cleanly on a child-bar boundary —
 * no fractional/overlapping child bars are ever possible).
 */
export declare function isValidChildTimeframe(parent: Timeframe, child: Timeframe): boolean;
/** The exact number of child bars a fully-covered parent interval must contain. */
export declare function expectedChildCount(parent: Timeframe, child: Timeframe): number;
