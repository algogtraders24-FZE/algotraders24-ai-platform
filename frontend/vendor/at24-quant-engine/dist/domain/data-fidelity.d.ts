/**
 * The D0-D7 fidelity ladder frozen in Q0.4 (docs/Q0.4_INTRABAR_ENGINE.md).
 * Q0.5 only ever produces/consumes D1 (OHLC) — every other level is
 * reserved for a future sprint's finer-grained data sources.
 */
export type DataFidelityLevel = "D0" | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";
