// services/marketplace/factory/submissionState.ts
// Sprint M9 - Submission lifecycle state, DERIVED from MarketplaceListing's
// existing columns rather than a new stored column (see
// M9_architecture_audit.md section 5 for why: a derived value can never
// drift from the fields it's computed from, and needed zero migration).
import type { EligibilityResult } from "@/types/marketplace-factory";
import type { SubmissionState } from "@/types/marketplace-factory";

export interface ListingLifecycleFields {
  publicationState: string;
  evidenceId: string | null;
  validationId: string | null;
  riskAnalysisId: string | null;
  trustState: string | null;
}

export function deriveSubmissionState(listing: ListingLifecycleFields, eligibility?: EligibilityResult): SubmissionState {
  if (listing.publicationState === "PUBLISHED") return "PUBLISHED";
  if (listing.publicationState === "SUSPENDED" || listing.publicationState === "RETIRED") return "UNPUBLISHED";
  if (listing.publicationState === "DRAFT") return "DRAFT";

  // Past DRAFT: the submission has been sent for processing. Walk the
  // ingestion chain forward from whichever reference field is still missing.
  if (!listing.evidenceId) return "INGESTION_PENDING";
  if (!listing.validationId) return "EVIDENCE_PENDING";
  if (!listing.riskAnalysisId) return "VALIDATION_PENDING";
  if (!listing.trustState) return "RISK_ANALYSIS_PENDING";

  if (eligibility) return eligibility.eligible ? "ELIGIBLE" : "REJECTED";
  return "TRUST_PENDING"; // trust exists but eligibility hasn't been (re-)evaluated yet
}
