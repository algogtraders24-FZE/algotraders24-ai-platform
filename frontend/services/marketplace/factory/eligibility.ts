// services/marketplace/factory/eligibility.ts
// Sprint M9 - Publication eligibility gate. A named, versioned, CATEGORICAL
// policy - never a numeric quality threshold (M9 brief section 10/13
// explicitly forbid "PF > 1 = validated" style rules). The trust-state
// allowlist below is the one real policy decision this sprint makes, and
// it is exactly why the real G01 fixture (trustState=INCONCLUSIVE) is
// correctly NOT eligible - see M9_product_factory.md section 5.
import type { EligibilityReasonCode, EligibilityResult } from "@/types/marketplace-factory";

export const MARKETPLACE_ELIGIBILITY_RULESET_VERSION = "M9-eligibility-v1";

// Only these M7 trust states represent "the full Evidence->Validation->Risk
// chain came back sufficient" - every other state (including INCONCLUSIVE,
// which is not a negative judgment, just an incomplete one) blocks
// publication until it changes. This is a categorical allowlist of M7's
// own existing vocabulary, not an invented numeric bar.
const ELIGIBLE_TRUST_STATES = new Set(["VALIDATED", "UNDER_OBSERVATION"]);

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

  if (!input.validationId || (input.validationOverallStatus && input.validationOverallStatus !== "PASS" && input.validationOverallStatus !== "WARNING")) {
    reasons.push({
      code: "VALIDATION_INCONCLUSIVE",
      detail: input.validationId
        ? `Validation overallStatus is ${input.validationOverallStatus ?? "unknown"}, not PASS/WARNING.`
        : "No AT24 Validation result exists for this Version.",
    });
  }

  if (!input.riskAnalysisId || (input.riskStatus && input.riskStatus !== "COMPLETE")) {
    reasons.push({
      code: "RISK_ANALYSIS_INCOMPLETE",
      detail: input.riskAnalysisId ? `RiskAnalysis status is ${input.riskStatus ?? "unknown"}, not COMPLETE.` : "No AT24 RiskAnalysis exists for this Version.",
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
