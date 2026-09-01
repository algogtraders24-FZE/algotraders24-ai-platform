import { computeCanonicalHash } from "./determinism.js";
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
export function computeSemanticStrategyHash(spec) {
    const { metadata: _metadata, ...semantic } = spec;
    return computeCanonicalHash(semantic);
}
/**
 * Composite research identity (Q0.2.10): the StrategySpec's semantic
 * content (which already carries risk + execution assumptions, since both
 * are nested fields of StrategySpec) plus the indicator implementation
 * versions used to evaluate it. IndicatorReference itself carries no
 * version field (kept out of scope to avoid touching Expression further
 * than Q0.2.2 already does) — pins are supplied explicitly by the caller
 * instead.
 */
export function computeStrategyIdentityHash(spec, indicatorVersions) {
    const { metadata: _metadata, ...semantic } = spec;
    return computeCanonicalHash({ strategy: semantic, indicatorVersions });
}
/**
 * Experiment identity (Q0.2.12). Deliberately excludes `experimentId`
 * (an assigned ID would make every hash trivially unique), `hypothesis`
 * (documentation of intent, not what was mechanically run), `createdAt`
 * (a timestamp), and `resultStatus` (a mutable outcome produced BY running
 * the experiment, not part of its identity).
 */
export function computeExperimentIdentityHash(input) {
    return computeCanonicalHash(input);
}
