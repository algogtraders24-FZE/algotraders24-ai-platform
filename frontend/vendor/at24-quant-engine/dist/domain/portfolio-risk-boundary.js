/**
 * Future interfaces only (Q0.3.22) — no portfolio engine is built here.
 * These exist so a future Portfolio Engine is written against a stable
 * seam rather than inventing its own shape ad hoc.
 *
 * Boundary (see docs/Q0.3_RISK_ARCHITECTURE.md for the full rationale):
 *   Trade Risk      — the risk of ONE proposed trade in isolation
 *                      (stop distance, R-multiple). Built in Q0.3.
 *   Position Risk   — the risk of ONE open position over its lifetime
 *                      (breakeven/trailing/partial-close/holding-period).
 *                      Built in Q0.3.
 *   Portfolio Risk  — aggregate risk across ALL open positions/strategies
 *                      (exposure, correlation, drawdown, risk budget).
 *                      NOT built in Q0.3 — only reserved below.
 */
export {};
