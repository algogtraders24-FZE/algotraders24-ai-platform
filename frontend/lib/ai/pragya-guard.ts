// lib/ai/pragya-guard.ts
// Guards for PRAGYA's chart analysis (the platform's Gemini assistant). The model only rewrites measured facts into prose;
// its answer is accepted only if it invents no number and makes no promise. Pure functions, unit-tested.
import { autoScanPhrases } from "./terminology";

/** Numbers in a text, commas removed ("61,129.29" -> 61129.29). Only numbers with 3+ digits or a decimal part count (years, "4 sentences" etc. are ignored). */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, "");
    const digits = raw.replace(".", "").length;
    if (digits < 3 && !raw.includes(".")) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Every number in `answer` must match a number in `facts` within `tolerance` (rounding by the model is fine, invention is not). */
export function numbersAreSupported(answer: string, facts: string, tolerance = 0.005): { ok: boolean; unsupported: number[] } {
  const known = extractNumbers(facts);
  const unsupported: number[] = [];
  for (const n of extractNumbers(answer)) {
    const hit = known.some((f) => (f === 0 ? n === 0 : Math.abs(n - f) / Math.abs(f) <= tolerance));
    if (!hit) unsupported.push(n);
  }
  return { ok: unsupported.length === 0, unsupported };
}

const PROMISES = /\b(guarantee[sd]?|sure[- ]?shot|risk[- ]?free|can'?t lose|will (?:definitely|certainly|surely) (?:rise|fall|reach|win)|100 ?% (?:accurate|certain|sure|win))\b/i;
const WIN_RATE = /\b\d{1,3}\s?%\s*(?:win|success|accuracy|chance|probab)/i;

/** True when the answer contains a promise, a win-rate / probability claim or any phrase the platform's terminology rules forbid. */
export function containsForbiddenClaim(answer: string): boolean {
  if (PROMISES.test(answer) || WIN_RATE.test(answer)) return true;
  const lower = answer.toLowerCase();
  return autoScanPhrases().some((p) => lower.includes(p.phrase.toLowerCase()));
}

/** Plain text only: strips markdown markers and collapses whitespace; the panel shows prose, not formatting. */
export function cleanProse(answer: string): string {
  return answer.replace(/[*_`#>]+/g, "").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}
