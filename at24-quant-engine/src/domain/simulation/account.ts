/**
 * Q0.5.21/22: `equity = balance + unrealizedPnl`. Settlement is
 * INSTANT in Q0.5 (the "ImmediateSettlementModel" case Q0.4 reserved) —
 * there is no unsettled-obligations deduction; this is a deliberate,
 * documented simplification (docs/Q0.5_POSITION_ACCOUNT.md), not a
 * silent omission. `margin`/`freeMargin` are tracked but always 0/equity
 * respectively in Q0.5, since no MarginModel is wired in yet.
 */
export interface Account {
  readonly balance: number;
  readonly realizedPnl: number;
  readonly fees: number;
  readonly unrealizedPnl: number;
  readonly equity: number;
  readonly margin: number;
  readonly freeMargin: number;
  readonly lastUpdatedTimestamp: number;
}
