export function openPosition(input) {
    if (!(input.quantity > 0))
        throw new Error(`openPosition: quantity must be > 0, got ${input.quantity}`);
    return {
        id: input.id,
        originatingOrderIntentId: input.originatingOrderIntentId,
        instrument: input.instrument,
        side: input.side,
        quantity: input.quantity,
        entryPrice: input.entryPrice,
        entryTimestamp: input.entryTimestamp,
        ...(input.stopLoss !== undefined ? { stopLoss: input.stopLoss, initialStopLoss: input.stopLoss } : {}),
        ...(input.takeProfit !== undefined ? { takeProfit: input.takeProfit } : {}),
        status: "OPEN",
        fees: input.fee,
        lastModifiedTimestamp: input.entryTimestamp,
    };
}
/** Scale-in: adds quantity at a new price, recomputing the volume-weighted average entry price. */
export function increasePosition(position, addQuantity, addPrice, timestamp, fee) {
    if (position.status !== "OPEN")
        throw new Error(`increasePosition: position ${position.id} is not OPEN`);
    if (!(addQuantity > 0))
        throw new Error(`increasePosition: addQuantity must be > 0, got ${addQuantity}`);
    const totalQuantity = position.quantity + addQuantity;
    const newAvgPrice = (position.entryPrice * position.quantity + addPrice * addQuantity) / totalQuantity;
    return {
        ...position,
        quantity: totalQuantity,
        entryPrice: newAvgPrice,
        fees: (position.fees ?? 0) + fee,
        lastModifiedTimestamp: timestamp,
    };
}
/** Scale-out / partial close. Validates 0 < reduceQuantity <= current quantity (Q0.5.20). */
export function reducePosition(position, reduceQuantity, exitPrice, timestamp, fee) {
    if (position.status !== "OPEN")
        throw new Error(`reducePosition: position ${position.id} is not OPEN`);
    if (!(reduceQuantity > 0))
        throw new Error(`reducePosition: reduceQuantity must be > 0, got ${reduceQuantity}`);
    if (reduceQuantity > position.quantity) {
        throw new Error(`reducePosition: reduceQuantity (${reduceQuantity}) exceeds position quantity (${position.quantity})`);
    }
    const direction = position.side === "BUY" ? 1 : -1;
    const grossPnl = direction * (exitPrice - position.entryPrice) * reduceQuantity;
    const remaining = position.quantity - reduceQuantity;
    const accumulatedFees = (position.fees ?? 0) + fee;
    const accumulatedRealized = (position.realizedPnl ?? 0) + grossPnl;
    if (remaining === 0) {
        return {
            position: {
                ...position,
                quantity: 0,
                status: "CLOSED",
                exitPrice,
                exitTimestamp: timestamp,
                realizedPnl: accumulatedRealized,
                fees: accumulatedFees,
                lastModifiedTimestamp: timestamp,
            },
            grossPnl,
        };
    }
    return {
        position: {
            ...position,
            quantity: remaining,
            realizedPnl: accumulatedRealized,
            fees: accumulatedFees,
            lastModifiedTimestamp: timestamp,
        },
        grossPnl,
    };
}
export function closePosition(position, exitPrice, timestamp, fee) {
    return reducePosition(position, position.quantity, exitPrice, timestamp, fee);
}
export function computeUnrealizedPnl(position, currentPrice) {
    if (position.status !== "OPEN")
        return 0;
    const direction = position.side === "BUY" ? 1 : -1;
    return direction * (currentPrice - position.entryPrice) * position.quantity;
}
