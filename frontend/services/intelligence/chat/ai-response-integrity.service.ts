// services/intelligence/chat/ai-response-integrity.service.ts
// Sprint D2.6.5 - Real-Time Intelligence Context + Trader Chat Integration.
// Sprint §11: validates a presenter's natural-language output against the
// real IntelligenceDecisionContext it was given. This is NOT another LLM -
// every check below is a pure, deterministic regex/set-membership rule
// over real data, documented as an explicit "V1 heuristic" (same honesty
// labeling as every other scoring/threshold constant in this codebase).
// A rule that never fires is a rule that never protects anyone - these are
// deliberately conservative (tolerant of paraphrasing, rounding, natural
// language) rather than maximally strict, so a real, honest presenter
// response is not falsely rejected into the fallback path on every turn.
//
// Sprint §12: presentSafely() is the single seam a caller uses instead of
// calling a presenter directly - if the presenter throws, times out,
// returns empty text, or fails integrity validation, the deterministic
// fallback is used instead. The trader-facing product never breaks just
// because an LLM provider had a bad moment.
import type { IntelligenceEnvelope, AIIntelligencePresenter, AIPresentationResult } from "@/types/intelligence-envelope";
import type { IntelligenceDecisionContext } from "@/types/intelligence-decision-context";
import type { ResponseIntegrityResult, ResponseIntegrityViolation } from "@/types/ai-response-integrity";
import { AI_RESPONSE_INTEGRITY_VERSION } from "@/types/ai-response-integrity";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { listCanonicalInstruments } from "@/lib/market-data/instrument-catalog";
import type { MicrostructureSnapshot } from "@/types/microstructure";
import { collectMicrostructureRealNumbers } from "@/lib/microstructure/microstructure-presentation";

/**
 * Same prohibited-claim patterns D2.6.1's own regression suite checks
 * DecisionContext itself against (types/intelligence-decision-context.ts's
 * header / scripts/validate-decision-context.ts) - reused verbatim here,
 * extended with a few more guaranteed-outcome phrasings the sprint's own
 * system instruction explicitly forbids. Real patterns, not bare
 * substrings, so the negation inside this engine's own honest disclaimer
 * text ("...is never a probability of profit...") is never a false
 * positive.
 */
// Sprint D2.6.9 - exported additively (zero behavior change to this
// file's own D2.6.5 logic) so the new, deterministic response-claim
// tracer (services/intelligence/audit/response-claim-tracer.service.ts)
// can reuse the exact same extraction/matching rules rather than
// duplicating them - "extend, never rebuild" applied to this file's own
// internals, not just its public API.
export const GUARANTEED_PROFIT_PATTERNS: RegExp[] = [
  /buy now/i,
  /sell now/i,
  /\d+%\s*win rate/i,
  /target\s*=/i,
  /stop loss\s*=/i,
  /\d+%\s*chance/i,
  /\d+%\s*probability/i,
  /probability of profit\s*[:=]\s*\d/i,
  /\bguarantee(d|s)?\b.{0,20}\b(profit|win|return|outcome)\b/i,
  /\bsure thing\b/i,
  /\bcertain profit\b/i,
  /\bcan'?t lose\b/i,
  /100%\s*(chance|certain|sure)/i,
];

export const HISTORICAL_CLAIM_PATTERN = /\bhistorically\b|\bin the past\b|\bpreviously (worked|succeeded)\b|\d+%\s*(win|success) rate\b|\btrack record\b|\bhas worked before\b/i;
export const HIGH_CERTAINTY_PATTERN = /\bdefinitely\b|\bcertainly\b|\bwithout (a )?doubt\b|\bguaranteed to\b/i;
export const HEDGING_PATTERN = /\binsufficient\b|\bnot enough (data|information|evidence)\b|\blimited data\b|\bcannot determine\b|\bcan'?t determine\b|\bunable to (determine|assess)\b|\bnot (yet )?available\b|\bmissing (data|information)\b/i;

// Sprint §11 item 4 - a fixed, closed vocabulary. "Native" indicators are
// the exact ones MarketState.technical (D2.5.2) can ever compute
// (lib/market-data/indicators.ts). "Foreign" indicators are real,
// well-known technical indicators this platform has never computed - if a
// presenter mentions one, it can only be an invented claim, since there is
// no real field anywhere in the envelope it could have come from.
export const NATIVE_INDICATOR_NAMES = ["rsi", "ema", "macd", "bollinger", "atr", "volume"];
export const FOREIGN_INDICATOR_PATTERNS: RegExp[] = [
  /\bstochastic\b/i,
  /\badx\b/i,
  /\bichimoku\b/i,
  /\bfibonacci\b/i,
  /\bparabolic sar\b/i,
  /\bwilliams %?r\b/i,
  /\bcci\b/i,
  /\bobv\b/i,
  /\bvwap\b/i,
  /\bsupertrend\b/i,
  /\bpivot point/i,
];

