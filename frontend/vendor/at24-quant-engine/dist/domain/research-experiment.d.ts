import type { Instrument, Timeframe } from "./market-data.js";
import type { ExecutionSpecification } from "./execution-specification.js";
import type { ResearchResultStatus } from "./research-result.js";
export type ValidationMethod = "single-pass" | "walk-forward" | "out-of-sample-holdout" | "cross-validation" | "other";
/**
 * A research-only record answering "what exactly did we test?" — not a
 * database, a typed fixture shape (Q0.2.11). Deliberately references a
 * pre-computed `strategyHash` rather than embedding the full StrategySpec,
 * so an experiment record stays small and its identity is independent of
 * how the spec happens to be serialized.
 */
export interface ResearchExperiment {
    readonly experimentId: string;
    readonly hypothesis: string;
    readonly strategyVersion: string;
    readonly strategyHash: string;
    readonly datasetId: string;
    readonly datasetVersion: string;
    readonly instrument: Instrument;
    readonly timeframe: Timeframe;
    readonly startTime: number;
    readonly endTime: number;
    readonly parameters: Readonly<Record<string, number | boolean | string>>;
    readonly executionAssumptions: ExecutionSpecification;
    readonly validationMethod: ValidationMethod;
    readonly runtimeVersion: string;
    readonly createdAt: number;
    readonly resultStatus: ResearchResultStatus;
}
