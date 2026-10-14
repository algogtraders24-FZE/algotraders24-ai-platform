// services/evidence-sources/macro-driver-evidence-source.ts
// "cross-asset" evidence from the Macro Alignment drivers (services/macro): the
// dollar index, stocks, the AUD/JPY risk barometer, yields and real yield that move
// with the symbol, each as the plain reading the scorer already produced, plus the
// one-line alignment summary. Only drivers that actually have data become evidence;
// an unavailable driver is simply absent. The summary is labelled a rule-based
// agreement, never a forecast.
//
// All items share ONE source name (the drivers come from different feeds - the feed
// is named inside each claim) so the ranking stage's same-type/different-source
// conflict check never compares two unrelated measurements.

import type { EvidenceItem } from "@/types/evidence";
import type { EvidenceExtraSource, EvidenceProviderRequest } from "@/types/evidence-fusion";
import { alignmentLine, profileForMiSymbol, type AssetId } from "@/services/macro/macro-alignment";
import type { MacroAlignmentSnapshot } from "@/services/macro/macro-service";

export const MACRO_DRIVER_EVIDENCE_SOURCE = "AT24 macro drivers";

export interface MacroDriverEvidenceDeps {
  getSnapshot?: (asset: AssetId) => Promise<MacroAlignmentSnapshot>;
}

async function defaultGetSnapshot(asset: AssetId): Promise<MacroAlignmentSnapshot> {
  const { getMacroAlignmentSnapshot } = await import("@/services/macro/macro-service");
  return getMacroAlignmentSnapshot(asset);
}

export class MacroDriverEvidenceSource implements EvidenceExtraSource {
  readonly name = "macro-driver-evidence";
  readonly sourceType = "macro-drivers" as const;
  private readonly getSnapshot: (asset: AssetId) => Promise<MacroAlignmentSnapshot>;

  constructor(deps: MacroDriverEvidenceDeps = {}) {
    this.getSnapshot = deps.getSnapshot ?? defaultGetSnapshot;
  }

  isConfigured(): boolean {
    return true;
  }

  async collect(request: EvidenceProviderRequest): Promise<EvidenceItem[]> {
    const profile = profileForMiSymbol(request.symbol);
    if (!profile) return []; // no macro profile for this symbol: absent, not guessed
    const snap = await this.getSnapshot(profile.id);
    const retrievedAt = snap.fetchedAt;

    const items: EvidenceItem[] = snap.alignment.drivers
      .filter((d) => d.available)
      .map((d) => ({
        type: "cross-asset" as const,
        symbol: request.symbol,
        claim: `${d.detail} [${d.source}]`,
        source: MACRO_DRIVER_EVIDENCE_SOURCE,
        asOf: d.asOf ?? retrievedAt,
        retrievedAt,
        // The driver's measured reading (e.g. dollar +0.05 %): numeric backing for the claim.
        ...(d.value !== null ? { magnitude: d.value, unit: d.unit } : {}),
      }));

    if (items.length > 0 && snap.alignment.score !== null) {
      items.push({
        type: "cross-asset",
        symbol: request.symbol,
        claim: `${alignmentLine(snap.alignment)} - a rule-based agreement of drivers, not a forecast`,
        source: MACRO_DRIVER_EVIDENCE_SOURCE,
        asOf: retrievedAt,
        retrievedAt,
      });
    }
    return items;
  }
}
