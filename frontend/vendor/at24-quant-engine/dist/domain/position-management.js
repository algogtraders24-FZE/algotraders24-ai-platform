export function extractPositionManagementPolicy(spec) {
    return {
        ...(spec.breakeven !== undefined ? { breakeven: spec.breakeven } : {}),
        ...(spec.trailingStop !== undefined ? { trailingStop: spec.trailingStop } : {}),
        ...(spec.partialClose !== undefined ? { partialClose: spec.partialClose } : {}),
        ...(spec.maxHoldingPeriod !== undefined ? { maxHoldingPeriod: spec.maxHoldingPeriod } : {}),
    };
}
export function hasPositionManagement(policy) {
    return policy.breakeven !== undefined || policy.trailingStop !== undefined || policy.partialClose !== undefined || policy.maxHoldingPeriod !== undefined;
}
/**
 * Pure mapping: `RiskEvaluationResult` (Q0.3's `evaluateRisk()` output,
 * already computed and unmodified) -> Q0.10's richer, explicitly-named
 * instruction vocabulary. Keeps Policy (`RiskSpecification`) ->
 * Evaluation (`evaluateRisk`) -> Action (`RiskAction`) -> this mapping
 * strictly separate layers (Q0.10.2/11) — this function never decides
 * anything itself, it only renames/restructures a decision already made.
 * `previousStopPrice` is supplied by the caller because `RiskAction`
 * itself carries no "before" value (Q0.3's own contract, unchanged).
 */
export function derivePositionManagementInstruction(result, previousStopPrice) {
    const action = result.action;
    switch (action.type) {
        case "MOVE_STOP":
            return {
                kind: "STOP_ADJUSTMENT",
                instruction: {
                    reason: action.sourceRule ?? "TRAILING",
                    ...(previousStopPrice !== undefined ? { previousStopPrice } : {}),
                    newStopPrice: action.newStopPrice,
                    timestamp: result.evaluatedAt,
                },
            };
        case "PARTIAL_CLOSE":
            return { kind: "PARTIAL_CLOSE", instruction: { closePercent: action.closePercent, timestamp: result.evaluatedAt } };
        case "FORCE_EXIT_REQUIRED":
            return { kind: "FORCED_EXIT", instruction: { reasonCode: action.reasonCode, timestamp: result.evaluatedAt } };
        default:
            return { kind: "NONE" };
    }
}
