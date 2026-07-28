// services/ai/evidence/evidence-ranking.service.ts
// Sprint 15D.4 - Deterministically orders evidence by a fixed type-priority
// policy and detects same-type/same-symbol conflicts. Pure and
// side-effect-free: no clock reads, no randomness, no I/O - every
// timestamp/generatedAt value is supplied by the caller, never generated
// here, so output is reproducible from identical input.
//
// Never resolves a conflict by averaging, guessing, or picking a winner in
// this slice: every detected conflict is recorded as "unresolved" (see
// types/evidence.ts's EvidenceConflict.resolution). A source-priority
// table for auto-resolution is a deliberately deferred future capability
// (see the Sprint 15D.4 design document) - inventing tie-break weights
// without real production evidence would itself be a form of fabrication.
import type { EvidenceItem, EvidenceConflict, EvidenceBundle, EvidenceType } from "@/types/evidence";
import type { MarketSymbol } from "@/types/market";

// Fixed policy, not per-call. Lower number = higher priority = presented
// first. Rationale: a live price is the least interpretive, most factual
// evidence type available; sentiment/historical-pattern/cross-asset are
// the most interpretive.
const TYPE_PRIORITY: Record<EvidenceType, number> = {
  price: 0,
  "provider-meta": 1,
  technical: 2,
  macro: 3,
  news: 4,
  sentiment: 5,
  "historical-pattern": 6,
  "cross-asset": 7,
};

// Two magnitudes of the same evidence type are treated as agreeing when
// they differ by no more than this fraction of the larger value.
const RELATIVE_TOLERANCE = 0.005; // 0.5%

export class EvidenceRankingService {
  /**
   * Deterministic ordering: by type priority, then chronologically
   * (oldest `asOf` first) within a type, then by source name as a final,
   * stable tie-break. Never mutates the input array.
   */
  rank(items: readonly EvidenceItem[]): EvidenceItem[] {
    return [...items].sort((a, b) => {
      const typeDiff = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
      if (typeDiff !== 0) return typeDiff;
      const timeDiff = new Date(a.asOf).getTime() - new Date(b.asOf).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.source.localeCompare(b.source);
    });
  }

  /**
   * Flags disagreement among same-symbol, same-type evidence from
   * different sources. Numeric claims (both have `magnitude`) are
   * compared against a relative tolerance; purely textual claims (neither
   * has `magnitude`) are compared by exact string equality only - never a
   * semantic/fuzzy guess at whether two different sentences "mean the
   * same thing".
   */
  detectConflicts(items: readonly EvidenceItem[]): EvidenceConflict[] {
    const groups = new Map<string, EvidenceItem[]>();
    for (const item of items) {
      const key = `${item.symbol}::${item.type}`;
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }

    const conflicts: EvidenceConflict[] = [];
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const conflict = this.compare(group[i], group[j]);
          if (conflict) conflicts.push(conflict);
        }
      }
    }
    return conflicts;
  }

  private compare(a: EvidenceItem, b: EvidenceItem): EvidenceConflict | null {
    // The same source repeating itself (e.g. two claims from one provider
    // in one call) is not a disagreement between sources.
    if (a.source === b.source) return null;

    if (a.magnitude !== undefined && b.magnitude !== undefined) {
      const larger = Math.max(Math.abs(a.magnitude), Math.abs(b.magnitude));
      const diff = Math.abs(a.magnitude - b.magnitude);
      if (larger === 0 || diff / larger <= RELATIVE_TOLERANCE) return null;
      return {
        type: a.type,
        symbol: a.symbol,
        itemA: a,
        itemB: b,
        resolution: "unresolved",
        reason: `Magnitudes disagree beyond tolerance: ${a.magnitude} (${a.source}) vs ${b.magnitude} (${b.source})`,
      };
    }

    if (a.magnitude === undefined && b.magnitude === undefined && a.claim !== b.claim) {
      return {
        type: a.type,
        symbol: a.symbol,
        itemA: a,
        itemB: b,
        resolution: "unresolved",
        reason: `Claims disagree: "${a.claim}" (${a.source}) vs "${b.claim}" (${b.source})`,
      };
    }

    // One has a magnitude and the other doesn't: not comparable without
    // guessing - not treated as a conflict.
    return null;
  }

  /**
   * Produces the deterministic, ranked, conflict-annotated bundle for one
   * symbol. `generatedAt` is supplied by the caller (never Date.now()
   * here) so output is fully reproducible from identical input.
   */
  buildBundle(symbol: MarketSymbol, items: readonly EvidenceItem[], generatedAt: string): EvidenceBundle {
    const scoped = items.filter((item) => item.symbol === symbol);
    return {
      symbol,
      items: this.rank(scoped),
      conflicts: this.detectConflicts(scoped),
      generatedAt,
    };
  }
}
