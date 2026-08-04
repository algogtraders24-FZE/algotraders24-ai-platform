// lib/ai/compliance.ts
// Sprint D2.3.S4 - confidence-scale documentation and the compliance
// scanning logic, kept separate from terminology.ts's word list (this file
// is about RULES/INTERPRETATION, that one is about WORDS).
import { autoScanPhrases } from "./terminology";

export interface ConfidenceBand {
  min: number;
  max: number;
  label: string;
  meaning: string;
}

// Sprint D2.3.S4 - one consistent interpretation for every confidence number
// shown anywhere on the platform. Always describes how much the ANALYSIS
// agrees with itself - never a probability that a trade will succeed.
export const CONFIDENCE_SCALE: readonly ConfidenceBand[] = [
  { min: 0, max: 40, label: "Weak evidence", meaning: "Little supporting evidence, or evidence that conflicts significantly." },
  { min: 41, max: 60, label: "Mixed evidence", meaning: "Some supporting evidence exists, but it is incomplete or partially contradicted." },
  { min: 61, max: 80, label: "Moderate evidence", meaning: "A reasonable body of evidence agrees, with some gaps or minor disagreement." },
  { min: 81, max: 100, label: "Strong evidence", meaning: "Substantial, consistent evidence supports the analysis." },
];

export function confidenceBandFor(score: number): ConfidenceBand {
  return CONFIDENCE_SCALE.find((b) => score >= b.min && score <= b.max) ?? CONFIDENCE_SCALE[0];
}

// Also flagged: emoji and an explicit "100%" certainty claim - neither is a
// terminology.ts phrase (they're patterns, not words), so they're detected
// here directly rather than forced into the phrase list.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const CERTAINTY_100_PATTERN = /\b100%\s*(confidence|certain|sure|accurate)?/i;

/** Returns every forbidden phrase/pattern found in `text` (case-insensitive), or an empty array if compliant. Never mutates or "fixes" text - detection only. Only phrases marked `autoScan: true` in terminology.ts are checked - see that flag's own comment for why. */
export function scanForForbiddenLanguage(text: string): string[] {
  const hits: string[] = [];
  for (const { phrase } of autoScanPhrases()) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) hits.push(phrase);
  }
  if (EMOJI_PATTERN.test(text)) hits.push("emoji");
  if (CERTAINTY_100_PATTERN.test(text)) hits.push('"100%" certainty claim');
  return hits;
}
