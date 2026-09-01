import { createHash } from "node:crypto";
/**
 * JSON.stringify does not guarantee key order across engines/inputs the way
 * this domain needs for reproducibility (Q0.8) — object keys are sorted
 * recursively so structurally-identical values always hash identically.
 */
export function canonicalStringify(value) {
    return JSON.stringify(sortKeysDeep(value));
}
function sortKeysDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }
    if (value !== null && typeof value === "object") {
        if (value instanceof Map) {
            return sortKeysDeep(Object.fromEntries(value.entries()));
        }
        const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
    }
    return value;
}
export function computeCanonicalHash(value) {
    return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}
