// services/evidence-sources/production-sources.ts
// The extra evidence sources the real-time Market Intelligence path uses in
// production: the economic calendar (macro), the macro drivers (cross-asset) and the SMC
// market-structure engine (technical).
// Kept free of server-only imports (both sources load their servers lazily) so the
// module graph of anything importing it stays loadable from plain scripts.

import type { EvidenceExtraSource } from "@/types/evidence-fusion";
import { EconomicCalendarEvidenceSource } from "./calendar-evidence-source";
import { MacroDriverEvidenceSource } from "./macro-driver-evidence-source";
import { SmcStructureEvidenceSource } from "./smc-evidence-source";

export function productionExtraEvidenceSources(): EvidenceExtraSource[] {
  return [new EconomicCalendarEvidenceSource(), new MacroDriverEvidenceSource(), new SmcStructureEvidenceSource()];
}
