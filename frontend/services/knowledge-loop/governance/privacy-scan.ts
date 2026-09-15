// services/knowledge-loop/governance/privacy-scan.ts
// Sprint K4.2-A — AT24 Knowledge Governance: candidate-creation privacy scan.
// Contract: KNOWLEDGE_GOVERNANCE_CONTRACT.md §7.2 (block-on-hit, beta =
// reject — no redaction, no partial creation). Runs BEFORE a candidate row
// is ever inserted (K0.5: "no candidate bearing user-specific or sensitive
// content is ever created").
//
// Reuses the classifier's PII/secret regex families (K4.1 §2.7's own
// recommendation) rather than duplicating them — `SENSITIVE` +
// `ACCOUNT_SPECIFIC` are exported from classify.ts for exactly this reuse.
// Adds 3 checks §7.2 asks for that classify.ts doesn't need for its own
// purpose: a raw internal-id (cuid) leak, phone numbers, IBAN.
//
// Full-name and postal-address detection are a DISCLOSED, INTENTIONAL GAP —
// see K4.2A_CANDIDATE_CAPTURE.md §2.3 / OQ-K4.2A-1. No reliable low-false-
// positive regex exists for either in free text; a wrong heuristic here
// would either miss real PII or block ordinary product text.

import { SENSITIVE, ACCOUNT_SPECIFIC } from "../classifier/classify";
import { scanForForbiddenLanguage } from "@/lib/ai/compliance";

// classify.ts's ACCOUNT_SPECIFIC is keyed on first-person "my X" — correct
// for detecting a live user asking about their OWN account, but a proposed
// candidate's TEXT (proposedAnswer especially) that leaks an account detail
// reads second-person or as a bare reference ("your order #12345", K0.5
// §7.2's own literal example). A second, narrower pattern covers that
// direction without touching the locked classifier.
const CANDIDATE_ACCOUNT_REFERENCE =
  /\byour (account|subscription|plan|order|purchase|licen[cs]e|invoice|billing|payment|receipt|card|email|profile|password)\b|\b(account|order|invoice|licen[cs]e|ticket)\s*#\s*\w+/i;

// a Prisma default cuid() — 'c' + 24+ lowercase alphanumerics. Every id in
// this schema (Knowledge.id, User.id, conversation/message ids, license/
// invoice ids — all cuid()-defaulted) has this shape, so this single pattern
// covers "a userId/conversationId/licenseKey/invoiceId value" (§7.2) without
// needing a format specific to each field, none of which is fixed anyway.
const INTERNAL_ID_SHAPE = /\bc[a-z0-9]{24,}\b/i;

// conservative: 10+ digits with common phone separators, not just any long
// number (that's already covered by SENSITIVE's card-number pattern).
const PHONE_NUMBER =
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}\b/;

// IBAN: 2 letters (country) + 2 digits (check) + 11-30 alphanumerics.
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i;

export interface PrivacyScanResult {
  blocked: boolean;
  /** human-readable reasons, one per distinct check that hit. Empty when
   *  blocked === false. */
  reasons: string[];
}

/** K0.5 §7.2 — run before any candidate is created. Block-on-hit. */
export function scanCandidatePrivacy(text: string): PrivacyScanResult {
  const reasons: string[] = [];
  if (SENSITIVE.test(text)) {
    reasons.push("email, API key/token, card number, or SSN pattern detected");
  }
  if (ACCOUNT_SPECIFIC.test(text) || CANDIDATE_ACCOUNT_REFERENCE.test(text)) {
    reasons.push("account-specific reference detected (e.g. \"your order #\")");
  }
  if (INTERNAL_ID_SHAPE.test(text)) {
    reasons.push("a raw internal id (user/conversation/license/invoice-shaped) was found in the text");
  }
  if (PHONE_NUMBER.test(text)) {
    reasons.push("phone number pattern detected");
  }
  if (IBAN.test(text)) {
    reasons.push("IBAN pattern detected");
  }
  return { blocked: reasons.length > 0, reasons };
}

/** K0.5 §7.2 — forbidden trading language is a WARN, not a block, at
 *  creation time (an admin must resolve it before approval, K4.2-B). Never
 *  gates `propose()`. */
export function scanCandidateForbiddenLanguage(text: string): string[] {
  return scanForForbiddenLanguage(text);
}
