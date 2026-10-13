// services/intelligence/overview/evidence-coverage.ts
// Which of the eight evidence types the analysis actually had - shown on the AI
// Signals cards so "Data quality" and "Risk" can be read against what the engine
// really had to work with. Pure passthrough of the evidence bundle.

import type { EvidenceItem, EvidenceType } from "@/types/evidence";

export const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = ["price", "technical", "news", "macro", "sentiment", "historical-pattern", "cross-asset", "provider-meta"];

/** Types in the full evidence bundle the analysis ran on (NOT the hypothesis-cited subset the verified answer carries). */
export function presentEvidenceTypes(items: readonly Pick<EvidenceItem, "type">[]): EvidenceType[] {
  const seen = new Set<EvidenceType>(items.map((i) => i.type));
  return ALL_EVIDENCE_TYPES.filter((t) => seen.has(t));
}
