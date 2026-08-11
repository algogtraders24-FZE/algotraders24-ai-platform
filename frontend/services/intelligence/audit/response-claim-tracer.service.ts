// services/intelligence/audit/response-claim-tracer.service.ts
// Sprint D2.6.9 - Verified Intelligence Audit, Explainability & Answer
// Traceability. Sprint §9: a deterministic response-TRACEABILITY
// checker, NOT another reasoning engine and NOT a second LLM judging the
// first one's output. Every rule below reuses the exact extraction/
// matching logic AIResponseIntegrityService (D2.6.5) already validates
// against - additively exported from that file for this purpose, never
// duplicated or reimplemented.
//
// The system must distinguish two genuinely different failure shapes:
//   - "unsupported": the response mentions something (a number, an
//     indicator, a historical claim) that has NO real counterpart
//     anywhere in the verified context - the model said something that
//     was simply never there.
//   - "conflicting": the response DIRECTLY CONTRADICTS a real, known
//     value or state (a wrong price close enough to be clearly
//     referencing a real one, a different real instrument named
//     instead of the one being discussed, over-certainty against a real
//     unresolved conflict/insufficient-intelligence state, or the
//     Intelligence Score restated as a probability of profit - a claim
//     that actively misstates something the system DOES know).
// "supported" claims match a real value/state exactly (within the same
// documented tolerances AIResponseIntegrityService already uses).
// "unverifiable" is reserved for a narrow, explicitly documented set of
// hedging/qualitative markers this V1 heuristic does not attempt to
// resolve either way - see UNVERIFIABLE_MARKER_PATTERN below. This file
// deliberately does NOT attempt unrestricted natural-language semantic
// reasoning over arbitrary prose (sprint's own explicit instruction).
import type { IntelligenceEnvelope } from "@/types/intelligence-envelope";
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";
import type { ClaimTraceCategory, ClaimTraceItem, ResponseClaimTrace } from "@/types/intelligence-audit-trace";
import { listCanonicalInstruments } from "@/lib/market-data/instrument-catalog";
import {
  stripIsoTimestamps,
  extractPercentClaims,
  extractPriceLikeClaims,
  allowedPercentValues,
  allowedPriceValues,
  collectRealNumbers,
  withinTolerance,
  GUARANTEED_PROFIT_PATTERNS,
  HISTORICAL_CLAIM_PATTERN,
  HIGH_CERTAINTY_PATTERN,
  FOREIGN_INDICATOR_PATTERNS,
  PRICE_CLAIM_RELATIVE_TOLERANCE,
  PERCENT_CLAIM_ABSOLUTE_TOLERANCE,
} from "@/services/intelligence/chat/ai-response-integrity.service";

export const RESPONSE_CLAIM_TRACE_VERSION = "1.0.0";

/**
 * Deliberately narrow, documented "V1 heuristic" (same honesty labeling
 * as every other threshold constant in this program): a claim is
 * "conflicting" (not merely "unsupported") when a stated number is
 * plausibly referencing a real value but wrong, vs. a totally arbitrary
 * number with nothing real nearby. This band is wider than the pass
 * tolerance and narrower than "anything at all" - untuned, real
 * production traffic doesn't exist yet to tune it against.
 */
const CONFLICTING_NUMERIC_BAND = 0.2; // 20%

/** Hedging/qualitative language this checker deliberately does not resolve as true or false - flagged honestly as unverifiable rather than silently skipped or forced into supported/unsupported. */
const UNVERIFIABLE_MARKER_PATTERN = /\bseems\b|\bmight\b|\bcould potentially\b|\bappears to\b|\bpossibly\b|\bfeels\b/i;

function pushClaim(claims: ClaimTraceItem[], category: ClaimTraceCategory, claimText: string, basis: string): void {
  claims.push({ category, claimText, basis });
}

function traceNumericClaims(text: string, dc: IntelligenceDecisionContext, claims: ClaimTraceItem[]): void {
  const realNumbers = collectRealNumbers(dc);
  const allowedPercents = [...allowedPercentValues(dc), ...realNumbers];
  for (const claim of extractPercentClaims(text)) {
    const exact = allowedPercents.some((real) => Math.abs(claim - real) <= PERCENT_CLAIM_ABSOLUTE_TOLERANCE);
    if (exact) {
      pushClaim(claims, "supported", `${claim}%`, "Matches a real percentage in the verified context (within documented tolerance)");
      continue;
    }
    const plausible = allowedPercents.some((real) => real !== 0 && Math.abs(claim - real) / Math.max(Math.abs(real), 1) <= CONFLICTING_NUMERIC_BAND);
    if (plausible) {
      pushClaim(claims, "conflicting", `${claim}%`, "Close to a real percentage in the verified context but outside the documented tolerance - directly misstates a known value");
    } else {
      pushClaim(claims, "unsupported", `${claim}%`, "Does not match any real percentage anywhere in the verified context");
    }
  }

  const allowedPrices = [...allowedPriceValues(dc), ...realNumbers];
  for (const claim of extractPriceLikeClaims(text)) {
    const exact = allowedPrices.some((real) => withinTolerance(claim, real, PRICE_CLAIM_RELATIVE_TOLERANCE));
    if (exact) {
      pushClaim(claims, "supported", String(claim), "Matches a real price/range/evidence magnitude in the verified context");
      continue;
    }
    const plausible = allowedPrices.some((real) => withinTolerance(claim, real, CONFLICTING_NUMERIC_BAND));
    if (plausible) {
      pushClaim(claims, "conflicting", String(claim), "Close to a real value in the verified context but outside the documented tolerance - directly misstates a known value");
    } else {
      pushClaim(claims, "unsupported", String(claim), "Does not match any real price/range/evidence magnitude anywhere in the verified context");
    }
  }
}

