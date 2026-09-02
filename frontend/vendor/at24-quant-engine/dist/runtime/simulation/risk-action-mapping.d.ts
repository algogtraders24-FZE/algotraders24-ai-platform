import type { RiskAction } from "../../domain/risk-evaluation.js";
import type { SimulationOrderType } from "../../domain/simulation/order.js";
/**
 * Q0.5.26's required mapping, expressed as data rather than performing
 * side effects directly — keeps the mapping itself pure and unit-testable
 * in isolation from the orchestrator. Every RiskAction variant is handled
 * explicitly; the `default` branch below is unreachable through TS's
 * closed union but exists so an unrecognized action fails loudly rather
 * than silently falling through (Q0.5.26's "any unsupported mapping must
 * fail explicitly").
 */
/**
 * Q0.11 CONTRACT CHANGE (additive, backward-compatible): `CREATE_ENTRY_ORDER`
 * gained optional `limitPrice`/`stopPrice`, populated only when
 * `action.orderType` requires them. `orderType` itself was already a
 * required field, but every producer before Q0.11 (`RiskAction.ALLOW_ENTRY`
 * always omitted the now-added `orderType` field) resolved to the
 * `?? "MARKET"` default below — behavior is byte-identical for any
 * `ALLOW_ENTRY` action that doesn't set the new fields.
 */
export type RiskActionMapping = {
    readonly kind: "CREATE_ENTRY_ORDER";
    readonly orderType: SimulationOrderType;
    readonly limitPrice?: number;
    readonly stopPrice?: number;
} | {
    readonly kind: "NO_OP";
} | {
    readonly kind: "MODIFY_STOP";
    readonly newStopPrice: number;
} | {
    readonly kind: "REDUCE_POSITION";
    readonly closePercent: number;
} | {
    readonly kind: "FORCE_EXIT";
};
export declare function mapRiskAction(action: RiskAction): RiskActionMapping;
