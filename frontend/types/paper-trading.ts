// types/paper-trading.ts
// Paper Trading Engine, Phase P1/P2. Shared client/server view types. A
// fully isolated, database-only simulation: no real money, no live-account
// connectivity, never touches the real Exness/MT5 account. Named
// `PaperTradingAccount`/`PaperPosition` (not `Order`) to avoid colliding
// with the existing, unrelated, mock-only `types/order.ts#Order` behind
// the "Orders" nav item (marketplace-product purchases).
export type PaperPositionSide = "buy" | "sell";
export type PaperOrderType = "market" | "limit";
/**
 * Phase P2 - "pending" (a limit order waiting for its trigger price) and
 * "cancelled" (a pending order the user withdrew, never filled) join the
 * original "open"/"closed". A position never skips "pending" -> "open"
 * without a real price crossing limitPrice (fillPendingLimitOrders(),
 * paper-trading.service.ts) - never a fabricated fill.
 */
export type PaperPositionStatus = "pending" | "open" | "closed" | "cancelled";
/** Phase P2 - distinguishes a real user-initiated close from the automatic stop-out safety mechanism (checkStopOut()) - never silently identical, so a user can tell their position was force-closed, not something they chose. */
export type PaperCloseReason = "manual" | "stop_out";

export interface PaperPositionView {
  id: string;
  symbol: string;
  side: PaperPositionSide;
  orderType: PaperOrderType;
  quantity: number;
  /** Present only for a limit order (market or pending) - the real trigger price fillPendingLimitOrders() compares live bid/ask against. */
  limitPrice?: number;
  /** Absent only while status="pending" - a limit order that hasn't filled yet genuinely has no real entry price. Never a guessed/estimated one. */
  entryPrice?: number;
  /** Present from the moment of PLACEMENT for both market and limit orders (a limit order's margin is estimated from its own limitPrice, the real MT5 convention - not deferred until fill). */
  marginUsed?: number;
  status: PaperPositionStatus;
  /** Present only for a real market close - absent for a position discarded via account reset or one still open/pending (never a fabricated exit). */
  exitPrice?: number;
  /** Present only for a real market close (or exactly 0 for a reset-discarded position) - never a guessed number. */
  realizedPnl?: number;
  closeReason?: PaperCloseReason;
  openedAt: string;
  /** Phase P2 - when a limit order actually filled (status pending -> open). Absent for a market order (which fills at openedAt) or a still-pending/cancelled one. */
  filledAt?: string;
  closedAt?: string;
}

export interface PaperAccountSummary {
  balance: number;
  /** 1:leverage - this simulation's own disclosed parameter, not a claim about any real MT5/broker account default. */
  leverage: number;
  createdAt: string;
  resetAt: string;
  /** Sum of marginUsed across "open" AND "pending" positions (Phase P2 - a pending limit order reserves margin too, the real MT5 convention). */
  usedMargin: number;
  positions: PaperPositionView[];
}

export interface OpenPositionInput {
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
  /** Defaults to "market" when omitted - Phase P1 callers are unaffected. */
  orderType?: PaperOrderType;
  /** Required, and only meaningful, when orderType is "limit". */
  limitPrice?: number;
}
