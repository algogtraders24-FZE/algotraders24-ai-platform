// lib/ai/terminology.ts
// Sprint D2.3.S4 - the single, central forbidden-phrase / approved-language
// registry. Every other AI-compliance file derives from this list rather
// than maintaining its own copy: lib/ai/response-policy.ts composes its
// prompt text from it, lib/ai/compliance.ts's scanner checks against it, and
// docs/architecture/AI_RESPONSE_GUIDELINES.md documents it - one list, three
// consumers, never three independently-maintained ones.
export interface ForbiddenPhrase {
  phrase: string;
  /** A hedged, evidence-based alternative - omitted when no direct rewording exists (e.g. "guaranteed" has no honest alternative, it's simply never said). */
  alternative?: string;
  /**
   * Whether this phrase is safe for AUTOMATED regex scanning
   * (scanForForbiddenLanguage). False for ambiguous single words that have
   * legitimate educational uses ("explain what a stop-loss order is") - the
   * spec's own "unless explicitly in educational examples" carve-out can't
   * be judged by a regex, only by the AI itself (which the prompt text
   * instructs) or a human reviewer. Every phrase here is still documented
   * in the policy/style guide regardless of this flag.
   */
  autoScan: boolean;
}

export const FORBIDDEN_PHRASES: readonly ForbiddenPhrase[] = [
  { phrase: "Buy Now", alternative: "Bullish scenario", autoScan: true },
  { phrase: "Sell Now", alternative: "Bearish structure", autoScan: true },
  { phrase: "Guaranteed Profit", autoScan: true },
  { phrase: "100% Accuracy", autoScan: true },
  { phrase: "Sure Shot", autoScan: true },
  { phrase: "Risk Free", autoScan: true },
  { phrase: "Guaranteed", autoScan: true },
  { phrase: "Best Entry", alternative: "Higher-probability conditions", autoScan: true },
  // Directive-only forbidden (bare word has legitimate educational uses,
  // e.g. "what is an entry order" or "explain what a stop-loss is") - the
  // prompt instructs the AI to avoid these AS DIRECTIVES; not auto-scanned.
  { phrase: "Entry", autoScan: false },
  { phrase: "Exit", autoScan: false },
  { phrase: "Target", autoScan: false },
  { phrase: "Stoploss", autoScan: false },
  { phrase: "Stop Loss", autoScan: false },
];

export function autoScanPhrases(): readonly ForbiddenPhrase[] {
  return FORBIDDEN_PHRASES.filter((f) => f.autoScan);
}

/** Neutral, evidence-based phrasing to prefer generally (not a 1:1 replacement for any single forbidden phrase above). */
export const APPROVED_LANGUAGE: readonly string[] = [
  "Bullish scenario",
  "Bearish structure",
  "Higher-probability conditions",
  "Evidence suggests",
  "Market conditions indicate",
  "Current evidence favors...",
  "Conditions are consistent with...",
];

export function forbiddenPhraseList(): string {
  return FORBIDDEN_PHRASES.map((f) => f.phrase).join(", ");
}
