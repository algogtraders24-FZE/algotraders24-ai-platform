import type { Diagnostic } from "./diagnostic.js";
import type { MQLDialect } from "./mql-source-document.js";
/** Q0.8.43 — traces one generated StrategyIR feature back to its exact source origin. */
export interface SourceToIRMapping {
    readonly irFeature: string;
    readonly sourceLine: number;
    readonly sourceColumn: number;
    readonly sourceHash: string;
}
/**
 * Q0.8.45 — the human-readable (and machine-checkable) summary of one
 * import run. `blockingDiagnostics.length === 0` is the ONLY condition
 * under which the resulting StrategyIR may be execution-eligible
 * (Q0.8.42's rule, enforced downstream by Q0.7's own `validateStrategyIR`
 * too — this report doesn't duplicate that judgment, it just surfaces
 * the raw facts a human or the Q0.7 validator both need).
 */
export interface MQLImportReport {
    readonly sourceHash: string;
    readonly dialect: MQLDialect;
    readonly parsedConstructs: readonly string[];
    readonly recognizedIndicators: readonly string[];
    readonly recognizedConditions: readonly string[];
    readonly recognizedOrders: readonly string[];
    readonly riskBehavior: readonly string[];
    readonly executionBehavior: readonly string[];
    readonly unsupportedConstructs: readonly string[];
    readonly diagnostics: readonly Diagnostic[];
    readonly sourceToIRMappings: readonly SourceToIRMapping[];
}
export declare function blockingDiagnostics(report: MQLImportReport): readonly Diagnostic[];
