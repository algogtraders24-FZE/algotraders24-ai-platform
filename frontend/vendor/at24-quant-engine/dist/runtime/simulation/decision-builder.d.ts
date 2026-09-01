import type { Signal } from "../../domain/signal.js";
import type { Decision } from "../../domain/decision.js";
/**
 * The mechanical glue Q0's own contracts left unspecified: turning a
 * Signal into a Decision (ADR-003 requires them to stay distinct types).
 * This is NOT new strategy-recalculation semantics (Q0.5.29 forbids
 * inventing those) — it is the minimal, deterministic rule needed to
 * drive the orchestrator: a non-FLAT signal with no existing position
 * AND no already-pending order for that instrument becomes an ENTER
 * decision; everything else HOLDs (existing-position management is
 * handled entirely by Q0.3's evaluateRisk() in MANAGEMENT mode, not by
 * this function).
 *
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): added
 * `hasPendingOrder`, defaulting to `false`. Before Q0.11, every entry
 * order was MARKET and always resolved within the SAME bar-processing
 * step before the next signal check could ever run (Step 1 resolves
 * pending orders before Step 4 recomputes the signal) — so
 * `hasOpenPosition` alone was already sufficient to prevent a duplicate
 * entry. A LIMIT/STOP/STOP_LIMIT order (Q0.11) can now remain PENDING
 * for many bars while its condition is still true, which would otherwise
 * create a NEW duplicate pending order on every one of those bars — a
 * genuine, previously-unreachable correctness gap this sprint's own new
 * capability exposed (Q0.11.38's "duplicate fill"/"phantom position"
 * failure modes). Every pre-Q0.11 caller omitting the third argument
 * gets the exact same behavior as before (`hasPendingOrder` defaults
 * `false`), so this is not a behavior change for any all-MARKET strategy
 * — confirmed by the full pre-existing regression suite. See
 * docs/Q0.11_ORDER_SEMANTICS.md.
 */
export declare function buildDecision(signal: Signal, hasOpenPosition: boolean, hasPendingOrder?: boolean): Decision;
