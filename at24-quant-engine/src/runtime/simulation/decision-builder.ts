import type { Signal } from "../../domain/signal.js";
import type { Decision } from "../../domain/decision.js";

/**
 * Q1.5.4 — the pyramiding-admission context `buildDecision` needs to
 * decide whether a SECOND (or later) ENTER may be admitted while a
 * position is already open. Deliberately narrow: only what the admission
 * decision itself needs, never a full PyramidingPolicy/Position object
 * (decision-builder.ts must never directly read or mutate a Position —
 * that stays the position-engine's job). `openPositionSide` is `undefined`
 * when flat; a pyramid entry is only ever admitted when the SIGNAL's
 * direction matches the OPEN position's side (opposite-direction handling
 * is a separate, pre-existing reversal mechanism, untouched by this).
 */
export interface PyramidingAdmission {
  readonly allowPyramiding: boolean;
  readonly maxEntries?: number;
  readonly currentEntryCount: number;
  readonly openPositionSide?: "BUY" | "SELL";
}

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
 *
 * Q1.5.4 CONTRACT CHANGE (additive, backward-compatible): added the
 * optional `pyramiding` parameter. Before Q1.5, `hasOpenPosition` alone
 * unconditionally blocked every second ENTER, REGARDLESS of
 * `PyramidingPolicy.allowPyramiding` — this was traced, evidence-based,
 * and confirmed: `increasePosition()` existed in position-engine.ts but
 * was genuinely unreachable from this decision layer (a real,
 * newly-precise finding this sprint corrects; see
 * docs/Q1.5_PYRAMIDING_POLICY.md for the historical audit trail — the
 * prior claim of "unlimited accumulation actually happens" was
 * inaccurate). Every pre-Q1.5 caller omitting the fourth argument gets
 * the exact same HOLD-while-open behavior as before (`pyramiding`
 * defaults to `undefined`, which never admits a pyramid entry) — this is
 * not a behavior change for any non-pyramiding strategy, confirmed by the
 * full pre-existing regression suite.
 */
export function buildDecision(signal: Signal, hasOpenPosition: boolean, hasPendingOrder: boolean = false, pyramiding?: PyramidingAdmission): Decision {
  const isFlatEntry = signal.direction !== "FLAT" && !hasOpenPosition && !hasPendingOrder;
  const isPyramidEntry =
    signal.direction !== "FLAT" &&
    hasOpenPosition &&
    !hasPendingOrder &&
    pyramiding !== undefined &&
    pyramiding.allowPyramiding &&
    pyramiding.openPositionSide === signal.direction &&
    (pyramiding.maxEntries === undefined || pyramiding.currentEntryCount < pyramiding.maxEntries);
  const action = isFlatEntry || isPyramidEntry ? "ENTER" : "HOLD";
  const pyramidCapReached =
    hasOpenPosition &&
    !hasPendingOrder &&
    signal.direction !== "FLAT" &&
    pyramiding !== undefined &&
    pyramiding.allowPyramiding &&
    pyramiding.openPositionSide === signal.direction &&
    pyramiding.maxEntries !== undefined &&
    pyramiding.currentEntryCount >= pyramiding.maxEntries;
  return {
    action,
    signal,
    context: {
      reason:
        action === "ENTER"
          ? isPyramidEntry
            ? `entry rule "${signal.triggeredByRuleId}" fired; pyramiding admitted (entry ${pyramiding!.currentEntryCount + 1}${pyramiding!.maxEntries !== undefined ? ` of ${pyramiding!.maxEntries}` : ""})`
            : `entry rule "${signal.triggeredByRuleId}" fired with no existing position`
          : pyramidCapReached
            ? `pyramiding maxEntries (${pyramiding!.maxEntries}) reached; no new entry evaluated`
            : hasOpenPosition
              ? "position already open for this instrument; no new entry evaluated"
              : hasPendingOrder
                ? "a pending order already exists for this instrument; no new entry evaluated"
                : "no entry rule fired",
      evaluatedConditions: signal.triggeredByRuleId ? [{ ruleId: signal.triggeredByRuleId, result: true }] : [],
    },
    decidedAt: signal.generatedAt,
  };
}
