import type { SourcePlatform } from "./source.js";
import type { UnsupportedSemantic, ApproximationRecord } from "./unsupported.js";
/**
 * Q0.7.4 — the honest record of what a translation actually did.
 * `confidence` is DELIBERATELY ABSENT (Q0.7.4/Q0.7.47's explicit rule):
 * this report never carries an AI/LLM confidence score or probability —
 * only deterministic semantic status (translatedFeatures'
 * SemanticFidelity tags, unsupportedFeatures' severities). If a future
 * caller wants a single "is this safe" verdict, it derives one FROM these
 * deterministic fields (e.g. "BLOCKING severity present" -> unsafe) —
 * never from a stored confidence number.
 */
export interface StrategyTranslationReport {
    readonly sourcePlatform: SourcePlatform;
    readonly sourceHash: string;
    readonly irVersion: string;
    readonly translatedFeatures: readonly string[];
    readonly unsupportedFeatures: readonly UnsupportedSemantic[];
    readonly approximatedFeatures: readonly ApproximationRecord[];
    readonly semanticWarnings: readonly string[];
    readonly lookaheadWarnings: readonly string[];
    readonly repaintingWarnings: readonly string[];
    readonly executionDifferences: readonly string[];
}
