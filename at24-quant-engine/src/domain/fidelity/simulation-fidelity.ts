/**
 * Q0.6.1 — the multi-fidelity execution ladder. Distinct from, and
 * additive to, Q0.5's `DataFidelityLevel` (domain/data-fidelity.ts, the
 * generic "D0"-"D7" labels frozen in Q0.4). `SimulationFidelity` names
 * are tied directly to a concrete EXECUTION MODEL each level implies —
 * "D1_OHLC" is Q0.5's frozen bar-only resolution, "D2_LOWER_TIMEFRAME" and
 * "D3_M1" are Q0.6's child-bar-walking resolution (docs/Q0.6_MULTI_FIDELITY.md).
 */
export type SimulationFidelity = "D1_OHLC" | "D2_LOWER_TIMEFRAME" | "D3_M1";

/**
 * Reserved (Q0.6.1) — NOT implemented, NOT selectable via MultiFidelityConfig
 * in Q0.6. Declared now so a future sprint extends this union rather than
 * inventing a parallel one. No runtime code in Q0.6 ever produces or accepts
 * one of these values.
 */
export type ReservedSimulationFidelity = "D4_TICK" | "D5_BID_ASK" | "D6_DEPTH" | "D7_MICROSTRUCTURE";
