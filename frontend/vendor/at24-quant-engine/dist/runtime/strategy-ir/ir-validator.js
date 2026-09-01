import { validateStrategyIRStructure } from "../../domain/strategy-ir/strategy-ir.js";
import { indicatorKey } from "../../domain/indicator-reference.js";
function declaredIndicatorKeys(indicators) {
    const keys = new Set();
    for (const ind of indicators) {
        if (ind.kind === "named")
            keys.add(`${ind.family}(${ind.params.join(",")})`);
        else
            keys.add(`${ind.name}(${ind.parameters.join(",")})`);
    }
    return keys;
}
function collectIndicatorRefs(expr, out) {
    switch (expr.type) {
        case "comparison":
            for (const operand of [expr.left, expr.right]) {
                if (operand.kind === "indicator")
                    out.add(indicatorKey(operand.ref));
            }
            return;
        case "boolean-reference":
            out.add(indicatorKey(expr.ref));
            return;
        case "logical":
            expr.operands.forEach((child) => collectIndicatorRefs(child, out));
            return;
    }
}
/**
 * Q0.7.5 — every indicator a condition/entry/exit REFERENCES must also
 * be DECLARED in `ir.indicators` — an undeclared reference (e.g. a
 * translator that emitted a condition against `RSI(14)` but never
 * recorded that indicator in the IR's own inventory) is flagged as an
 * error, never silently tolerated as "probably fine."
 */
function checkIndicatorReferencesDeclared(ir) {
    const declared = declaredIndicatorKeys(ir.indicators);
    const used = new Set();
    ir.entries.forEach((e) => {
        collectIndicatorRefs(e.condition, used);
        if (e.trigger)
            collectIndicatorRefs(e.trigger, used);
    });
    ir.exits.forEach((e) => {
        if (e.condition)
            collectIndicatorRefs(e.condition, used);
    });
    ir.conditions.forEach((c) => collectIndicatorRefs(c.expression, used));
    const undeclared = [...used].filter((key) => !declared.has(key));
    return undeclared.map((key) => `condition references indicator "${key}" which is not declared in ir.indicators — unknown indicator`);
}
/**
 * Q0.7.20 — the canonical HTF-lookahead rule: any timeframeSeries entry
 * whose role is HIGHER (a genuine cross-timeframe read) must declare
 * HTF_CLOSE_AVAILABLE. HTF_OPEN_AVAILABLE/INTRABAR_AVAILABLE exist ONLY
 * to let a translator record that the SOURCE claimed earlier
 * availability — the validator always treats that as BLOCKING, never a
 * silently-accepted alternative execution mode (docs/Q0.7_MTF_SEMANTICS.md).
 */
function checkHTFLookahead(ir) {
    const blocking = [];
    for (const series of ir.timeframeSeries) {
        if (series.role === "HIGHER" && series.availabilityPolicy !== "HTF_CLOSE_AVAILABLE") {
            blocking.push(`timeframeSeries (${series.timeframe}, role HIGHER) declares "${series.availabilityPolicy}" — only HTF_CLOSE_AVAILABLE is a safe, executable HTF-availability policy (Q0.7.20)`);
        }
    }
    for (const call of ir.requestSecurityCalls ?? []) {
        if (call.lookahead === "ON") {
            blocking.push(`requestSecurityCalls (${call.sourceTimeframe} -> ${call.requestedTimeframe}) has lookahead: "ON" — this is the unsafe direction Q0.4 researched and AT24 never executes (Q0.7.21)`);
        }
        if (!call.confirmedOnly) {
            blocking.push(`requestSecurityCalls (${call.sourceTimeframe} -> ${call.requestedTimeframe}) is not confirmedOnly — an unconfirmed HTF read is a repainting/lookahead risk (Q0.7.21/22)`);
        }
    }
    return blocking;
}
/** Q0.7.22 — repainting semantics that remain unresolved are always BLOCKING for execution eligibility, independent of structural validity. */
function checkRepainting(ir) {
    if (ir.repaintingModel === "REPAINTING")
        return [`repaintingModel is "REPAINTING" — this strategy's values change retroactively and cannot be safely executed (Q0.7.22)`];
    if (ir.repaintingModel === "UNKNOWN")
        return [`repaintingModel is "UNKNOWN" — repainting risk must be resolved (NON_REPAINTING/CONFIRMED_ONLY/REALTIME_DEPENDENT) before execution eligibility can be granted (Q0.7.22)`];
    return [];
}
/** Q0.7.31 — any UnsupportedSemantic with severity BLOCKING makes the whole IR execution-ineligible, regardless of everything else. */
function checkUnsupportedSemantics(ir) {
    return ir.provenance.unsupportedSemantics.filter((u) => u.severity === "BLOCKING").map((u) => `unsupported semantic "${u.feature}": ${u.reason} (${u.executionImpact})`);
}
/**
 * Q0.7.37/38 — the full validation pipeline: structural validity
 * (domain/strategy-ir/strategy-ir.ts's validateStrategyIRStructure)
 * first, then the semantic checks Q0.7.38 enumerates (MTF/lookahead,
 * repainting, unsupported semantics — timezone/symbols/timeframes/
 * indicators/parameters/conditions/orders/risk/execution are already
 * covered by the structural pass, since RiskSpecification/Expression
 * validation is reused directly, never reimplemented).
 *
 * `executionEligible` is the Q0.7.22-mandated distinction: a
 * STRUCTURALLY valid IR (no errors) can still be execution-INELIGIBLE
 * if repainting is unresolved or a BLOCKING unsupported semantic exists
 * — "valid" and "safe to execute" are deliberately different questions.
 */
export function validateStrategyIR(ir) {
    const structural = validateStrategyIRStructure(ir);
    const indicatorErrors = checkIndicatorReferencesDeclared(ir);
    const errors = [...structural.errors, ...indicatorErrors];
    const blockingReasons = [...checkHTFLookahead(ir), ...checkRepainting(ir), ...checkUnsupportedSemantics(ir)];
    return {
        valid: errors.length === 0,
        errors,
        executionEligible: errors.length === 0 && blockingReasons.length === 0,
        blockingReasons,
    };
}
