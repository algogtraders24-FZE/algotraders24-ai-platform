import type { Expression } from "../expression.js";
import type { OrderTypeIR } from "./order-ir.js";
import type { PriceReference } from "./price-reference.js";
import type { PositionSizingMethod } from "../risk-specification.js";

export type EntryDirection = "BUY" | "SELL" | "FLAT";

/** Q0.7.24 — when a triggered entry actually submits its order, distinct from WHEN the condition is evaluated (see bar-timing.ts's BarCloseSemantics, which governs the condition-evaluation side). */
export type EntryTiming = "ON_BAR_OPEN" | "ON_BAR_CLOSE" | "INTRABAR" | "NEXT_BAR_OPEN" | "NEXT_BAR_CLOSE";

/**
 * Q0.7.11 — `sizingModel` reuses Q0.2/Q0.3's PositionSizingMethod
 * directly (never redefined). `executionType` is the OrderTypeIR the
 * entry submits as (a market order by default, matching Q0's EntryRule
 * assumption — see docs/Q0.7_TRANSLATION_CONTRACT.md).
 *
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): added
 * `limitPrice`/`stopPrice`, both optional `PriceReference`s — required
 * when `executionType` is `LIMIT`/`STOP` (one of the two) or
 * `STOP_LIMIT` (both), absent for `MARKET`. Never overloads the existing
 * `condition`/`trigger` fields — a LIMIT/STOP order's ENTRY CONDITION
 * (when the strategy decides to place the order) and its PRICE (where
 * the order sits) are deliberately two separate fields, per Q0.11.2's
 * explicit "do not overload a single price field" rule. See
 * docs/Q0.11_ORDER_SEMANTICS.md.
 */
export interface EntryIR {
  readonly id: string;
  readonly direction: EntryDirection;
  readonly condition: Expression;
  readonly trigger?: Expression;
  readonly quantity?: number;
  readonly sizingModel: PositionSizingMethod;
  readonly timing: EntryTiming;
  readonly executionType: OrderTypeIR;
  readonly limitPrice?: PriceReference;
  readonly stopPrice?: PriceReference;
}

/** Q0.7.12 — the KIND of exit; no execution logic lives here (execution is the simulation engine's job, not the IR's — Q0.7.12's explicit instruction). */
export type ExitKindIR = "STOP_LOSS" | "TAKE_PROFIT" | "SIGNAL_EXIT" | "TIME_EXIT" | "SESSION_EXIT" | "RISK_EXIT";

export interface ExitIR {
  readonly id: string;
  readonly kind: ExitKindIR;
  readonly condition?: Expression;
  readonly appliesTo?: "BUY" | "SELL";
}
