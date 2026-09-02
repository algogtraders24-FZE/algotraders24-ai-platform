import type { StrategySpec } from "../domain/strategy-spec.js";
import type { Instrument, Timeframe } from "../domain/market-data.js";
import type { ExecutionSpecification } from "../domain/execution-specification.js";
import type { ValidationMethod } from "../domain/research-experiment.js";
/**
 * Semantic content hash of a StrategySpec: excludes `metadata` entirely
 * (description/author/tags/createdAt are documentation, not behavior), so
 * two structurally-identical strategies authored at different times or
 * with different descriptions hash identically.
 *
 * DELIBERATELY DIFFERENT from StrategyVersionRecord.contentHash
 * (strategy-version.ts), which hashes the FULL spec including metadata and
 * exists to detect any mutation of a frozen version record — not to
 * express semantic equivalence. Both are correct for their own job; see
 * docs/Q0.2_CONTRACT_FREEZE.md for why they must stay separate functions.
 */
export declare function computeSemanticStrategyHash(spec: StrategySpec): string;
export type IndicatorVersionPins = Readonly<Record<string, string>>;
/**
 * Composite research identity (Q0.2.10): the StrategySpec's semantic
 * content (which already carries risk + execution assumptions, since both
 * are nested fields of StrategySpec) plus the indicator implementation
 * versions used to evaluate it. IndicatorReference itself carries no
 * version field (kept out of scope to avoid touching Expression further
 * than Q0.2.2 already does) — pins are supplied explicitly by the caller
 * instead.
 */
export declare function computeStrategyIdentityHash(spec: StrategySpec, indicatorVersions: IndicatorVersionPins): string;
export interface ExperimentIdentityInput {
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
}
/**
 * Experiment identity (Q0.2.12). Deliberately excludes `experimentId`
 * (an assigned ID would make every hash trivially unique), `hypothesis`
 * (documentation of intent, not what was mechanically run), `createdAt`
 * (a timestamp), and `resultStatus` (a mutable outcome produced BY running
 * the experiment, not part of its identity).
 */
export declare function computeExperimentIdentityHash(input: ExperimentIdentityInput): string;
