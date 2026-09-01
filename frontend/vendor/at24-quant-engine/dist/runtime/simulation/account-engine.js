/**
 * Pure functions, immutable updates only. Equity = balance + unrealizedPnl
 * (Q0.5.22) — settlement is instant in Q0.5 (see docs/Q0.5_POSITION_ACCOUNT.md),
 * so there is no separate "unsettled obligations" term to subtract.
 */
export function createAccount(initialBalance, asOf) {
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
        throw new Error(`createAccount: initialBalance must be a finite number >= 0, got ${initialBalance}`);
    }
    return {
        balance: initialBalance,
        realizedPnl: 0,
        fees: 0,
        unrealizedPnl: 0,
        equity: initialBalance,
        margin: 0,
        freeMargin: initialBalance,
        lastUpdatedTimestamp: asOf,
    };
}
/** Applies a closed/reduced trade's gross P&L and fee to the account balance. */
export function applyFill(account, grossPnl, fee, timestamp) {
    const newBalance = account.balance + grossPnl - fee;
    const equity = newBalance + account.unrealizedPnl;
    return {
        ...account,
        balance: newBalance,
        realizedPnl: account.realizedPnl + grossPnl,
        fees: account.fees + fee,
        equity,
        freeMargin: equity - account.margin,
        lastUpdatedTimestamp: timestamp,
    };
}
/** Recomputes equity/freeMargin from a fresh unrealized-P&L figure — does not touch balance/realizedPnl/fees. */
export function markToMarket(account, unrealizedPnl, timestamp) {
    const equity = account.balance + unrealizedPnl;
    return {
        ...account,
        unrealizedPnl,
        equity,
        freeMargin: equity - account.margin,
        lastUpdatedTimestamp: timestamp,
    };
}
