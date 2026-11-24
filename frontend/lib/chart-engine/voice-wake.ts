// lib/chart-engine/voice-wake.ts
// "Hey PRAGYA": finds the wake phrase in what the browser's speech recognition heard and returns the rest of the sentence as the command.
// Pure and unit-tested (scripts/validate-voice-wake.ts). Speech recognition spells the name many ways (pragya, pragna, prajna, praggya, Devanagari), so the
// match is deliberately forgiving about the name but strict about position: the phrase must come at the start of the sentence, so a sentence that only
// mentions PRAGYA in the middle ("ask pragya about gold") is not a wake-up.

export interface WakeResult {
  woke: boolean;
  /** What was said after the wake phrase (may be empty: the user said only "Hey PRAGYA" and the command comes next). */
  rest: string;
}

const NAME = "(?:pragya+|pragna|prajna|praggya|pragyan|prgya|pragyaa|pragia|pragiya|prajnya|प्रज्ञा|प्रग्या|प्रज्ञ)";
const GREETING = "(?:hey|hay|hi|hello|ok|okay|he|hei|ey|हे|हेय|हेलो|हाय|ओके)";
// start of the sentence, optional greeting, the name; the name must not run on into another word
const WAKE = new RegExp("^\\s*(?:" + GREETING + "[\\s,]+)?" + NAME + "(?![\\p{L}\\p{M}])", "iu");
const GREETED = new RegExp("^\\s*" + GREETING + "[\\s,]+" + NAME + "(?![\\p{L}\\p{M}])", "iu");

export function extractWake(textRaw: string): WakeResult {
  const text = textRaw.replace(/\s+/g, " ").trim();
  if (!text) return { woke: false, rest: "" };
  const m = WAKE.exec(text);
  if (!m) return { woke: false, rest: "" };
  // a bare "pragya ..." wakes only when it opens the sentence; "Hey pragya ..." always does
  const greeted = GREETED.test(text);
  const rest = text.slice(m[0].length).replace(/^[\s,.:;!-]+/, "").replace(/^(?:please|pls|जी|ji)\s+/i, "").trim();
  if (!greeted && rest === "" && text.length > m[0].trim().length) return { woke: false, rest: "" };
  return { woke: true, rest };
}
