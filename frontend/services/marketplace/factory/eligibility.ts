// services/marketplace/factory/eligibility.ts
// Sprint M9 - Publication eligibility gate. A named, versioned, CATEGORICAL
// policy - never a numeric quality threshold (M9 brief section 10/13
// explicitly forbid "PF > 1 = validated" style rules).
//
// Sprint M12 branding follow-on (v2) - widened deliberately, after real
// production experience: REGIME_COVERAGE and PARAMETER_SENSITIVITY are
// structurally incomplete for EVERY product in this program right now (no
// regime classifier exists anywhere yet; parameter-sensitivity needs new
// backtests nobody has run for any product, including G01). Under the v1
// policy below, that meant NO product - regardless of quality - could
// ever reach eligibility, which isn't a quality bar, it's a program-wide
// infrastructure gap being mistaken for a per-product rejection. v2 policy:
// publication no longer requires FULL conclusiveness, only that Evidence/
// Validation/Risk genuinely ran and didn't fail outright. What this does
// NOT change: the Trust State badge itself is never softened or hidden -
// INCONCLUSIVE still displays as INCONCLUSIVE, everywhere, always. This
// widens what's publishable, not what's claimed to be true.
import type { EligibilityReasonCode, EligibilityResult } from "@/types/marketplace-factory";

export const MARKETPLACE_ELIGIBILITY_RULESET_VERSION = "M9-eligibility-v2";

// VALIDATED/UNDER_OBSERVATION are the "fully conclusive" states.
// INCONCLUSIVE is now also accepted (v2) - it means "verified, validation
// ran, but not every dimension could be computed yet," not "failed" or
// "not run." UNVERIFIED/VALIDATION_PENDING/LIMITED/INVALIDATED/SUPERSEDED
// still block - those are genuine absence, an active negative finding, or
// a stale result, not the same thing as "incomplete."
const ELIGIBLE_TRUST_STATES = new Set(["VALIDATED", "UNDER_OBSERVATION", "INCONCLUSIVE"]);

export interface EligibilityInput {
  tradingSystemId: string | null;
  versionId: string | null;
  evidenceId: string | null;
  validationId: string | null;
  validationOverallStatus?: string | null; // PASS | FAIL | WARNING | INCONCLUSIVE, if known
  riskAnalysisId: string | null;
  riskStatus?: string | null; // COMPLETE | PARTIAL | INCONCLUSIVE | FAILED, if known
  trustState: string | null;
  sellerId: string;
  requestingUserId: string;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: { code: EligibilityReasonCode; detail: string }[] = [];

  if (input.requestingUserId !== input.sellerId) {
    reasons.push({ code: "OWNERSHIP_FAILURE", detail: "The requesting user does not own this listing's TradingSystem/Version." });
  }

  if (!input.tradingSystemId || !input.versionId) {
    reasons.push({ code: "VERSION_INVALID", detail: "No TradingSystem/Version is bound to this listing." });
  }

  if (!input.evidenceId) {
    reasons.push({ code: "MISSING_EVIDENCE", detail: "No AT24 Evidence has been discovered for this Version." });
  }

  // v2: FAIL is still an active negative finding and still blocks.
  // INCONCLUSIVE ran and genuinely didn't fail - accepted, same reasoning
  // as the trust-state widening above.
  if (!input.validationId || input.validationOverallStatus === "FAIL") {
    reasons.push({
      code: "VALIDATION_INCONCLUSIVE",
      detail: input.validationId
        ? `Validation overallStatus is FAIL.`
        : "No AT24 Validation result exists for this Version.",
    });
  }

  // v2: FAILED is still an active negative finding and still blocks.
  // PARTIAL/INCONCLUSIVE ran and produced real (if incomplete) data -
  // accepted.
  if (!input.riskAnalysisId || input.riskStatus === "FAILED") {
    reasons.push({
      code: "RISK_ANALYSIS_INCOMPLETE",
      detail: input.riskAnalysisId ? `RiskAnalysis status is FAILED.` : "No AT24 RiskAnalysis exists for this Version.",
    });
  }

  if (!input.trustState || !ELIGIBLE_TRUST_STATES.has(input.trustState)) {
    reasons.push({
      code: "TRUST_STATUS_BLOCKED",
      detail: `Trust State is ${input.trustState ?? "not yet evaluated"} -- publication requires one of: ${[...ELIGIBLE_TRUST_STATES].join(", ")}.`,
    });
  }

  // "Required marketplace fields present" (title/description) is enforced
  // earlier, at the SCHEMA_VALIDATION ingestion stage (see ingestion.ts) --
  // not repeated here as an eligibility reason, since the brief's own
  // eligibility reason-code list (section 13) has no code for it and
  // eligibility should describe the Evidence->Validation->Risk->Trust
  // chain plus ownership/version, not re-litigate structural validation
  // that already happened earlier in the pipeline.

  return { eligible: reasons.length === 0, rulesetVersion: MARKETPLACE_ELIGIBILITY_RULESET_VERSION, reasons };
}
