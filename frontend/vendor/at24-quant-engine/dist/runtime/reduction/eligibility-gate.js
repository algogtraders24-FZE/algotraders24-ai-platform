import { validateStrategyIR } from "../strategy-ir/ir-validator.js";
/**
 * Q0.9.3/4 — a StrategyIR may reduce ONLY when every one of these holds.
 * Each check traces to a REAL, documented capability boundary of Q0.5's
 * frozen simulation engine (docs/Q0.5_*.md) or Q0.6's frozen fidelity
 * engine (docs/Q0.6_*.md) — never a guess about what "should" work.
 * Q0.9.4's rule is absolute: if a semantic difference COULD change a
 * trading outcome, it blocks; nothing here silently approximates.
 */
export function checkReductionEligibility(ir) {
    const reasons = [];
    // Q0.7's own validator: structural validity, HTF lookahead, repainting/unsupported-semantics gates.
    const validation = validateStrategyIR(ir);
    if (!validation.valid) {
        reasons.push(...validation.errors.map((e) => `IR structurally invalid: ${e}`));
    }
    if (!validation.executionEligible) {
        reasons.push(...validation.blockingReasons);
    }
    // Q0.9.16 — position accounting mode: Q0.5 implements NETTING only (docs/Q0.5_POSITION_ACCOUNT.md).
    if (ir.positionManagement.accountingMode !== "NETTING") {
        reasons.push(`positionManagement.accountingMode "${ir.positionManagement.accountingMode}" is not supported — Q0.5/Q0.6 implement NETTING only`);
    }
    // Q0.5's engine unconditionally accumulates same-direction fills (position-engine.ts's increasePosition) — it has no "reject repeat entry" configuration point.
    if (ir.positionManagement.pyramiding.sameDirectionBehavior !== "ACCUMULATE") {
        reasons.push(`positionManagement.pyramiding.sameDirectionBehavior "${ir.positionManagement.pyramiding.sameDirectionBehavior}" is not supported — Q0.5's engine always accumulates same-direction fills, never rejects or ignores them`);
    }
    // Q0.5's opposite-direction handling is exactly one atomic reduce-then-reopen operation — REVERSE — never a two-step CLOSE_THEN_OPEN or a REJECT.
    if (ir.positionManagement.reversal.buyToSell !== "REVERSE" || ir.positionManagement.reversal.sellToBuy !== "REVERSE") {
        reasons.push(`positionManagement.reversal must be "REVERSE" for both directions — Q0.5's engine only implements atomic reduce-then-reopen reversal (buyToSell="${ir.positionManagement.reversal.buyToSell}", sellToBuy="${ir.positionManagement.reversal.sellToBuy}")`);
    }
    // Q0.9.24 — Q0.5/Q0.6 only ever evaluate a signal at bar close (ON_BAR_CLOSE); a repainting or unresolved-repainting strategy, or one whose signal genuinely depends on realtime/tick state, cannot be safely reduced to that model.
    if (ir.repaintingModel !== "NON_REPAINTING" && ir.repaintingModel !== "CONFIRMED_ONLY") {
        reasons.push(`repaintingModel "${ir.repaintingModel}" is not safe for ON_BAR_CLOSE simulation — Q0.5/Q0.6 only evaluate signals at bar close, never on realtime/tick state or unconfirmed values`);
    }
    // Q0.9.22/23 — a HIGHER-role timeframe read requires genuine dual-timeframe STRATEGY calculation, which does not exist (docs/Q0.6_MTF_SAFETY.md). A LOWER-role read is fine — that is exactly what D2/D3 execution fidelity is for.
    if (ir.timeframeSeries.some((s) => s.role === "HIGHER")) {
        reasons.push("a HIGHER-role timeframeSeries requires genuine dual-timeframe strategy calculation, which Q0.6/Q0.7 do not implement (docs/Q0.6_MTF_SAFETY.md)");
    }
    // Q0.9.14 — exits that Q0.5 structurally never evaluates, or that declare a leg risk itself cannot resolve.
    for (const exit of ir.exits) {
        if (exit.kind === "SIGNAL_EXIT") {
            reasons.push(`exit "${exit.id}" kind SIGNAL_EXIT is never evaluated by Q0.5's engine (StrategySpec.exitRules are accepted but not evaluated — docs/Q0.5_EXECUTION_MODEL.md)`);
        }
        if (exit.kind === "SESSION_EXIT") {
            reasons.push(`exit "${exit.id}" kind SESSION_EXIT has no forced-exit-at-session-end evaluator in Q0.3's evaluateRisk()`);
        }
        if (exit.kind === "STOP_LOSS" && ir.risk.stopLoss === undefined) {
            reasons.push(`exit "${exit.id}" declares STOP_LOSS but risk.stopLoss is unresolved — nothing would actually be simulated`);
        }
        if (exit.kind === "TAKE_PROFIT" && ir.risk.takeProfit === undefined) {
            reasons.push(`exit "${exit.id}" declares TAKE_PROFIT but risk.takeProfit is unresolved — nothing would actually be simulated`);
        }
    }
    // Q0.9.13/20 — entries must have a resolvable direction, a sizing method Q0.5 can actually compute, and timing that matches Q0.5's ONE fixed timing model exactly (never silently converted).
    for (const entry of ir.entries) {
        if (entry.direction === "FLAT") {
            reasons.push(`entry "${entry.id}" has no resolvable direction (FLAT) — a StrategySpec EntryRule requires BUY or SELL`);
        }
        if (entry.sizingModel.method === "atr-based") {
            reasons.push(`entry "${entry.id}" uses atr-based sizing, which Q0.5's resolvePositionSize() does not support (throws explicitly — docs/Q0.5_EXECUTION_MODEL.md)`);
        }
        if (entry.timing !== "NEXT_BAR_OPEN") {
            reasons.push(`entry "${entry.id}" timing "${entry.timing}" cannot be silently converted to Q0.5's fixed next-bar-open timing model (Q0.9.20 — timing is never converted merely because the target engine uses bar events)`);
        }
        // Q0.11.20 — a non-MARKET executionType is only SUPPORTED (execution-eligible) when its
        // required price reference(s) are both PRESENT and deterministically computable; an
        // UNSUPPORTED reference (BID/ASK — no live feed in this simulation model) or a missing one
        // BLOCKS, never silently falls back to MARKET or a fabricated price.
        if (entry.executionType === "LIMIT" || entry.executionType === "STOP_LIMIT") {
            if (entry.limitPrice === undefined)
                reasons.push(`entry "${entry.id}" executionType "${entry.executionType}" requires limitPrice, none is present`);
            else if (entry.limitPrice.kind === "UNSUPPORTED")
                reasons.push(`entry "${entry.id}" limitPrice references "${entry.limitPrice.reason}", which is not deterministically computable in this simulation model`);
        }
        if (entry.executionType === "STOP" || entry.executionType === "STOP_LIMIT") {
            if (entry.stopPrice === undefined)
                reasons.push(`entry "${entry.id}" executionType "${entry.executionType}" requires stopPrice, none is present`);
            else if (entry.stopPrice.kind === "UNSUPPORTED")
                reasons.push(`entry "${entry.id}" stopPrice references "${entry.stopPrice.reason}", which is not deterministically computable in this simulation model`);
        }
    }
    // Q0.10.16 — position management (breakeven/trailing/partialClose) is NEVER silently dropped:
    // an atr-multiple DistanceSpec is only SUPPORTED if a matching ATR indicator is actually
    // declared (else the rule is permanently inert — always the MISSING_REQUIRED_VALUE violation,
    // never firing) and if it is the ONLY distinct ATR period the strategy relies on (Q0.5's
    // SimulationConfig.atrByIndex is a single series, not one per period — two different
    // atr-multiple periods across risk rules cannot both be served by one simulation run).
    const atrPeriods = new Set();
    const collectAtrPeriod = (spec) => {
        if (spec?.mode === "atr-multiple")
            atrPeriods.add(spec.atrPeriod);
    };
    if (ir.risk.stopLoss?.type === "atr-multiple")
        atrPeriods.add(ir.risk.stopLoss.atrPeriod);
    collectAtrPeriod(ir.risk.breakeven?.trigger);
    collectAtrPeriod(ir.risk.breakeven?.lockOffset);
    collectAtrPeriod(ir.risk.trailingStop?.activation);
    collectAtrPeriod(ir.risk.trailingStop?.distance);
    collectAtrPeriod(ir.risk.partialClose?.trigger);
    if (atrPeriods.size > 1) {
        reasons.push(`multiple distinct ATR periods are referenced across risk rules (${[...atrPeriods].join(", ")}) — Q0.5's simulation config supplies exactly one ATR series per run, so at most one atrPeriod may be used across stopLoss/breakeven/trailingStop/partialClose combined`);
    }
    else if (atrPeriods.size === 1) {
        const period = [...atrPeriods][0];
        const hasMatchingIndicator = ir.indicators.some((ind) => ind.kind === "named" && ind.family === "ATR" && Number(ind.params[0]) === period);
        if (!hasMatchingIndicator) {
            reasons.push(`an atr-multiple risk rule references ATR(${period}), but no matching ATR indicator is declared in ir.indicators — this rule would never fire (its ATR value would always be missing at evaluation time)`);
        }
    }
    return { eligible: reasons.length === 0, blockingReasons: reasons };
}
