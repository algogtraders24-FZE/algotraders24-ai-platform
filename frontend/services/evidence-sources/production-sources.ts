// services/evidence-sources/production-sources.ts
// The extra evidence sources the real-time Market Intelligence path uses in
// production: the economic calendar (macro) and the macro drivers (cross-asset).
// Kept free of server-only imports (both sources load their servers lazily) so the
// module graph of anything importing it stays loadable from plain scripts.

import type { EvidenceExtraSource } from "@/types/evidence-fusion";
import { EconomicCalendarEvidenceSource } from "./calendar-evidence-source";
import { MacroDriverEvidenceSource } from "./macro-driver-evidence-source";

export function productionExtraEvidenceSources(): EvidenceExtraSource[] {
  return [new EconomicCalendarEvidenceSource(), new MacroDriverEvidenceSource()];
}
