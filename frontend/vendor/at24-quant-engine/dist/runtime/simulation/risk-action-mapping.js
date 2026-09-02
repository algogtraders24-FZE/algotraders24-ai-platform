export function mapRiskAction(action) {
    switch (action.type) {
        case "ALLOW_ENTRY":
            return {
                kind: "CREATE_ENTRY_ORDER",
                orderType: action.orderType ?? "MARKET",
                ...(action.limitPrice !== undefined ? { limitPrice: action.limitPrice } : {}),
                ...(action.stopPrice !== undefined ? { stopPrice: action.stopPrice } : {}),
            };
        case "REJECT_ENTRY":
        case "NO_ACTION":
            return { kind: "NO_OP" };
        case "MOVE_STOP":
            return { kind: "MODIFY_STOP", newStopPrice: action.newStopPrice };
        case "PARTIAL_CLOSE":
            return { kind: "REDUCE_POSITION", closePercent: action.closePercent };
        case "FORCE_EXIT_REQUIRED":
            return { kind: "FORCE_EXIT" };
        default: {
            const exhaustive = action;
            throw new Error(`mapRiskAction: unsupported RiskAction: ${JSON.stringify(exhaustive)}`);
        }
    }
}
