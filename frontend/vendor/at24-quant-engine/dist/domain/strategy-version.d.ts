import type { StrategySpec } from "./strategy-spec.js";
/**
 * A published StrategyVersionRecord is immutable (Q0.9 / ADR-007): the
 * spec is frozen at publish time and contentHash lets any later consumer
 * detect if the underlying spec object was mutated in place. Changing
 * strategy logic must produce a NEW version, not an edit to this one.
 * This is Quant-side only — it is not connected to the M-Series
 * TradingSystem/Version model (see Q0.9, ADR-006).
 */
export interface StrategyVersionRecord {
    readonly strategyId: string;
    readonly version: string;
    readonly spec: StrategySpec;
    readonly publishedAt: number;
    readonly contentHash: string;
}
export declare function freezeStrategyVersion(spec: StrategySpec, publishedAt: number): StrategyVersionRecord;
export declare function verifyStrategyVersionIntegrity(record: StrategyVersionRecord): boolean;