function traceSymbolClaims(text: string, envelopeSymbol: string, claims: ClaimTraceItem[]): void {
  const otherRealSymbols = listCanonicalInstruments()
    .map((i) => i.id)
    .filter((id) => id !== envelopeSymbol);
  const tokens = new Set(text.match(/\b[A-Z]{3,10}\b/g) ?? []);
  for (const token of tokens) {
    if (otherRealSymbols.includes(token)) {
      pushClaim(claims, "conflicting", token, `Names a different real instrument (${token}) than the one actually analyzed (${envelopeSymbol})`);
    }
  }
}

function traceDirectionalAndProfitClaims(text: string, claims: ClaimTraceItem[]): void {
  for (const pattern of GUARANTEED_PROFIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      pushClaim(claims, "conflicting", match[0], "Directly contradicts the permanent rule that the Intelligence Score/analysis is never a probability or guarantee of profit");
    }
  }
}

function traceIndicatorClaims(text: string, dc: IntelligenceDecisionContext, claims: ClaimTraceItem[]): void {
  for (const pattern of FOREIGN_INDICATOR_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      pushClaim(claims, "unsupported", match[0], "References an indicator this platform's MarketState engine never computes - nothing to verify against");
    }
  }
  if (/\brsi\b/i.test(text) && dc.currentState.rsi14 === undefined) {
    pushClaim(claims, "unsupported", "RSI", "Mentions RSI but no rsi14 value was actually computed for this analysis (insufficient candles)");
  }
}

function traceHistoricalClaims(text: string, dc: IntelligenceDecisionContext, claims: ClaimTraceItem[]): void {
  const match = text.match(HISTORICAL_CLAIM_PATTERN);
  if (!match) return;
  if (dc.historicalContext.status !== "available") {
    pushClaim(claims, "unsupported", match[0], `Makes a historical-performance claim while no real historical validation segment is available (status: "${dc.historicalContext.status}")`);
    return;
  }
  const claimedPercents = extractPercentClaims(text);
  const realRate = dc.historicalContext.validatedRate !== undefined ? dc.historicalContext.validatedRate * 100 : undefined;
  if (realRate !== undefined && claimedPercents.length > 0) {
    const anyExact = claimedPercents.some((c) => Math.abs(c - realRate) <= PERCENT_CLAIM_ABSOLUTE_TOLERANCE);
    if (!anyExact) {
      pushClaim(claims, "conflicting", match[0], `Historical-performance claim does not match the real validated rate (${realRate}%) in the verified context`);
      return;
    }
  }
  pushClaim(claims, "supported", match[0], "Historical-performance claim is consistent with a real, available historical validation segment");
}

function traceCertaintyClaims(text: string, dc: IntelligenceDecisionContext, claims: ClaimTraceItem[]): void {
  const match = text.match(HIGH_CERTAINTY_PATTERN);
  if (!match) return;
  if (dc.unresolvedConflicts.length > 0) {
    pushClaim(claims, "conflicting", match[0], `Asserts high certainty while ${dc.unresolvedConflicts.length} real unresolved evidence conflict(s) exist`);
    return;
  }
  if (dc.state === "insufficient-intelligence") {
    pushClaim(claims, "conflicting", match[0], 'Asserts high certainty while the decision state is "insufficient-intelligence"');
  }
}

function traceUnverifiableClaims(text: string, claims: ClaimTraceItem[]): void {
  const match = stripIsoTimestamps(text).match(UNVERIFIABLE_MARKER_PATTERN);
  if (match) {
    pushClaim(claims, "unverifiable", match[0], "Hedging/qualitative language this deterministic checker does not attempt to resolve as true or false");
  }
}

/**
 * Pure, deterministic: identical (responseText, envelope, decisionContext)
 * always produces an identical ResponseClaimTrace. Reuses D2.6.5's own
 * extraction/matching functions verbatim - never a second, independent
 * detection pass and never another LLM call.
 */
export function traceResponseClaims(responseText: string, envelope: IntelligenceEnvelope, decisionContext: IntelligenceDecisionContext): ResponseClaimTrace {
  const claims: ClaimTraceItem[] = [];

  traceNumericClaims(responseText, decisionContext, claims);
  traceSymbolClaims(responseText, envelope.symbol, claims);
  traceDirectionalAndProfitClaims(responseText, claims);
  traceIndicatorClaims(responseText, decisionContext, claims);
  traceHistoricalClaims(responseText, decisionContext, claims);
  traceCertaintyClaims(responseText, decisionContext, claims);
  traceUnverifiableClaims(responseText, claims);

  return {
    claims,
    supportedCount: claims.filter((c) => c.category === "supported").length,
    unsupportedCount: claims.filter((c) => c.category === "unsupported").length,
    conflictingCount: claims.filter((c) => c.category === "conflicting").length,
    unverifiableCount: claims.filter((c) => c.category === "unverifiable").length,
    version: RESPONSE_CLAIM_TRACE_VERSION,
  };
}
