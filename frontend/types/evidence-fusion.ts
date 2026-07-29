// types/evidence-fusion.ts
// Sprint 15D.11 - Multi-Source Evidence Fusion Engine domain types.
// Standalone: consumes Sprint 15D.4's EvidenceItem (unmodified), grouped by
// which kind of provider produced it, and produces a deterministic
// FusedEvidence[] - the new canonical evidence format sitting between raw
// evidence collection and Sprint 15D.4's EvidenceRankingService (also
// unmodified - see EvidenceFusionService.toEvidenceItems() for how
// fusion's richer output is projected back down to the EvidenceItem[]
// shape ranking already expects, so ranking itself never had to change).
//
// EvidenceSourceType is the extensibility seam Task 6 asks for: adding a
// future News/EconomicCalendar/Sentiment provider means implementing one
// of the interfaces below and tagging its collected output with the
// matching EvidenceSourceType when handing it to
// EvidenceFusionService.fuse() - zero changes to fusion's own merge logic
// are required to add a source.
import type { MarketSymbol } from "./market";
import type { EvidenceItem, EvidenceType } from "./evidence";

export type EvidenceSourceType = "market-data" | "search" | "rag" | "news" | "economic-calendar" | "sentiment";

/** One provider's already-collected evidence, tagged with what kind of provider produced it. Fusion performs no collection itself - every group here must already be a real EvidenceItem[] from an existing (or future) collector. */
export interface EvidenceSourceGroup {
  sourceType: EvidenceSourceType;
  items: readonly EvidenceItem[];
}

export interface FusedEvidence {
  /** Deterministic, derived from category + normalized claim - never random, so identical input always yields the same id across runs. */
  id: string;
  /** The representative claim text - verbatim from one contributing source, never paraphrased, reworded, or synthesized from multiple sources. */
  claim: string;
  category: EvidenceType;
  /** Every distinct source that reported this exact claim, sorted. A single-source claim has exactly one entry. */
  source: string[];
  /** Every distinct provider kind that contributed to this claim, sorted. */
  sourceType: EvidenceSourceType[];
  /** The most recent `asOf` among the merged items - see supportingData for every individual item's own timestamp; none are discarded. */
  timestamp: string;
  /** 0-100. A deterministic function of corroboration only (distinct source count) - never a provider's own self-reported confidence, since no current provider supplies one. */
  confidence: number;
  /** Lower = higher priority, mirroring EvidenceRankingService's own TYPE_PRIORITY ordering exactly. Informational only - this layer performs no ranking or reasoning. */
  priority: number;
  /** Every original EvidenceItem merged into this claim, deterministically ordered - nothing is lost during fusion. */
  supportingData: EvidenceItem[];
}

// --- Future-ready provider interfaces (Task 6) ---------------------------
// No implementation exists yet for any of these. Each mirrors
// MarketDataProvider's name/isConfigured() shape (types/market-data-
// provider.ts, unmodified) but returns EvidenceItem[] directly, since that
// is the one shape every source - present or future - ultimately reduces
// to before reaching EvidenceFusionService.fuse().

export interface EvidenceProviderRequest {
  symbol: MarketSymbol;
  /** ISO timestamp: context "as of" this time. Providers may ignore this - mirrors MarketContextRequest. */
  asOf?: string;
}

export interface NewsProvider {
  readonly name: string;
  isConfigured(): boolean;
  getNewsEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]>;
}

export interface EconomicCalendarProvider {
  readonly name: string;
  isConfigured(): boolean;
  getCalendarEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]>;
}

export interface SentimentProvider {
  readonly name: string;
  isConfigured(): boolean;
  getSentimentEvidence(request: EvidenceProviderRequest): Promise<EvidenceItem[]>;
}
