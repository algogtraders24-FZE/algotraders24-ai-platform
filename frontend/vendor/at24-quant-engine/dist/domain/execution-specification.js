import { fail, combine } from "./validation-result.js";
export function validateExecutionSpecification(spec) {
    const results = [];
    const costsUnset = spec.spread === undefined &&
        spec.slippage === undefined &&
        spec.commissionPerUnit === undefined &&
        spec.fee === undefined;
    if (costsUnset && spec.costsExplicitlyZero !== true) {
        results.push(fail("execution costs (spread/slippage/commissionPerUnit/fee) are all unset — " +
            "set costsExplicitlyZero: true if this is intentional, otherwise specify them explicitly"));
    }
    if (spec.commissionPerUnit !== undefined && spec.commissionPerUnit < 0) {
        results.push(fail("commissionPerUnit must be >= 0"));
    }
    if (spec.fee !== undefined && spec.fee.value < 0) {
        results.push(fail("fee.value must be >= 0"));
    }
    if (spec.latency !== undefined && spec.latency.value < 0) {
        results.push(fail("latency.value must be >= 0"));
    }
    if (spec.marginAssumption !== undefined && spec.marginAssumption.leverage <= 0) {
        results.push(fail("marginAssumption.leverage must be > 0"));
    }
    if (spec.slippage !== undefined && spec.slippage.value < 0) {
        results.push(fail("slippage.value must be >= 0"));
    }
    if (spec.spread !== undefined && spec.spread.value < 0) {
        results.push(fail("spread.value must be >= 0"));
    }
    return combine(...results);
}
