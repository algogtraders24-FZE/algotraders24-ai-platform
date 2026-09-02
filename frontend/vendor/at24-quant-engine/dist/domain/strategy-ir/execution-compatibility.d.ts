import type { SimulationFidelity } from "../fidelity/simulation-fidelity.js";
export type CapabilityStatus = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "BLOCKED";
export interface FeatureCompatibility {
    readonly feature: string;
    readonly requiredCapability: string;
    readonly availableCapability?: string;
    readonly status: CapabilityStatus;
    readonly note?: string;
}
/**
 * Q0.7.39 — checks a StrategyIR's declared features against what
 * AT24's own simulation engine (Q0.5/Q0.6, unmodified) can actually
 * execute today. `targetFidelity` records WHICH engine tier the check
 * was run against, since capability differs by fidelity (e.g. D2/D3 can
 * resolve intrabar SL/TP ambiguity D1 cannot — docs/Q0.6_D2_D3_EXECUTION.md).
 */
export interface ExecutionCompatibilityReport {
    readonly targetFidelity: SimulationFidelity;
    readonly features: readonly FeatureCompatibility[];
    readonly overallStatus: CapabilityStatus;
}
