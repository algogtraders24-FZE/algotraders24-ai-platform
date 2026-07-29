// services/ai/evidence-fusion.service.ts
// Sprint 15D.11 - Multi-Source Evidence Fusion Engine. Standalone,
// deterministic, performs NO reasoning: merges duplicate claims across
// provider sources into one FusedEvidence per distinct (category, claim)
// pair, preserving every original EvidenceItem, source, and timestamp.
//
// Duplicate detection is exact-text-equality only (trimmed, whitespace-
// collapsed, case-insensitive) - never a fuzzy/semantic match, and never a
// numeric-tolerance comparison. That mirrors EvidenceRankingService's own
// stated philosophy for textual claims ("compared by exact string equality
// only - never a semantic/fuzzy guess") and keeps the two layers'
// responsibilities distinct: fusion merges literally-identical statements
// from different sources; EvidenceRankingService/ReasoningEngineService
// (both unmodified) still own all near-equal-but-not-identical numeric
// disagreement detection, exactly as before this sprint.
//
// No clock reads, no randomness: the merge itself only ever reads the
// `asOf` strings already present on the input items, and the final output
// order is sorted deterministically rather than relying on callers to pass
// groups/items in a stable order.
import type { EvidenceItem, EvidenceType } from "@/types/evidence";
import type { MarketSymbol } from "@/types/market";
import type { EvidenceSourceGroup, EvidenceSourceType, FusedEvidence } from "@/types/evidence-fusion";

// Mirrors EvidenceRankingService's own TYPE_PRIORITY exactly (lower number
// = higher priority = more factual). Duplicated locally rather than
// imported - the same convention ALL_EVIDENCE_TYPES already follows across
// reasoning-engine.service.ts and confidence-engine.service.ts: a small,
// stable literal is preferred here over introducing a shared module
// between otherwise-standalone engines.
const CATEGORY_PRIORITY: Record<EvidenceType, number> = {
  price: 0,
  "provider-meta": 1,
  technical: 2,
  macro: 3,
  news: 4,
  sentiment: 5,
  "historical-pattern": 6,
  "cross-asset": 7,
};

// Untuned, deterministic round numbers - same style as every prior 15D
// engine's thresholds. A claim reported by only one source starts at a
// moderate baseline; each additional distinct corroborating source raises
// confidence, capped at 100. The same source repeating itself never counts
// as corroboration (see dedupeKey/toFusedEvidence: `source` is a
// deduplicated Set, not a raw item count).
const BASE_CONFIDENCE = 60;
const CORROBORATION_BONUS = 20;

interface Accumulator {
  category: EvidenceType;
  items: EvidenceItem[];
  sourceTypes: Set<EvidenceSourceType>;
}

export class EvidenceFusionService {
  /**
   * Merges evidence from any number of already-collected, source-tagged
   * groups into a deterministic FusedEvidence[]. Adding a new source only
   * ever means adding another EvidenceSourceGroup to `groups` - this
   * method's own merge logic never needs to change.
   */
  fuse(groups: readonly EvidenceSourceGroup[]): FusedEvidence[] {
    const accumulators = new Map<string, Accumulator>();

    for (const group of groups) {
      for (const item of group.items) {
        const key = this.dedupeKey(item);
        const existing = accumulators.get(key);
        if (existing) {
          existing.items.push(item);
          existing.sourceTypes.add(group.sourceType);
        } else {
          accumulators.set(key, { category: item.type, items: [item], sourceTypes: new Set([group.sourceType]) });
        }
      }
    }

    const fused = Array.from(accumulators.entries()).map(([key, acc]) => this.toFusedEvidence(key, acc));
    // Sorted explicitly rather than relying on Map insertion order, so
    // output is identical regardless of the order callers pass groups in.
    return fused.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  /**
   * Projects the canonical FusedEvidence[] back down to the EvidenceItem[]
   * shape EvidenceRankingService.buildBundle() already expects. This
   * absorbs the shape difference here so ranking's own logic never needed
   * to change. `retrievedAt` is the caller's single pipeline-wide
   * timestamp, exactly as EvidenceCollectorService already accepts today.
   */
  toEvidenceItems(symbol: MarketSymbol, fused: readonly FusedEvidence[], retrievedAt: string): EvidenceItem[] {
    return fused.map((item) => {
      // supportingData is already deterministically sorted (see
      // toFusedEvidence) - its first entry is the same representative item
      // `claim` was taken from, so magnitude/unit (when present) stay
      // consistent with the claim they actually back, never mixed across
      // sources.
      const representative = item.supportingData[0];
      return {
        type: item.category,
        symbol,
        claim: item.claim,
        source: item.source.join(", "),
        asOf: item.timestamp,
        retrievedAt,
        magnitude: representative?.magnitude,
        unit: representative?.unit,
      };
    });
  }

  private normalizeClaim(claim: string): string {
    return claim.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private dedupeKey(item: EvidenceItem): string {
    return `${item.type}::${this.normalizeClaim(item.claim)}`;
  }

  private toFusedEvidence(key: string, acc: Accumulator): FusedEvidence {
    // Sorted by source name (then asOf) so the "representative" item -
    // used for the displayed claim text and for magnitude/unit in
    // toEvidenceItems() - is chosen deterministically, never by
    // input/arrival order.
    const sortedItems = [...acc.items].sort((a, b) => a.source.localeCompare(b.source) || a.asOf.localeCompare(b.asOf));
    const sources = Array.from(new Set(sortedItems.map((item) => item.source))).sort();
    const sourceTypes = Array.from(acc.sourceTypes).sort();
    const latestTimestamp = sortedItems.reduce(
      (latest, item) => (new Date(item.asOf).getTime() > new Date(latest).getTime() ? item.asOf : latest),
      sortedItems[0].asOf,
    );

    return {
      id: key,
      claim: sortedItems[0].claim,
      category: acc.category,
      source: sources,
      sourceType: sourceTypes,
      timestamp: latestTimestamp,
      confidence: Math.min(100, BASE_CONFIDENCE + (sources.length - 1) * CORROBORATION_BONUS),
      priority: CATEGORY_PRIORITY[acc.category],
      supportingData: sortedItems,
    };
  }
}
