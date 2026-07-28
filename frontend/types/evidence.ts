// types/evidence.ts
// Sprint 15D.4 - Evidence Intelligence Engine domain types. Standalone
// layer: EvidenceItem is a richer, typed sibling of
// types/market-context.ts's Evidence, not a replacement - existing 15D.1
// code (MarketContextService, MarketContext, Evidence, Confidence) is
// unmodified and keeps working exactly as before. Nothing here is wired
// into that pipeline yet.
import type { MarketSymbol } from "./market";

export type EvidenceType =
  | "price"
  | "technical"
  | "news"
  | "macro"
  | "sentiment"
  | "historical-pattern"
  | "cross-asset"
  | "provider-meta";

export interface EvidenceItem {
  type: EvidenceType;
  symbol: MarketSymbol;
  claim: string;
  source: string;
  /** When the underlying fact was true (may be older than retrievedAt on a cache hit). */
  asOf: string;
  /** When this system captured it. */
  retrievedAt: string;
  /** Optional numeric backing for the claim, when the source is a raw number rather than prose. */
  magnitude?: number;
  unit?: string;
}

export interface EvidenceConflict {
  type: EvidenceType;
  symbol: MarketSymbol;
  itemA: EvidenceItem;
  itemB: EvidenceItem;
  // This slice never auto-picks a winner (no source-priority table has
  // been designed/tuned yet - see the Sprint 15D.4 design document) -
  // every detected conflict is "unresolved" for now. The type already
  // allows preferred-a/preferred-b so a future sprint can add resolution
  // logic without a breaking change.
  resolution: "preferred-a" | "preferred-b" | "unresolved";
  reason: string;
}

export interface EvidenceBundle {
  symbol: MarketSymbol;
  /** Deterministically ranked (see EvidenceRankingService.rank) - never re-ordered by a consumer. */
  items: EvidenceItem[];
  /** Never omitted; an empty array is the explicit "no conflicts found" signal. */
  conflicts: EvidenceConflict[];
  generatedAt: string;
}