export const PRICE_CLAIM_RELATIVE_TOLERANCE = 0.01; // 1% - matches D2.6.4's own cross-provider tolerance precedent
export const PERCENT_CLAIM_ABSOLUTE_TOLERANCE = 2; // percentage points

/** ISO-8601 timestamps (e.g. evidence "as of"/"retrieved at" fields) embed a 4-digit year and other digit runs that are never themselves a market-fact claim - stripped before any numeric-claim extraction so "2026" from a real date is never flagged as an unsupported price. */
export function stripIsoTimestamps(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "");
}

export function extractPercentClaims(text: string): number[] {
  const matches = stripIsoTimestamps(text).match(/\d+(?:\.\d+)?%/g) ?? [];
  return matches.map((m) => Number(m.replace("%", "")));
}

/** Only "price-like" numbers - at least 4 digits, or a decimal with 2+ places - to avoid false-positiving on ordinary small integers (RSI period "14", "20 candles", "50" EMA period) that are structural vocabulary, never claims. */
export function extractPriceLikeClaims(text: string): number[] {
  const matches = stripIsoTimestamps(text).match(/\b\d{4,}(?:\.\d+)?\b|\b\d+\.\d{2,}\b/g) ?? [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

/**
 * Every DecisionContext basis/claim/description string is itself real,
 * deterministic engine output (never LLM-generated) - so any number
 * embedded in one (e.g. "EMA20 (1.08641) is above EMA50 (1.07241)") is a
 * genuine fact, even though EMA20/EMA50 have no dedicated structured
 * field on DecisionCurrentState. Scanning these strings for numbers,
 * rather than only checking a curated field list, is what lets the
 * deterministic safe fallback presenter (which only ever echoes these
 * exact strings) always pass its own integrity check.
 */
export function allRealDecisionContextText(dc: IntelligenceDecisionContext): string[] {
  return [
    ...dc.currentState.basis,
    ...dc.regimeContext.basis,
    ...dc.supportingEvidence.map((e) => e.claim),
    ...dc.opposingEvidence.map((e) => e.claim),
    ...dc.primaryHypotheses.flatMap((h) => [h.claim, h.invalidationCondition.description]),
    ...dc.invalidationConditions.map((i) => i.description),
    ...dc.riskContext.basis,
    ...dc.historicalContext.basis,
    ...dc.intelligenceScore.basis,
    ...dc.monitoringItems.map((m) => m.description),
    ...dc.missingInformation.map((m) => m.description),
    ...dc.summaryBasis,
  ];
}

export function collectRealNumbers(dc: IntelligenceDecisionContext): number[] {
  const values: number[] = [];
  for (const s of allRealDecisionContextText(dc)) {
    values.push(...extractPriceLikeClaims(s), ...extractPercentClaims(s));
  }
  return values;
}

export function withinTolerance(claimed: number, real: number, relativeTolerance: number): boolean {
  const denom = Math.max(Math.abs(claimed), Math.abs(real), 1e-9);
  return Math.abs(claimed - real) / denom <= relativeTolerance;
}

export function allowedPercentValues(dc: IntelligenceDecisionContext): number[] {
  const values: number[] = [dc.regimeContext.confidence];
  if (dc.intelligenceScore.overallScore !== undefined) values.push(dc.intelligenceScore.overallScore);
  if (dc.historicalContext.validatedRate !== undefined) values.push(dc.historicalContext.validatedRate * 100);
  return values;
}

export function allowedPriceValues(dc: IntelligenceDecisionContext): number[] {
  const values: number[] = [dc.currentState.price];
  if (dc.currentState.recentRange) values.push(dc.currentState.recentRange.high, dc.currentState.recentRange.low);
  if (dc.currentState.rsi14 !== undefined) values.push(dc.currentState.rsi14);
  if (dc.currentState.atr14 !== undefined) values.push(dc.currentState.atr14);
  for (const item of [...dc.supportingEvidence, ...dc.opposingEvidence]) {
    if (item.magnitude !== undefined) values.push(item.magnitude);
  }
  // Sprint §11 fix: a hypothesis's real, deterministic invalidation
  // referenceValue (e.g. "price closes below 1.0932") is a genuine fact
  // from the envelope, not a claim to reject - the deterministic safe
  // fallback presenter restates these verbatim (decision-context-
  // formatter.ts's own "Invalidation Conditions" section), so this
  // checker must recognize them as supported, never flag its own
  // formatter's honest output as a fabricated numeric claim.
  for (const inv of dc.invalidationConditions) {
    if (typeof inv.referenceValue === "number") values.push(inv.referenceValue);
  }
  return values;
}

function checkUnsupportedNumericClaims(text: string, dc: IntelligenceDecisionContext, extraRealNumbers: number[] = []): ResponseIntegrityViolation[] {
  const violations: ResponseIntegrityViolation[] = [];
  const realNumbers = [...collectRealNumbers(dc), ...extraRealNumbers];
  const allowedPercents = [...allowedPercentValues(dc), ...realNumbers];
  for (const claim of extractPercentClaims(text)) {
    const supported = allowedPercents.some((real) => Math.abs(claim - real) <= PERCENT_CLAIM_ABSOLUTE_TOLERANCE);
    if (!supported) {
      violations.push({ kind: "unsupported-numeric-claim", description: `Response states ${claim}% which does not match any real percentage in the verified context (regime confidence, intelligence score, historical validated rate)`, matchedText: `${claim}%` });
    }
  }
  const allowedPrices = [...allowedPriceValues(dc), ...realNumbers];
  for (const claim of extractPriceLikeClaims(text)) {
    const supported = allowedPrices.some((real) => withinTolerance(claim, real, PRICE_CLAIM_RELATIVE_TOLERANCE));
    if (!supported) {
      violations.push({ kind: "unsupported-numeric-claim", description: `Response states a price-like value (${claim}) that does not match the real price/range/evidence magnitudes in the verified context`, matchedText: String(claim) });
    }
  }
  return violations;
}

function checkUnsupportedSymbol(text: string, envelopeSymbol: string): ResponseIntegrityViolation[] {
  const otherRealSymbols = listCanonicalInstruments()
    .map((i) => i.id)
    .filter((id) => id !== envelopeSymbol);
  const violations: ResponseIntegrityViolation[] = [];
  const tokens = text.match(/\b[A-Z]{3,10}\b/g) ?? [];
  for (const token of tokens) {
    if (otherRealSymbols.includes(token)) {
      violations.push({ kind: "unsupported-symbol", description: `Response mentions "${token}", a different real instrument than the one actually analyzed (${envelopeSymbol})`, matchedText: token });
    }
  }
  return violations;
}

function checkDirectionalAndProfitLanguage(text: string): ResponseIntegrityViolation[] {
  const violations: ResponseIntegrityViolation[] = [];
  for (const pattern of GUARANTEED_PROFIT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push({
        kind: pattern === GUARANTEED_PROFIT_PATTERNS[0] || pattern === GUARANTEED_PROFIT_PATTERNS[1] ? "unsupported-directional-claim" : "guaranteed-profit-language",
        description: `Response contains prohibited language matching /${pattern.source}/`,
        matchedText: match[0],
      });
    }
  }
  return violations;
}

function checkUnsupportedIndicators(text: string, dc: IntelligenceDecisionContext): ResponseIntegrityViolation[] {
  const violations: ResponseIntegrityViolation[] = [];
  for (const pattern of FOREIGN_INDICATOR_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push({ kind: "unsupported-indicator", description: `Response references "${match[0]}", an indicator never computed by this platform's MarketState engine`, matchedText: match[0] });
    }
  }
  // RSI is the one native indicator worth checking for a real-value
  // mismatch (EMA/MACD/Bollinger/ATR are rarely quoted as bare numbers in
  // prose the same way RSI conventionally is - checking them risks noisy
  // false positives against this V1 heuristic's simple number extraction).
  if (/\brsi\b/i.test(text) && dc.currentState.rsi14 === undefined) {
    violations.push({ kind: "unsupported-indicator", description: "Response mentions RSI but no rsi14 value was actually computed for this analysis (insufficient candles)", matchedText: "RSI" });
  }
  void NATIVE_INDICATOR_NAMES; // documents the closed vocabulary this check is scoped to; see file header
  return violations;
}

