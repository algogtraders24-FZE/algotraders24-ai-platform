import { transitionOrder } from "./order-engine.js";
export function applyOrderModification(order, intent, asOf) {
    switch (intent.modificationType) {
        case "CANCEL":
            return { kind: "CANCELLED", order: transitionOrder(order, "CANCELLED", { terminalReason: intent.reason }) };
        case "MODIFY_PRICE": {
            const isLimit = order.orderType === "LIMIT";
            return { kind: "MODIFIED", order: { ...order, ...(isLimit ? { limitPrice: intent.newPrice } : { stopPrice: intent.newPrice }) } };
        }
        case "MODIFY_STOP":
            return { kind: "MODIFIED", order: { ...order, stopPrice: intent.newStopPrice } };
        case "MODIFY_LIMIT":
            return { kind: "MODIFIED", order: { ...order, limitPrice: intent.newLimitPrice } };
        case "MODIFY_EXPIRATION":
            return { kind: "MODIFIED", order: { ...order, expiration: intent.newExpiration } };
        case "REPLACE": {
            const cancelledOrder = transitionOrder(order, "CANCELLED", { terminalReason: `replaced: ${intent.reason}` });
            const newLimitPrice = intent.newLimitPrice ?? order.limitPrice;
            const newStopPrice = intent.newStopPrice ?? order.stopPrice;
            const newExpiration = intent.newExpiration ?? order.expiration;
            const newOrderInput = {
                strategyVersion: order.strategyVersion,
                instrument: order.instrument,
                side: order.side,
                quantity: order.quantity,
                orderType: order.orderType,
                ...(newLimitPrice !== undefined ? { limitPrice: newLimitPrice } : {}),
                ...(newStopPrice !== undefined ? { stopPrice: newStopPrice } : {}),
                ...(order.attachedStopLoss !== undefined ? { attachedStopLoss: order.attachedStopLoss } : {}),
                ...(order.attachedTakeProfit !== undefined ? { attachedTakeProfit: order.attachedTakeProfit } : {}),
                creationTimestamp: asOf,
                ...(newExpiration !== undefined ? { expiration: newExpiration } : {}),
                parentOrderId: order.orderId,
                replacementReason: intent.reason,
            };
            return { kind: "REPLACED", cancelledOrder, newOrderInput };
        }
    }
}
