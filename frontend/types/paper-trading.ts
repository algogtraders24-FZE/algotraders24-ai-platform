// types/paper-trading.ts
// Paper Trading Engine, Phase P1 - shared client/server view types. A
// fully isolated, database-only simulation: no real money, no live-account
// connectivity, never touches the real Exness/MT5 account. Named
// `PaperTradingAccount`/`PaperPosition` (not `Order`) to avoid colliding
// with the existing, unrelated, mock-only `types/order.ts#Order` behind
// the "Orders" nav item (marketplace-product purchases).
export type PaperPositionSide = "buy" | "sell";
export type PaperPositionStatus = "open" | "closed";

export interface PaperPositionView {
  id: string;
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
  entryPrice: number;
  marginUsed: number;
  status: PaperPositionStatus;
  /** Present only for a real market close - absent for a position discarded via account reset (never a fabricated exit). */
  exitPrice?: number;
  /** Present only for a real market close (or exactly 0 for a reset-discarded position) - never a guessed number. */
  realizedPnl?: number;
  openedAt: string;
  closedAt?: string;
}

export interface PaperAccountSummary {
  balance: number;
  /** 1:leverage - this simulation's own disclosed parameter, not a claim about any real MT5/broker account default. */
  leverage: number;
  createdAt: string;
  resetAt: string;
  /** Sum of marginUsed across currently open positions. */
  usedMargin: number;
  positions: PaperPositionView[];
}

export interface OpenPositionInput {
  symbol: string;
  side: PaperPositionSide;
  quantity: number;
}
