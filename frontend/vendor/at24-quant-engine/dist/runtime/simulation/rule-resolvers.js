import { computeRiskDistance } from "../risk/geometry.js";
/**
 * Resolves a StopLossRule/TakeProfitRule (Q0.2/Q0.3) into a concrete
 * price, given an assumed entry price. Throws — rather than returning a
 * RiskViolation — when required context (an ATR value) is missing,
 * matching the same "missing required context is a caller integration
 * error" pattern Q0.3's resolveDistanceSpec already established.
 */
export function resolveStopLossPrice(rule, direction, entryPrice, atrValue) {
    if (!rule)
        return undefined;
    switch (rule.type) {
        case "fixed-price":
            return rule.price;
        case "fixed-distance":
            return direction === "BUY" ? entryPrice - rule.distance : entryPrice + rule.distance;
        case "atr-multiple": {
            if (atrValue === undefined)
                throw new Error("resolveStopLossPrice: atr-multiple rule requires an ATR value, none was supplied");
            const distance = rule.atrMultiple * atrValue;
            return direction === "BUY" ? entryPrice - distance : entryPrice + distance;
        }
    }
}
export function resolveTakeProfitPrice(rule, direction, entryPrice, stopLossPrice) {
    if (!rule)
        return undefined;
    switch (rule.type) {
        case "fixed-price":
            return rule.price;
        case "fixed-distance":
            return direction === "BUY" ? entryPrice + rule.distance : entryPrice - rule.distance;
        case "risk-multiple": {
            if (stopLossPrice === undefined) {
                throw new Error("resolveTakeProfitPrice: risk-multiple rule requires a stopLoss to compute the risk distance");
            }
            const riskDistance = computeRiskDistance(direction, entryPrice, stopLossPrice);
            return direction === "BUY" ? entryPrice + rule.rMultiple * riskDistance : entryPrice - rule.rMultiple * riskDistance;
        }
    }
}
/**
 * KNOWN LIMITATION (documented, not silently guessed — see
 * docs/Q0.5_EXECUTION_MODEL.md): "atr-based" position sizing
 * (`{ method: "atr-based", atrMultiple, atrPeriod }`) was defined at the
 * RiskSpecification contract level in Q0.2 without ever specifying an
 * operational quantity formula — there is no risk-percent field to
 * normalize against, unlike "percent-equity-risk". Rather than invent an
 * undocumented formula, Q0.5 throws a clear, explicit error for this
 * sizing method. fixed-quantity, fixed-lot, and percent-equity-risk are
 * fully resolved.
 */
export function resolvePositionSize(sizing, params) {
    switch (sizing.method) {
        case "fixed-quantity":
            return sizing.quantity;
        case "fixed-lot":
            return sizing.lots;
        case "percent-equity-risk": {
            if (params.stopLossPrice === undefined) {
                throw new Error("resolvePositionSize: percent-equity-risk sizing requires a stopLoss to compute a risk distance");
            }
            const riskDistance = Math.abs(params.entryPrice - params.stopLossPrice);
            if (!(riskDistance > 0))
                throw new Error("resolvePositionSize: percent-equity-risk sizing requires a positive risk distance");
            const riskAmount = (sizing.percent / 100) * params.equity;
            return riskAmount / riskDistance;
        }
        case "atr-based":
            throw new Error("resolvePositionSize: atr-based sizing has no resolved quantity formula in Q0.5 (docs/Q0.5_EXECUTION_MODEL.md) — use fixed-quantity, fixed-lot, or percent-equity-risk");
    }
}
