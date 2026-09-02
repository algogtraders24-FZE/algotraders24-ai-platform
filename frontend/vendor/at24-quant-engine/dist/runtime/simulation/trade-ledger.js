import { computeRealizedR } from "../risk/r-multiple.js";
/**
 * `rMultiple` reuses Q0.3's `computeRealizedR` (r-multiple.ts) — no
 * second R formula (Q0.5.24). It is `null`, never 0/NaN, when the
 * position carries no stopLoss (R is undefined without a risk distance;
 * `computeRealizedR` would throw in that case, so this function checks
 * for a stop first rather than swallowing the throw).
 *
 * Q0.10: R-multiple is computed from `initialStopLoss` (the stop AT ENTRY,
 * never moved) when present, falling back to `stopLoss` for a position
 * that never had management applied to it (or a hand-built Position
 * predating this field). Using the CURRENT `stopLoss` here would make the
 * "risk" shrink or invert the moment breakeven/trailing moves the stop
 * past entry — exactly the outcome those features are DESIGNED to
 * produce — turning a normal winning trade into a thrown error instead of
 * a well-defined (correctly large) R-multiple. See
 * docs/Q0.10_POSITION_MANAGEMENT_AUDIT.md.
 */
export function buildTrade(input) {
    const riskBasisStop = input.position.initialStopLoss ?? input.position.stopLoss;
    const rMultiple = riskBasisStop !== undefined
        ? computeRealizedR(input.position.side, input.position.entryPrice, riskBasisStop, input.exitPrice)
        : null;
    return {
        tradeId: input.tradeId,
        strategyVersion: input.strategyVersion,
        instrument: input.position.instrument,
        side: input.position.side,
        entryPrice: input.position.entryPrice,
        entryTimestamp: input.position.entryTimestamp,
        exitPrice: input.exitPrice,
        exitTimestamp: input.exitTimestamp,
        quantity: input.quantity,
        grossPnl: input.grossPnl,
        fees: input.fees,
        netPnl: input.grossPnl - input.fees,
        rMultiple,
        // P3.3 — copied straight through from the Position already on hand;
        // no new computation, omitted (never fabricated) when the position
        // never carried one.
        ...(input.position.stopLoss !== undefined ? { stopLoss: input.position.stopLoss } : {}),
        ...(input.position.takeProfit !== undefined ? { takeProfit: input.position.takeProfit } : {}),
        ...(input.exitReason !== undefined ? { exitReason: input.exitReason } : {}),
        executionMetadata: {
            fillModel: input.fillModel,
            spreadModel: input.spreadModel,
            slippageModel: input.slippageModel,
            feeModel: input.feeModel,
        },
    };
}
/**
 * Append-only, immutable ledger (Q0.5.23) — no update/remove method
 * exists at all. Every recorded Trade is frozen so any accidental
 * downstream mutation attempt throws rather than silently rewriting
 * history.
 */
export class TradeLedger {
    trades = [];
    record(trade) {
        Object.freeze(trade);
        this.trades.push(trade);
        return trade;
    }
    all() {
        return [...this.trades];
    }
    size() {
        return this.trades.length;
    }
}
