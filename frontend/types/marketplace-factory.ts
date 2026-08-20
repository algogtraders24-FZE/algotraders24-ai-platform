// types/marketplace-factory.ts
// Sprint M9 - Product Factory types. See ea-research/marketplace-research/
// m9-product-factory/M9_product_factory.md for the full architecture.
//
// SellerClaim is kept structurally distinct from the AT24-computed summary
// types (EvidenceSummary/ValidationSummary/RiskSummary in
// types/marketplace.ts) on purpose - a seller's free-text claim can never
// be assigned to an AT24-computed field without a TypeScript compile
// error, which is the type-level enforcement of the seller-claim-vs-AT24-
// fact boundary (M9 brief section 17).

export type PlatformName = "MT5" | "MT4" | "cTrader" | "NinjaTrader" | "Crypto" | "AI Engine";

export const PLATFORM_NAMES: PlatformName[] = ["MT5", "MT4", "cTrader", "NinjaTrader", "Crypto", "AI Engine"];

export type CapabilityStatus = "AVAILABLE" | "UNAVAILABLE";

// The flat shape ingestion.ts actually consumes from a platform's evidence
// discovery, independent of how any one platform's own snapshot happens to
// be structured internally (MT5's nests M3/M4/M5/M7; a future platform's
// adapter maps its own shape into this same flat contract). This is what
// lets ingestion.ts call `adapter.discoverEvidence(...)` with zero
// knowledge of which platform it's talking to (M9 brief section 27).
export interface PlatformEvidenceSnapshot {
  evidenceId: string;
  evidenceHash: string;
  validationId: string;
  validationHash: string;
  validationOverallStatus: string;
  riskAnalysisId: string;
  riskAnalysisHash: string;
  riskStatus: string;
  trustState: string;
  trustReasonCode: string;
  trustExplanation: string;
  trustStatusId: string;
  lastEvidenceAt: string | null;
}

export interface PlatformAdapter {
  platform: PlatformName;
  productTypes: string[];
  sourceFormats: string[];
  evidenceIngestionSupported: boolean;
  validationCapability: CapabilityStatus;
  requiredArtifacts: string[];
  supportedMarkets: string[];
  supportedTimeframes: string[];
  // Every adapter implements this, even the five with
  // evidenceIngestionSupported=false (which just return null) - so
  // ingestion.ts never needs an `if (platform === "X")` to decide who to
  // ask.
  discoverEvidence: (tradingSystemId: string, versionId: string) => PlatformEvidenceSnapshot | null;
}

// --- Submission lifecycle (derived, not stored - see submissionState.ts) ---
export type SubmissionState =
  | "DRAFT"
  | "SUBMITTED"
  | "INGESTION_PENDING"
  | "EVIDENCE_PENDING"
  | "VALIDATION_PENDING"
  | "RISK_ANALYSIS_PENDING"
  | "TRUST_PENDING"
  | "ELIGIBLE"
  | "REJECTED"
  | "PUBLISHED"
  | "UNPUBLISHED";

export const SUBMISSION_STATES: SubmissionState[] = [
  "DRAFT", "SUBMITTED", "INGESTION_PENDING", "EVIDENCE_PENDING", "VALIDATION_PENDING",
  "RISK_ANALYSIS_PENDING", "TRUST_PENDING", "ELIGIBLE", "REJECTED", "PUBLISHED", "UNPUBLISHED",
];

// --- Seller claim (marketing content only - never AT24 fact) ---------------
export interface SellerClaim {
  kind: "SELLER_CLAIM";
  text: string;
}

// --- Ingestion pipeline stages ----------------------------------------------
export type IngestionStage =
  | "SCHEMA_VALIDATION"
  | "PLATFORM_VALIDATION"
  | "TRADING_SYSTEM_BINDING"
  | "VERSION_BINDING"
  | "EVIDENCE_DISCOVERY"
  | "VALIDATION_DISCOVERY"
  | "RISK_DISCOVERY"
  | "HISTORY_DISCOVERY"
  | "TRUST_EVALUATION";

export type FailedAtStage = `FAILED_AT_${IngestionStage}`;

export interface StageResult {
  stage: IngestionStage;
  status: "PASS" | "FAIL";
  detail: string;
}

export interface IngestionResult {
  stages: StageResult[];
  failedAt: FailedAtStage | null;
  evidenceId: string | null;
  evidenceHash: string | null;
  validationId: string | null;
  validationHash: string | null;
  riskAnalysisId: string | null;
  riskAnalysisHash: string | null;
  trustState: string | null;
  trustReasonCode: string | null;
  trustExplanation: string | null;
  trustStatusId: string | null;
  lastEvidenceAt: string | null;
  // Surfaced so a caller (the submit route) can feed evaluateEligibility()
  // without reaching back into adapter internals - not persisted on
  // MarketplaceListing itself, M4/M5's own outcome vocabulary.
  validationOverallStatus: string | null;
  riskStatus: string | null;
}

// --- Eligibility -------------------------------------------------------------
export type EligibilityReasonCode =
  | "MISSING_EVIDENCE"
  | "VALIDATION_INCONCLUSIVE"
  | "RISK_ANALYSIS_INCOMPLETE"
  | "TRUST_STATUS_BLOCKED"
  | "VERSION_INVALID"
  | "OWNERSHIP_FAILURE";

export interface EligibilityResult {
  eligible: boolean;
  rulesetVersion: string;
  reasons: { code: EligibilityReasonCode; detail: string }[];
}

// --- Rejection ---------------------------------------------------------------
export interface RejectionRecord {
  status: "REJECTED";
  stage: IngestionStage | "ELIGIBILITY";
  reasonCode: string;
  rulesetVersion?: string;
  explanation: string;
  timestamp: string;
}
