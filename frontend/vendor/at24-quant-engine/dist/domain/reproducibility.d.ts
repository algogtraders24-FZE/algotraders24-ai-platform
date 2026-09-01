/**
 * Everything a later run needs to prove it reproduces the same result
 * (Q0.8). Absence of any one field here means the result cannot be
 * trusted to be reproducible.
 */
export interface ReproducibilityMetadata {
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly strategyContentHash: string;
    readonly datasetId: string;
    readonly datasetHash: string;
    readonly backtestConfigHash: string;
    readonly executionAssumptionsHash: string;
    readonly runtimeVersion: string;
}
