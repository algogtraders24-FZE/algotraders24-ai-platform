// lib/microstructure/microstructure-evidence-explanation.ts
// Sprint D2.8.12 - Microstructure Evidence Explanation & User-Facing
// Intelligence Integration. A pure, deterministic formatter over D2.8.11's
// own MicrostructureEvidenceAssessment - it computes NOTHING (no depth
// imbalance, no volume delta, no aggressor pressure, no thresholds, no
// hypothesis direction): every field it prints is read directly off the
// already-computed assessment, including the `basis` lines D2.8.11 itself
// generated. This is the explicit architectural rule this sprint exists to
// enforce - "the presentation layer must consume the exact D2.8.11
// assessment," never a second interpretation engine.
import type { MicrostructureEvidenceAssessment, MicrostructureEvidenceStatus } from "@/types/microstructure-evidence-assessment";

const STATUS_LABEL: Record<MicrostructureEvidenceStatus, string> = {
  confirms: "CONFIRMS",
  contradicts: "CONTRADICTS",
  neutral: "NEUTRAL",
  insufficient_evidence: "INSUFFICIENT_EVIDENCE",
};

/**
 * Renders a MicrostructureEvidenceAssessment as attributed, evidence-
 * preserving explanation lines - the exact shape Phase 2/4's own examples
 * specify. Pure: identical input always produces identical output, no I/O,
 * no randomness, no recomputation of anything D2.8.11 already decided.
 */
export function formatMicrostructureEvidenceExplanation(assessment: MicrostructureEvidenceAssessment): string[] {
  const lines: string[] = ["Microstructure Evidence Relationship:"];

  if (assessment.hypothesisDirection && assessment.hypothesisDirection !== "neutral") {
    lines.push(`Hypothesis direction: ${assessment.hypothesisDirection}`);
  }
  lines.push(`Relationship: ${STATUS_LABEL[assessment.status]}`);
  lines.push("");

  // Sprint D2.8.11's own `basis` array is always real and never empty -
  // reused verbatim as the "Evidence:" detail, never re-derived from raw
  // numbers here (Phase 4: expose the underlying evidence, never
  // recalculate it).
  lines.push("Evidence:");
  for (const item of assessment.basis) lines.push(`- ${item}`);
  lines.push("");

  // Sprint D2.8.12 Phase 5 - INSUFFICIENT_EVIDENCE and NEUTRAL are
  // deliberately distinct sentences, never collapsed into one another.
  // "Insufficient" means no real signal existed to compare at all;
  // "neutral" means a real signal existed but was too small to call - see
  // assessMicrostructureEvidence()'s own distinction.
  if (assessment.status === "insufficient_evidence") {
    lines.push("Microstructure evidence is insufficient to influence the current hypothesis. No directional confirmation is assigned.");
  } else if (assessment.status === "confirms") {
    lines.push(`Current ${assessment.provider ?? "venue"} microstructure confirms the ${assessment.hypothesisDirection} hypothesis.`);
  } else if (assessment.status === "contradicts") {
    lines.push(
      `Current ${assessment.provider ?? "venue"} order-flow pressure opposes the hypothesis - microstructure does not support the current ${assessment.hypothesisDirection} hypothesis.`,
    );
  } else {
    lines.push(`Microstructure evidence is currently balanced - it neither confirms nor contradicts the ${assessment.hypothesisDirection} hypothesis.`);
  }

  // Sprint D2.8.12 Phase 3 - attribution/scope only when a real snapshot
  // was actually evaluated (assessment.provider is set even for a stale/
  // invalid/no-signal insufficient_evidence result - D2.8.11's own
  // attribution object - but genuinely absent when no snapshot existed at
  // all, in which case there is nothing real to attribute or scope).
  if (assessment.provider) {
    lines.push("");
    lines.push(`Source: ${assessment.provider}`);
    if (assessment.instrument) lines.push(`Instrument: ${assessment.instrument}`);
    if (assessment.freshness) lines.push(`Freshness: ${assessment.freshness}`);
    // Explicit, permanent reminder this evidence is venue-specific - never
    // presented as a global/all-exchange market fact (D2.8.2's rule,
    // reused verbatim here exactly as lib/microstructure/microstructure-
    // presentation.ts's own D2.8.7 evidence block already does).
    lines.push(`Scope: ${assessment.provider} venue evidence - not global market liquidity.`);
  }

  return lines;
}
