// services/intelligence/overview/evidence-coverage.ts
// Which of the eight evidence types actually reached an answer - shown on the AI
// Signals cards so "Data quality" and "Risk" can be read against what the engine
// really had to work with. Pure passthrough of the answer's own evidence.

import type { EvidenceConflict, EvidenceItem, EvidenceType } from "@/types/evidence";

export const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = ["price", "technical", "news", "macro", "sentiment", "historical-pattern", "cross-asset", "provider-meta"];

export function presentEvidenceTypes(answer: {
  supportingEvidence: readonly EvidenceItem[];
  opposingEvidence: readonly EvidenceItem[];
  unresolvedConflicts: readonly EvidenceConflict[];
}): EvidenceType[] {
  const seen = new Set<EvidenceType>();
  for (const i of answer.supportingEvidence) seen.add(i.type);
  for (const i of answer.opposingEvidence) seen.add(i.type);
  for (const c of answer.unresolvedConflicts) {
    seen.add(c.itemA.type);
    seen.add(c.itemB.type);
  }
  return ALL_EVIDENCE_TYPES.filter((t) => seen.has(t));
}