function checkHistoricalClaims(text: string, dc: IntelligenceDecisionContext): ResponseIntegrityViolation[] {
  if (!HISTORICAL_CLAIM_PATTERN.test(text)) return [];
  if (dc.historicalContext.status === "available") return [];
  const match = text.match(HISTORICAL_CLAIM_PATTERN);
  return [{ kind: "unsupported-historical-claim", description: `Response makes a historical-performance claim while historicalContext.status is "${dc.historicalContext.status}"`, matchedText: match?.[0] }];
}

function checkContradictsConflictsOrInsufficiency(text: string, dc: IntelligenceDecisionContext): ResponseIntegrityViolation[] {
  const violations: ResponseIntegrityViolation[] = [];
  if (dc.unresolvedConflicts.length > 0) {
    const match = text.match(HIGH_CERTAINTY_PATTERN);
    if (match) {
      violations.push({ kind: "contradicts-unresolved-conflict", description: `Response asserts high certainty ("${match[0]}") while ${dc.unresolvedConflicts.length} unresolved evidence conflict(s) exist`, matchedText: match[0] });
    }
  }
  if (dc.state === "insufficient-intelligence" && !HEDGING_PATTERN.test(text)) {
    violations.push({ kind: "contradicts-insufficient-data", description: 'DecisionContext.state is "insufficient-intelligence" but the response contains no hedging/insufficiency acknowledgment' });
  }
  return violations;
}

