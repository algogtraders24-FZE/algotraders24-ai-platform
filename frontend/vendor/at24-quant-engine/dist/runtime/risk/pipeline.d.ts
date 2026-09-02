import type { RiskEvaluationInput, RiskEvaluationResult } from "../../domain/risk-evaluation.js";
/**
 * Deterministic pipeline (Q0.3.16) implementing explicit conflict
 * resolution (Q0.3.15) — safety constraints dominate optimization/
 * management constraints, and within each category the order below is
 * the ENTIRE priority rule; nothing is implicit:
 *
 *   ENTRY evaluation (input.proposedEntry set):
 *     1. Input validation (size, geometry, risk distance, max position
 *        size) — ALL such violations are collected together and reported
 *        as one REJECTED result, since they all mean "this trade proposal
 *        is malformed," independent of anything else.
 *     2. Session eligibility
 *     3. Max simultaneous positions
 *     4. Daily loss limit
 *     -> ALLOWED/ALLOW_ENTRY only if every stage above passes.
 *
 *   MANAGEMENT evaluation (input.existingPosition set):
 *     1. Max holding period -> FORCE_EXIT_REQUIRED (highest priority:
 *        overrides any stop/partial-close management action)
 *     2. Breakeven -> MOVE_STOP
 *     3. Trailing stop -> MOVE_STOP (only reached if breakeven did not
 *        trigger this call)
 *     4. Partial close -> PARTIAL_CLOSE (only reached if neither stop
 *        policy triggered)
 *     -> ALLOWED/NO_ACTION if nothing above triggers.
 *
 * REJECTED has three distinct meanings depending on `action.type`:
 *   REJECT_ENTRY          — a proposed entry was blocked.
 *   FORCE_EXIT_REQUIRED   — an open position may no longer remain open.
 *   NO_ACTION (with a *_CONSTRAINT violation) — a management policy could
 *     not be evaluated because required context (e.g. an ATR value) was
 *     missing; the caller must supply it before this position can be
 *     safely managed. This is the only case where REJECTED does not mean
 *     "something in the market/portfolio state failed a rule" — it means
 *     the evaluation itself was under-specified.
 *
 * evaluateRisk() never throws and never mutates any input (Q0.3.17) — it
 * reads `input` and constructs a fresh result object only.
 */
export declare function evaluateRisk(input: RiskEvaluationInput): RiskEvaluationResult;
