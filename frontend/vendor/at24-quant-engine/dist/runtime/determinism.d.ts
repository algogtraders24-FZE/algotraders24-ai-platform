/**
 * JSON.stringify does not guarantee key order across engines/inputs the way
 * this domain needs for reproducibility (Q0.8) — object keys are sorted
 * recursively so structurally-identical values always hash identically.
 */
export declare function canonicalStringify(value: unknown): string;
export declare function computeCanonicalHash(value: unknown): string;
