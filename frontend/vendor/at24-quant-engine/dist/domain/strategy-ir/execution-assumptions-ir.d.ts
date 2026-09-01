import type { ExecutionSpecification } from "../execution-specification.js";
export type { ExecutionSpecification };
/**
 * Q0.7.29/30 — the IR may DECLARE what the source assumed; it never
 * computes fees/spread/slippage/latency itself (that stays the execution
 * engine's job, Q0.7.29's explicit instruction — no duplication of
 * Q0.5/Q0.6's fill logic). `platformDefaultsUsed` records, by name, any
 * platform-specific default the translator had to import so it is
 * never silent (Q0.7.30 — e.g. "Pine order timing", "MT4 hedging").
 */
export interface ExecutionAssumptionsIR {
    readonly declared: ExecutionSpecification;
    readonly platformDefaultsUsed: readonly string[];
}