/**
 * Pure, deterministic. Identical (text, envelope, decisionContext,
 * microstructure) always produces an identical result.
 *
 * Sprint D2.8.8 - optional 4th param, defaulting to undefined so every
 * existing call site (unmodified) behaves byte-identically. When a real
 * MicrostructureSnapshot is supplied, its own real "available"/"stale"
 * numeric values (bid/ask/spread/depth/volume/etc.) are recognized as
 * supported evidence by checkUnsupportedNumericClaims - otherwise a
 * presenter response that honestly cites real microstructure evidence
 * would be misclassified as an unsupported/fabricated numeric claim and
 * incorrectly rejected into the deterministic fallback, which never
 * mentions microstructure at all.
 */
export function validateResponseIntegrity(
  responseText: string,
  envelope: IntelligenceEnvelope,
  decisionContext: IntelligenceDecisionContext,
  microstructure?: MicrostructureSnapshot,
): ResponseIntegrityResult {
  const extraRealNumbers = microstructure ? collectMicrostructureRealNumbers(microstructure) : [];
  const violations: ResponseIntegrityViolation[] = [
    ...checkUnsupportedNumericClaims(responseText, decisionContext, extraRealNumbers),
    ...checkUnsupportedSymbol(responseText, envelope.symbol),
    ...checkDirectionalAndProfitLanguage(responseText),
    ...checkUnsupportedIndicators(responseText, decisionContext),
    ...checkHistoricalClaims(responseText, decisionContext),
    ...checkContradictsConflictsOrInsufficiency(responseText, decisionContext),
  ];
  return { valid: violations.length === 0, violations, checkedAt: envelope.generatedAt, version: AI_RESPONSE_INTEGRITY_VERSION };
}

export interface PresentSafelyInput {
  envelope: IntelligenceEnvelope;
  userQuestion: string;
  presenter: AIIntelligencePresenter;
  fallback: AIIntelligencePresenter;
  decisionContextService?: DecisionContextService;
}

export interface PresentSafelyResult {
  result: AIPresentationResult;
  integrity: ResponseIntegrityResult | undefined;
  usedFallback: boolean;
  /** Why the fallback was used, when it was - "presenter-error" (threw/timed out/empty) or "integrity-violation". Undefined when the primary presenter's own output was used. */
  fallbackReason?: "presenter-error" | "integrity-violation";
}

/**
 * Sprint §12 - the single seam a caller uses instead of calling a
 * presenter directly. Never lets a presenter failure or an integrity
 * violation reach the trader as a broken response.
 */
export async function presentSafely(input: PresentSafelyInput): Promise<PresentSafelyResult> {
  const decisionContextService = input.decisionContextService ?? new DecisionContextService();
  const decisionContext = decisionContextService.build(input.envelope);

  let primary: AIPresentationResult | undefined;
  try {
    const candidate = await input.presenter.present(input.envelope, input.userQuestion);
    if (candidate.text.trim().length > 0) primary = candidate;
  } catch {
    primary = undefined;
  }

  if (!primary) {
    const fallbackResult = await input.fallback.present(input.envelope, input.userQuestion);
    return { result: fallbackResult, integrity: undefined, usedFallback: true, fallbackReason: "presenter-error" };
  }

  const integrity = validateResponseIntegrity(primary.text, input.envelope, decisionContext);
  if (!integrity.valid) {
    const fallbackResult = await input.fallback.present(input.envelope, input.userQuestion);
    return { result: fallbackResult, integrity, usedFallback: true, fallbackReason: "integrity-violation" };
  }

  return { result: primary, integrity, usedFallback: false };
}
