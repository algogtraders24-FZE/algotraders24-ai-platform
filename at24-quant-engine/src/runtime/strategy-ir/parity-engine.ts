import type { StrategyIR } from "../../domain/strategy-ir/strategy-ir.js";
import type { ParityReport, ParityFeatureDiff, ParityDifferenceCategory } from "../../domain/strategy-ir/parity.js";
import { computeCanonicalHash } from "../determinism.js";
import { canonicalizeStrategyIR } from "./canonicalize.js";
import { computeCanonicalIRHash } from "./ir-hash.js";

/** Wraps in an object so an `undefined` field (e.g. the optional `session`) is a valid, hashable JSON value rather than throwing. */
function fieldHash(value: unknown): string {
  return computeCanonicalHash({ v: value ?? null });
}

/**
 * Q0.7.49/50 — feature-by-feature structural comparison between two IRs
 * translated from (presumably) equivalent source strategies on two
 * platforms. Every difference is reported explicitly (Q0.7.49's rule) —
 * this function never collapses "probably fine" differences silently.
 * Categorization is a simple, deterministic rule set, not a similarity
 * score: EXECUTION_DIFFERENCE for anything touching how orders/positions
 * behave, PLATFORM_DIFFERENCE for anything touching bar-timing/
 * repainting/sessions/timezone (platform-behavior facts, not strategy
 * logic), DATA_DIFFERENCE for indicator/series inputs, SEMANTIC_PARITY
 * when both sides are non-empty but structurally different in a way this
 * function cannot further classify, UNSUPPORTED when either side has a
 * BLOCKING unsupported semantic touching the feature.
 */
export function compareParity(left: StrategyIR, right: StrategyIR): ParityReport {
  const leftIrHash = computeCanonicalIRHash(left);
  const rightIrHash = computeCanonicalIRHash(right);
  const canonicalLeft = canonicalizeStrategyIR(left);
  const canonicalRight = canonicalizeStrategyIR(right);

  const differences: ParityFeatureDiff[] = [];

  function diff(feature: string, category: ParityDifferenceCategory, leftValue: unknown, rightValue: unknown, note?: string): void {
    const lh = fieldHash(leftValue);
    const rh = fieldHash(rightValue);
    if (lh !== rh) {
      differences.push({ feature, category, leftValue: JSON.stringify(leftValue), rightValue: JSON.stringify(rightValue), ...(note ? { note } : {}) });
    }
  }

  diff("indicators", "DATA_DIFFERENCE", canonicalLeft.indicators, canonicalRight.indicators);
  diff("conditions", "SEMANTIC_PARITY", canonicalLeft.conditions, canonicalRight.conditions);
  diff("entries", "EXECUTION_DIFFERENCE", canonicalLeft.entries, canonicalRight.entries);
  diff("exits", "EXECUTION_DIFFERENCE", canonicalLeft.exits, canonicalRight.exits);
  diff("risk", "EXECUTION_DIFFERENCE", canonicalLeft.risk, canonicalRight.risk);
  diff("positionManagement", "EXECUTION_DIFFERENCE", canonicalLeft.positionManagement, canonicalRight.positionManagement);
  diff("barCloseSemantics", "PLATFORM_DIFFERENCE", canonicalLeft.barCloseSemantics, canonicalRight.barCloseSemantics);
  diff("repaintingModel", "PLATFORM_DIFFERENCE", canonicalLeft.repaintingModel, canonicalRight.repaintingModel);
  diff("timezone", "PLATFORM_DIFFERENCE", canonicalLeft.timezone, canonicalRight.timezone);
  diff("session", "PLATFORM_DIFFERENCE", canonicalLeft.session, canonicalRight.session);
  diff("execution", "EXECUTION_DIFFERENCE", canonicalLeft.execution, canonicalRight.execution);

  const leftBlocking = left.provenance.unsupportedSemantics.some((u) => u.severity === "BLOCKING");
  const rightBlocking = right.provenance.unsupportedSemantics.some((u) => u.severity === "BLOCKING");
  if (leftBlocking || rightBlocking) {
    differences.push({
      feature: "unsupportedSemantics",
      category: "UNSUPPORTED",
      leftValue: JSON.stringify(left.provenance.unsupportedSemantics),
      rightValue: JSON.stringify(right.provenance.unsupportedSemantics),
      note: "at least one side has a BLOCKING unsupported semantic — this alone rules out EXACT/SEMANTIC parity",
    });
  }

  return {
    leftPlatform: left.sourcePlatform,
    rightPlatform: right.sourcePlatform,
    leftIrHash,
    rightIrHash,
    identical: leftIrHash === rightIrHash,
    differences,
  };
}
