import { computeCanonicalHash } from "../runtime/determinism.js";
export function freezeStrategyVersion(spec, publishedAt) {
    return {
        strategyId: spec.identity.strategyId,
        version: spec.version,
        spec: structuredClone(spec),
        publishedAt,
        contentHash: computeCanonicalHash(spec),
    };
}
export function verifyStrategyVersionIntegrity(record) {
    return computeCanonicalHash(record.spec) === record.contentHash;
}
