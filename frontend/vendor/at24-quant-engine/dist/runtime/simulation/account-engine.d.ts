import type { Account } from "../../domain/simulation/account.js";
/**
 * Pure functions, immutable updates only. Equity = balance + unrealizedPnl
 * (Q0.5.22) — settlement is instant in Q0.5 (see docs/Q0.5_POSITION_ACCOUNT.md),
 * so there is no separate "unsettled obligations" term to subtract.
 */
export declare function createAccount(initialBalance: number, asOf: number): Account;
/** Applies a closed/reduced trade's gross P&L and fee to the account balance. */
export declare function applyFill(account: Account, grossPnl: number, fee: number, timestamp: number): Account;
/** Recomputes equity/freeMargin from a fresh unrealized-P&L figure — does not touch balance/realizedPnl/fees. */
export declare function markToMarket(account: Account, unrealizedPnl: number, timestamp: number): Account;
