// types/marketplace.ts
// Sprint M8 - AT24 Marketplace. See
// ea-research/marketplace-research/m8-marketplace-platform/ for the full
// architecture reasoning. TrustState is the literal M7 vocabulary - never
// invent a new value here, never convert it to a score/star/percentage in
// any component that consumes it.

export type TrustState =
  | "UNVERIFIED"
  | "VALIDATION_PENDING"
  | "INCONCLUSIVE"
  | "LIMITED"
  | "UNDER_OBSERVATION"
  | "VALIDATED"
  | "INVALIDATED"
  | "SUPERSEDED";

export const TRUST_STATES: TrustState[] = [
  "UNVERIFIED",
  "VALIDATION_PENDING",
  "INCONCLUSIVE",
  "LIMITED",
  "UNDER_OBSERVATION",
  "VALIDATED",
  "INVALIDATED",
  "SUPERSEDED",
];

// Publication state is a SEPARATE axis from TrustState - never equate the
// two (M8 brief section 17/25). A listing can be PUBLISHED with
// trustState=INCONCLUSIVE.
export type PublicationState =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "EVIDENCE_PENDING"
  | "VALIDATION_PENDING"
  | "READY"
  | "PUBLISHED"
  | "SUSPENDED"
  | "RETIRED";

export const PUBLICATION_STATES: PublicationState[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "EVIDENCE_PENDING",
  "VALIDATION_PENDING",
  "READY",
  "PUBLISHED",
  "SUSPENDED",
  "RETIRED",
];

// Publicly visible states - everything else (DRAFT/SUBMITTED/UNDER_REVIEW/
// EVIDENCE_PENDING/VALIDATION_PENDING/SUSPENDED/RETIRED) is excluded from
// the public catalog and detail pages.
export const PUBLICLY_VISIBLE_STATES: PublicationState[] = ["READY", "PUBLISHED"];

export type PricingModel = "one_time" | "subscription" | "free" | "unavailable";

export interface ListingPricing {
  model: PricingModel;
  amount?: number;
  currency?: string;
  interval?: "month" | "year";
}

// --- Catalog card (lightweight - never the full Evidence/Validation/Risk/
// History artifacts; see M8_entity_relationship.md section 3) -------------
export interface MarketplaceListingSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  sellerId: string;
  sellerName: string | null;
  category: string;
  platformTag: string;
  assetTag: string;
  tags: string[];
  pricing: ListingPricing;
  trustState: TrustState | null;
  trustReasonCode: string | null;
  publicationState: PublicationState;
  versionId: string | null;
  lastEvidenceAt: string | null; // ISO string
  createdAt: string;
  updatedAt: string;
  // media[0] = square icon/logo, media[1] = wide hero/banner - a convention
  // enforced by the upload UI, not the schema (M12 branding follow-on).
  media: string[];
}

// --- Detail-page section shapes -------------------------------------------
// These mirror the REAL M2/M4/M5/M6 output shapes (see
// ea-research/marketplace-research/m{2,4,5,6}-*/*.py) closely enough that
// real data can be dropped in later without a UI rewrite. Every field is
// optional/nullable on purpose: no MarketplaceListing this sprint has any
// of this populated (product creation is forbidden), and the UI must
// render an honest "unavailable" state, never a fabricated zero.

export interface EvidenceSummary {
  evidenceId: string;
  sourceAdapter: string | null;
  evidenceClass: "HISTORICAL" | "LIVE" | null;
  tradeCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  symbol: string | null;
  timeframe: string | null;
  broker: string | null;
  netProfit: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPercent: number | null;
  totalCost: number | null;
  dataSource: string | null;
  generator: string | null;
}

export interface ValidationDimensionResult {
  validationType: string;
  status: "PASS" | "FAIL" | "WARNING" | "INCONCLUSIVE";
}

export interface ValidationSummary {
  validationId: string;
  overallStatus: "PASS" | "FAIL" | "WARNING" | "INCONCLUSIVE";
  methodologyVersion: string | null;
  dimensions: ValidationDimensionResult[]; // OUT_OF_SAMPLE, WALK_FORWARD, TEMPORAL_STABILITY, REGIME_COVERAGE, PERFORMANCE_DISTRIBUTION, PARAMETER_SENSITIVITY, SAMPLE_SIZE
}

export interface RiskSummary {
  riskAnalysisId: string;
  status: "COMPLETE" | "PARTIAL" | "INCONCLUSIVE" | "FAILED";
  maxDrawdownPercent: number | null;
  maxConsecutiveLosses: number | null;
  lossClusteredSharePct: number | null;
  recoveryEpisodes: number | null;
  expectancyPerTrade: number | null;
  profitFactor: number | null;
  totalCost: number | null;
  maxSimultaneousPositions: number | null;
  dataQuality: Record<string, string>; // dimension -> AVAILABLE|LIMITED|UNAVAILABLE|INCONCLUSIVE
}

export interface HistoryEventSummary {
  eventType: string;
  observedAt: string;
  recordedAt: string;
}

export interface HistorySummary {
  events: HistoryEventSummary[];
  observationCount: number;
  singleObservationOnly: boolean; // true unless >=2 real observations exist - never claim "stable over time" when this is true
}

export interface TrustStateInfo {
  status: TrustState;
  reasonCode: string;
  explanation: string;
  generatedAt: string | null;
}

// --- Full detail page -------------------------------------------------------
export interface MarketplaceListingDetail extends MarketplaceListingSummary {
  tradingSystemId: string | null;
  trustExplanation: string | null;
  trustInfo: TrustStateInfo | null;
  evidence: EvidenceSummary | null;
  validation: ValidationSummary | null;
  risk: RiskSummary | null;
  history: HistorySummary | null;
}

export interface MarketplaceSearchParams {
  q?: string;
  platform?: string;
  asset?: string;
  strategy?: string;
  trustState?: TrustState;
  sort?: "newest" | "recently_updated" | "price_asc" | "price_desc" | "most_recent_evidence" | "most_evidence";
  page?: number;
  pageSize?: number;
}

// Fixed filter vocabularies per M8 brief section 19 - shown as filter
// options regardless of whether any current listing matches them yet (a
// visitor should be able to see the taxonomy exists even at 0 results).
export const PLATFORM_FILTERS = ["MT5", "MT4", "cTrader", "NinjaTrader", "Crypto", "AI Engine"] as const;
export const ASSET_FILTERS = ["Gold", "Silver", "Forex", "Indices", "Crypto"] as const;
export const STRATEGY_FILTERS = ["Trend", "Breakout", "Momentum", "Mean Reversion", "Liquidity", "Scalping"] as const;

export const SORT_OPTIONS: { value: NonNullable<MarketplaceSearchParams["sort"]>; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "recently_updated", label: "Recently Updated" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "most_recent_evidence", label: "Most Recent Evidence" },
  { value: "most_evidence", label: "Most Evidence" },
];
// Deliberately absent: "Best Performing" / "Most Profitable" / "Highest
// Return" / "Best Strategy" - forbidden until a formally approved ranking
// system exists (M8 brief section 20).

export interface MarketplaceSearchResult {
  items: MarketplaceListingSummary[];
  total: number;
  page: number;
  pageSize: number;
}
