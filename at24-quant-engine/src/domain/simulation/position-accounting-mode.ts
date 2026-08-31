/**
 * Q0.5.19: NETTING is the only implemented mode this sprint (see
 * docs/Q0.5_POSITION_ACCOUNT.md for the rationale). HEDGING remains a
 * reserved value so the type itself doesn't have to change when a future
 * sprint implements it.
 */
export type PositionAccountingMode = "NETTING" | "HEDGING";
