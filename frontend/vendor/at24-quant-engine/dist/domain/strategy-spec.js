import { validateExpression } from "./expression.js";
import { validateRiskSpecification } from "./risk-specification.js";
import { validatePriceReference } from "./strategy-ir/price-reference.js";
import { validatePendingOrderManagementPolicy } from "./pending-order-management-policy.js";
import { ok, fail, combine } from "./validation-result.js";
const SEMVER_LIKE = /^\d+\.\d+\.\d+$/;
export function validateStrategyVersionString(version) {
    return SEMVER_LIKE.test(version)
        ? ok()
        : fail(`version must match MAJOR.MINOR.PATCH (e.g. "1.0.0"), got "${version}"`);
}
function findDuplicates(ids) {
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
        if (seen.has(id))
            duplicates.add(id);
        seen.add(id);
    }
    return [...duplicates];
}
export function validateStrategySpec(spec) {
    const results = [];
    if (!spec.identity.strategyId.trim())
        results.push(fail("identity.strategyId must not be empty"));
    if (!spec.identity.name.trim())
        results.push(fail("identity.name must not be empty"));
    results.push(validateStrategyVersionString(spec.version));
    if (spec.instruments.length === 0)
        results.push(fail("instruments must contain at least one Instrument"));
    if (spec.timeframes.length === 0)
        results.push(fail("timeframes must contain at least one Timeframe"));
    if (spec.entryRules.length === 0)
        results.push(fail("entryRules must contain at least one EntryRule"));
    const paramKeyDupes = findDuplicates(spec.parameters.map((p) => p.key));
    if (paramKeyDupes.length > 0)
        results.push(fail(`duplicate parameter keys: ${paramKeyDupes.join(", ")}`));
    const entryIdDupes = findDuplicates(spec.entryRules.map((r) => r.id));
    if (entryIdDupes.length > 0)
        results.push(fail(`duplicate entryRule ids: ${entryIdDupes.join(", ")}`));
    const exitIdDupes = findDuplicates(spec.exitRules.map((r) => r.id));
    if (exitIdDupes.length > 0)
        results.push(fail(`duplicate exitRule ids: ${exitIdDupes.join(", ")}`));
    spec.entryRules.forEach((rule, i) => {
        results.push(validateExpression(rule.condition, `entryRules[${i}](${rule.id}).condition`));
        const executionType = rule.executionType ?? "MARKET";
        const path = `entryRules[${i}](${rule.id})`;
        const needsLimit = executionType === "LIMIT" || executionType === "STOP_LIMIT";
        const needsStop = executionType === "STOP" || executionType === "STOP_LIMIT";
        if (needsLimit && rule.limitPrice === undefined)
            results.push(fail(`${path}: executionType "${executionType}" requires limitPrice`));
        if (needsStop && rule.stopPrice === undefined)
            results.push(fail(`${path}: executionType "${executionType}" requires stopPrice`));
        if (!needsLimit && rule.limitPrice !== undefined)
            results.push(fail(`${path}: limitPrice is only valid for LIMIT/STOP_LIMIT, got executionType "${executionType}"`));
        if (!needsStop && rule.stopPrice !== undefined)
            results.push(fail(`${path}: stopPrice is only valid for STOP/STOP_LIMIT, got executionType "${executionType}"`));
        if (rule.limitPrice !== undefined)
            results.push(validatePriceReference(rule.limitPrice, `${path}.limitPrice`));
        if (rule.stopPrice !== undefined)
            results.push(validatePriceReference(rule.stopPrice, `${path}.stopPrice`));
    });
    spec.exitRules.forEach((rule, i) => {
        results.push(validateExpression(rule.condition, `exitRules[${i}](${rule.id}).condition`));
    });
    spec.parameters.forEach((param) => {
        if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
            results.push(fail(`parameter "${param.key}": min must be <= max`));
        }
    });
    results.push(validateRiskSpecification(spec.risk));
    if (spec.pendingOrderManagement)
        results.push(validatePendingOrderManagementPolicy(spec.pendingOrderManagement));
    return combine(...results);
}
